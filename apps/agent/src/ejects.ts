import { keccak256, type Address, type Hex } from "viem";
import * as base from "./base.js";
import { userIdFor } from "./auth.js";
import type { Identity } from "./identity.js";
import type { CohortConfig } from "./config.js";
import { save, type State, type EjectWatch } from "./store.js";

/**
 * Ejects are signed by offmapfi.near without the agent. The agent must notice them, or an ejected
 * user would still hold a position in the private ledger and could withdraw or eject the same share again.
 *
 * For every eject the contract signed: while it is pending the user is frozen (no ops, no liquidation).
 * The agent lands it at its nonce before any transaction of its own, so it never races the user's exit.
 * Once it lands the position leaves the ledger; if its nonce is taken by another transaction it failed
 * and the user can eject again from the next statement.
 */
export async function syncEjects(id: Identity, s: State, c: CohortConfig) {
  const w = ((s.ejects ??= {})[c.id] ??= { seen: 0, list: [] });
  const recs = ((await id.viewContract("ejects", { cohort_id: c.id, from_index: w.seen, limit: 50 })) ?? []) as any[];
  for (const r of recs) {
    const signedTx = r.signed_tx as Hex;
    w.list.push({ leafHash: r.leaf_hash, userId: userIdFor(r.user), user: r.user, nonce: Number(r.tx_nonce), signedTx, hash: keccak256(signedTx), status: "pending", at: Number(r.at_ms) });
    w.seen++;
  }
  const addr = base.cohortAddress(id.mpcPredecessor, c.id) as Address;
  for (const e of w.list.filter((e) => e.status === "pending")) {
    let rc = await base.client.getTransactionReceipt({ hash: e.hash }).catch(() => null);
    if (!rc) {
      const n = await base.client.getTransactionCount({ address: addr, blockTag: "latest" });
      if (n === e.nonce) rc = await base.landEject(e.signedTx);
      else if (n > e.nonce) {
        rc = await base.client.getTransactionReceipt({ hash: e.hash }).catch(() => null);
        if (!rc) { e.status = "failed"; continue; } // another transaction used the nonce
      }
    }
    if (!rc) continue; // a future nonce: lands when the cohort reaches it (base.send lands it first)
    if (rc.status === "success") {
      s.ledgers[c.id]!.positions.delete(e.userId);
      delete s.notes[`${c.id}:${e.userId}`];
      e.status = "landed";
    } else e.status = "failed";
  }
  base.ejectQueue.set(c.id, w.list.filter((e) => e.status === "pending").map((e) => ({ nonce: e.nonce, signedTx: e.signedTx })));
  save(s);
}

/** Users with an eject in flight in this cohort. */
export const frozen = (s: State, cohortId: string) =>
  new Set((s.ejects?.[cohortId]?.list ?? []).filter((e: EjectWatch) => e.status === "pending").map((e) => e.userId));
