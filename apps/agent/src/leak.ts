import fs from "node:fs";
import * as intents from "./intents.js";
import type { State } from "./store.js";

/**
 * Leak study, run on Offmap's own traffic with public chain data only.
 * Adversary sees, for every deposit and every payout: chain, USD size, time, and the payout recipient.
 * H1 amount: payout USD within 2% of deposit USD. H2 timing: payout within 1 hour after the deposit.
 * H3 address reuse: a recipient seen before is linked to its earlier deposit. H4 pair rarity: every chain pair counts.
 * H5 borrow ratio (lending specific): a payout worth 10% to 60% of a deposit within 24 hours, the shape of a loan against collateral.
 * A deposit is uniquely linked when exactly one payout survives. Ground truth only scores, never guides.
 */
interface Rec { id: string; userId: string; t: number; usd: number; chain: string; recipient?: string }

const chainOf = (asset: string) => (asset.startsWith("nep141:base-") || asset === "nep141:base.omft.near" ? "base" : asset.startsWith("nep141:sol-") ? "solana" : asset.includes("arb-") ? "arbitrum" : "near");

export async function runLeakStudy(s: State) {
  const deposits: Rec[] = [];
  for (const p of s.pending.filter((p) => p.status === "applied")) {
    try {
      const st: any = await intents.status(p.depositAddress);
      deposits.push({ id: p.id, userId: p.userId, t: Date.parse(st.updatedAt), usd: Number(st.swapDetails.depositedAmountUsd), chain: chainOf(st.quoteResponse?.quoteRequest?.originAsset ?? "") });
    } catch { /* skip unreadable */ }
  }
  const payouts: Rec[] = [];
  for (const p of s.payouts.filter((p) => p.status === "done" && p.deposit)) {
    try {
      const st: any = await intents.status(p.deposit!);
      payouts.push({ id: p.id, userId: p.userId, t: Date.parse(st.updatedAt), usd: Number(st.swapDetails.amountOutUsd), chain: chainOf(p.destinationAsset), recipient: p.recipient.toLowerCase() });
    } catch { /* skip */ }
  }

  let linked = 0, correct = 0, setSum = 0;
  const seenRecipients = new Map<string, string>(); // recipient -> userId of the first linked deposit
  for (const d of deposits.sort((a, b) => a.t - b.t)) {
    const cands = payouts.filter((p) => p.t >= d.t && p.t - d.t <= 3600_000 && Math.abs(p.usd - d.usd) <= 0.02 * d.usd);
    setSum += cands.length;
    if (cands.length === 1) {
      linked++;
      if (cands[0]!.userId === d.userId) correct++;
      seenRecipients.set(cands[0]!.recipient!, d.userId);
    }
  }
  // H5: the lending adversary. Any loan is a payout smaller than its collateral, soon after it.
  let lLinked = 0, lCorrect = 0, lSet = 0;
  for (const d of deposits) {
    const cands = payouts.filter((p) => p.t >= d.t && p.t - d.t <= 24 * 3600_000 && p.usd >= 0.1 * d.usd && p.usd <= 0.6 * d.usd);
    lSet += cands.length;
    if (cands.length === 1) { lLinked++; if (cands[0]!.userId === d.userId) lCorrect++; }
  }
  // H3: payouts to a recipient already linked once are linked too.
  const reuse = payouts.filter((p) => seenRecipients.has(p.recipient!)).length;

  // Level attack: a batch that changes exactly one user's position shows that user's change on Morpho.
  const moving = s.batches.filter((b) => b.delta.collateral !== "0" || b.delta.debt !== "0");
  const exposed = moving.filter((b) => (b as any).usersChanged === 1).length;
  const unknown = moving.filter((b) => (b as any).usersChanged === undefined).length;

  const out = {
    ranAt: new Date().toISOString(),
    method: "public chain data only: H1 amount within 2%, H2 payout within 1 hour, H3 address reuse, H4 every chain pair counts",
    deposits: deposits.length,
    payouts: payouts.length,
    uniquelyLinked: linked,
    correctlyLinked: correct,
    linkedFraction: deposits.length ? correct / deposits.length : null,
    meanAnonymitySet: deposits.length ? setSum / deposits.length : null,
    recipientReuseLinks: reuse,
    borrowRatioAttack: { uniquelyLinked: lLinked, correctlyLinked: lCorrect, linkedFraction: deposits.length ? lCorrect / deposits.length : null, meanAnonymitySet: deposits.length ? lSet / deposits.length : null },
    levelAttack: { movingBatches: moving.length, batchesExposingOneUser: exposed, batchesUnknown: unknown, exposedFraction: moving.length ? exposed / moving.length : null },
    note: "Amounts are compared in USD. Payouts leave in round lots after random delays, which is what moves H1 and H2. At low volume the anonymity set is small; this file says so with the real numbers.",
  };
  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync("./data/leak.json", JSON.stringify(out, null, 2));
  return out;
}
