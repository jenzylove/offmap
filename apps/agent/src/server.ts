import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { collateralValue, liquidationPrice, ltvBps, totals } from "@offmap/core";
import { COHORTS, USDC_INTENTS_ID, config } from "./config.js";
import * as base from "./base.js";
import * as intents from "./intents.js";
import { cohortPrice } from "./prices.js";
import { login, session } from "./auth.js";
import { risk, engineErrors } from "./engine.js";
import { save, type State } from "./store.js";
import { frozen } from "./ejects.js";
import type { Identity } from "./identity.js";

const big = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const cohort = (id: string) => {
  const c = COHORTS.find((c) => c.id === id);
  if (!c) throw new Error("unknown cohort");
  return c;
};

export function app(id: Identity, s: State) {
  const a = new Hono();
  a.use("*", cors());
  a.onError((e, c) => c.json({ error: String(e.message ?? e) }, 400));
  const me = (c: any) => {
    const u = session(c.req.header("authorization"));
    if (!u) throw new Error("sign in first");
    s.owners[u.userId] = u.address;
    return u;
  };

  a.get("/health", (c) => c.json({ agent: id.accountId, registration: id.registration, errors: engineErrors, intentsOwner: id.intentsSigner, tee: id.tee, contract: config.contractId || null,
    cohorts: COHORTS.map((k) => ({ id: k.id, address: base.cohortAddress(id.mpcPredecessor, k.id) })), lastBatch: s.batches.at(-1) ?? null }));

  // Anyone can fetch the hardware attestation and check it against the measurements offmap.near approves.
  a.get("/attestation", async (c) => (id.attestation ? c.json(big(await id.attestation())) : c.json({ tee: false, note: "dev mode, no TEE attestation" })));

  a.post("/auth", async (c) => {
    const b = await c.req.json();
    return c.json(await login(b.address, b.nonce, b.deadline, b.signature));
  });

  // Borrow: risk check against a dry quote, then a deposit address into the private balance.
  a.post("/quote/borrow", async (c) => {
    const u = me(c);
    const b = await c.req.json();
    const k = cohort(b.cohort);
    const borrow = BigInt(b.borrowUsdc ?? "0");
    const dry = await intents.api<any>("/v0/quote", { dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: b.depositAsset, depositType: "ORIGIN_CHAIN",
      destinationAsset: k.collateralAssetId, amount: String(b.depositAmount), refundTo: b.refundTo, refundType: "ORIGIN_CHAIN", recipient: id.intentsSigner, recipientType: "CONFIDENTIAL_INTENTS",
      deadline: new Date(Date.now() + 3600e3).toISOString() });
    const coll = BigInt(dry.quote.minAmountOut);
    const { price } = await cohortPrice(k);
    const pos = s.ledgers[k.id]!.positions.get(u.userId);
    const ltv = ltvBps((pos?.collateral ?? 0n) + coll, (pos?.debt ?? 0n) + borrow, price, k);
    if (ltv > risk.maxOpenLtvBps) throw new Error(`borrow too large: ${Number(ltv) / 100}% LTV, limit ${Number(risk.maxOpenLtvBps) / 100}%`);
    const q = await intents.quoteIntoConfidential(id, { originAsset: b.depositAsset, amount: String(b.depositAmount), asset: k.collateralAssetId, refundTo: b.refundTo });
    s.pending.push({ id: randomUUID(), kind: "deposit", userId: u.userId, cohortId: k.id, depositAddress: q.depositAddress, borrow: borrow.toString(),
      receive: { asset: b.receiveAsset ?? USDC_INTENTS_ID, address: b.receiveAddress }, createdAt: Date.now(), status: "waiting" });
    save(s);
    return c.json({ depositAddress: q.depositAddress, amountIn: q.amountIn, collateralOut: q.amountOutFormatted, ltvBps: Number(ltv), deadline: q.deadline });
  });

  a.post("/quote/repay", async (c) => {
    const u = me(c);
    const b = await c.req.json();
    const k = cohort(b.cohort);
    const q = await intents.quoteIntoConfidential(id, { originAsset: b.depositAsset, amount: String(b.depositAmount), asset: USDC_INTENTS_ID, refundTo: b.refundTo });
    s.pending.push({ id: randomUUID(), kind: "repay", userId: u.userId, cohortId: k.id, depositAddress: q.depositAddress, createdAt: Date.now(), status: "waiting" });
    save(s);
    return c.json({ depositAddress: q.depositAddress, amountIn: q.amountIn, usdcOut: q.amountOutFormatted, deadline: q.deadline });
  });

  // Withdraw collateral, or borrow more against what is already deposited.
  a.post("/request", async (c) => {
    const u = me(c);
    const b = await c.req.json();
    const k = cohort(b.cohort);
    if (!["borrow", "withdraw"].includes(b.kind)) throw new Error("kind must be borrow or withdraw");
    if (frozen(s, k.id).has(u.userId)) throw new Error("your eject is in progress in this cohort");
    s.requests.push({ id: randomUUID(), kind: b.kind, userId: u.userId, cohortId: k.id, amount: String(BigInt(b.amount)), receive: { asset: b.receiveAsset, address: b.receiveAddress }, createdAt: Date.now(), status: "queued" });
    save(s);
    return c.json({ queued: true, nextBatchWithinSeconds: config.batchSeconds });
  });

  a.get("/position", async (c) => {
    const u = me(c);
    const out = [];
    for (const k of COHORTS) {
      const p = s.ledgers[k.id]!.positions.get(u.userId);
      const pending = s.pending.filter((x) => x.userId === u.userId && x.cohortId === k.id && ["waiting", "arrived", "supplied"].includes(x.status));
      const payouts = s.payouts.filter((x) => x.userId === u.userId);
      if (!p && !pending.length) continue;
      const { price } = await cohortPrice(k);
      out.push({ cohort: k.id, collateral: p?.collateral ?? 0n, debt: p?.debt ?? 0n, ltvBps: p ? ltvBps(p.collateral, p.debt, price, k) : 0n,
        liquidationPrice: p ? liquidationPrice(p, k, risk) : null, price, note: s.notes[`${k.id}:${u.userId}`] ?? null,
        pending: pending.map((x) => ({ kind: x.kind, status: x.status, depositAddress: x.depositAddress })), payouts: payouts.map((x) => ({ amount: x.amount, status: x.status, notBefore: x.notBefore, tx: x.tx })),
        requests: s.requests.filter((r) => r.userId === u.userId && r.cohortId === k.id).slice(-10) });
    }
    return c.json(big({ address: u.address, userId: u.userId, positions: out }));
  });

  // What anyone can see. No per user data.
  let cohortCache: { at: number; body: unknown } | undefined;
  a.get("/public/cohorts", async (c) => {
    if (cohortCache && Date.now() - cohortCache.at < 30_000) return c.json(cohortCache.body as any);
    const out = [];
    for (const k of COHORTS) {
      const addr = base.cohortAddress(id.mpcPredecessor, k.id);
      const onchain = await base.position(k, addr);
      const t = totals(s.ledgers[k.id]!);
      const { price } = await cohortPrice(k);
      out.push({ cohort: k.id, address: addr, market: k.marketId, morpho: onchain, ledgerTotals: { collateral: t.collateral, debt: t.debt, reserve: s.ledgers[k.id]!.reserve },
        collateralValue: collateralValue(onchain.collateral, price, k), lastBatch: s.batches.filter((b) => b.cohortId === k.id).at(-1) ?? null });
    }
    cohortCache = { at: Date.now(), body: big({ contract: config.contractId || null, cohorts: out }) };
    return c.json(cohortCache.body as any);
  });

  a.get("/public/leak", (c) => {
    const f = "./data/leak.json";
    return fs.existsSync(f) ? c.json(JSON.parse(fs.readFileSync(f, "utf8"))) : c.json({ status: "not yet run" });
  });
  return a;
}
