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
  signInEvm: () => Promise<void>;
  signOut: () => void;
  ownerString: string | null;
}

const Ctx = createContext<SessionState | null>(null);
const KEY = "offmap.session";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
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
      setNote(`Wallet connected, but the agent did not open a session: ${msg}`);
      persist(o, null);
    }
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
      setError(e instanceof Error ? e.message : String(e));
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

  const ownerString = owner ? (owner.kind === "evm" ? `evm:${owner.address.toLowerCase()}` : `near:${owner.accountId}`) : null;

  const value = useMemo(
    () => ({ owner, token, busy, error, note, signInEvm, signOut, ownerString }),
    [owner, token, busy, error, note, signInEvm, signOut, ownerString],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
