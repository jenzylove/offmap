"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, getAddress, type Address, type EIP1193Provider } from "viem";
import { base } from "viem/chains";
import { agent, agentConfigured, AgentError } from "./agent";

type Owner = { kind: "evm"; address: Address } | { kind: "near"; accountId: string };

interface SessionState {
  owner: Owner | null;
  /** Agent session token, present only when the agent accepted the signature. */
  token: string | null;
  busy: boolean;
  error: string | null;
  /** Why there is an owner but no token, in plain words. */
  note: string | null;
  /** Asks the browser wallet for an account. No signature, no session. */
  connect: () => Promise<void>;
  /** Connects if needed, then signs the free auth message and opens an agent session. */
  signInEvm: () => Promise<void>;
  signOut: () => void;
  /** Keeps the wallet, drops an agent session the agent no longer accepts. */
  expire: () => void;
  /** True once the stored session has been read on mount. */
  ready: boolean;
  ownerString: string | null;
}

const Ctx = createContext<SessionState | null>(null);
const KEY = "offmap.session";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

/** Wallet errors in plain words: no library names or version strings. */
function walletError(e: unknown): string {
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  if (/reject|denied|cancel/i.test(m)) return "You cancelled in your wallet. Press the button again when you are ready.";
  if (/no (injected|ethereum)|provider/i.test(m)) return "No browser wallet found. Install Rabby or MetaMask, then come back.";
  return m.split(/Details:|Version:/)[0]!.trim();
}

function randomHex(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function evmProvider(): EIP1193Provider | null {
  return typeof window !== "undefined" && window.ethereum ? window.ethereum : null;
}

export async function evmWallet() {
  const p = evmProvider();
  if (!p) throw new Error("No browser wallet found. Install or unlock an EVM wallet such as MetaMask or Rabby.");
  const client = createWalletClient({ chain: base, transport: custom(p) });
  const [addr] = await client.requestAddresses();
  if (!addr) throw new Error("The wallet returned no account.");
  return { client, address: getAddress(addr) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nearConnector: any = null;
export async function nearConnectorInstance() {
  if (!nearConnector) {
    const { NearConnector } = await import("@hot-labs/near-connect");
    nearConnector = new NearConnector({ network: "mainnet" });
  }
  return nearConnector as import("@hot-labs/near-connect").NearConnector;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<Owner | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as { owner: Owner; token: string | null };
        setOwner(s.owner);
        setToken(s.token);
      }
    } catch {
      /* storage blocked */
    }
    setReady(true);
  }, []);

  const persist = (o: Owner | null, t: string | null) => {
    try {
      if (o) sessionStorage.setItem(KEY, JSON.stringify({ owner: o, token: t }));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage blocked */
    }
  };

  const exchange = useCallback(async (o: Owner, body: Record<string, unknown>) => {
    if (!agentConfigured) {
      setNote("Wallet connected. The Offmap agent is not live yet, so there is no private ledger to open.");
      persist(o, null);
      return;
    }
    try {
      const r = await agent<{ token: string }>("/auth", { method: "POST", body: JSON.stringify(body) });
      setToken(r.token);
      setNote(null);
      persist(o, r.token);
    } catch (e) {
      const msg = e instanceof AgentError ? e.message : String(e);
      setNote(`Your wallet is connected, but your loan could not be opened yet. ${msg}`);
      persist(o, null);
    }
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { address } = await evmWallet();
      const o: Owner = { kind: "evm", address };
      setOwner(o);
      setToken(null);
      persist(o, null);
    } catch (e) {
      setError(walletError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // A different account in the wallet means a different loan: drop the session.
  useEffect(() => {
    const p = evmProvider() as (EIP1193Provider & { removeListener?: (e: string, f: (a: string[]) => void) => void }) | null;
    if (!p?.on) return;
    const onAccounts = (accounts: string[]) => {
      setOwner((cur) => {
        if (!cur || cur.kind !== "evm") return cur;
        const next = accounts[0];
        if (next && next.toLowerCase() === cur.address.toLowerCase()) return cur;
        setToken(null);
        const o: Owner | null = next ? { kind: "evm", address: getAddress(next) } : null;
        persist(o, null);
        return o;
      });
    };
    p.on("accountsChanged", onAccounts as never);
    return () => p.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const signInEvm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { client, address } = await evmWallet();
      const o: Owner = { kind: "evm", address };
      setOwner(o);
      if (!agentConfigured) {
        await exchange(o, {});
        return;
      }
      const nonce = randomHex(16);
      const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
      const message = `offmap:auth:${nonce}:${deadline}`;
      const signature = await client.signMessage({ account: address, message });
      await exchange(o, { address, nonce, deadline, signature });
    } catch (e) {
      setError(walletError(e));
    } finally {
      setBusy(false);
    }
  }, [exchange]);

  const signOut = useCallback(() => {
    setOwner(null);
    setToken(null);
    setNote(null);
    persist(null, null);
  }, []);

  const expire = useCallback(() => {
    setToken(null);
    setOwner((o) => {
      persist(o, null);
      return o;
    });
  }, []);

  const ownerString = owner ? (owner.kind === "evm" ? `evm:${owner.address.toLowerCase()}` : `near:${owner.accountId}`) : null;

  const value = useMemo(
    () => ({ owner, token, busy, error, note, connect, signInEvm, signOut, expire, ownerString, ready }),
    [owner, token, busy, error, note, connect, signInEvm, signOut, expire, ownerString, ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
