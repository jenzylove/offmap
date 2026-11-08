import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { leafHash, type Hex } from "@offmap/core";
import { recoverTransactionAddress } from "viem";
import {
  assembleSigned,
  buildEjectArgs,
  ejectCalldata,
  parseEjectOutcome,
  payloadHash,
  unsignedEjectTx,
  userIdForEvm,
  type CohortConfigWire,
  type EjectCallArgs,
  type StatementWire,
} from "../src/lib/eject";

// The contract's own fixture: a cohort tree built with @offmap/core and an eject tx encoded by viem.
const fx = JSON.parse(readFileSync(new URL("../../../contracts/near/tests/fixtures.json", import.meta.url), "utf8"));
// A real eject signed by the MPC network on NEAR testnet (contracts/near/TESTNET.md, run 1).
const real = JSON.parse(readFileSync(new URL("./testnet-eject.json", import.meta.url), "utf8"));

const cohort = fx.cohort as CohortConfigWire;
const statement = fx.statement as StatementWire;
const ea = fx.eject_args;

function argsFromFixture(): EjectCallArgs {
  const note = {
    userId: fx.leaf.user_id,
    collateral: BigInt(fx.leaf.collateral),
    debt: BigInt(fx.leaf.debt),
    nonce: BigInt(fx.leaf.nonce),
    salt: fx.leaf.salt as Hex,
    proof: fx.proof,
  };
  const a = (x: typeof ea.grant) => ({
    authorizer: x.authorizer,
    authorized: x.authorized,
    isAuthorized: x.is_authorized,
    nonce: BigInt(x.nonce),
    deadline: BigInt(x.deadline),
  });
  return buildEjectArgs({
    cohortId: cohort.id,
    note,
    user: ea.user,
    statement,
    grant: a(ea.grant),
    grantSig: ea.grant_sig,
    revoke: a(ea.revoke),
    revokeSig: ea.revoke_sig,
    tx: {
      nonce: BigInt(ea.tx.nonce),
      maxFeePerGas: BigInt(ea.tx.max_fee_per_gas),
      maxPriorityFeePerGas: BigInt(ea.tx.max_priority_fee_per_gas),
      gasLimit: BigInt(ea.tx.gas_limit),
    },
  });
}

describe("eject argument building", () => {
  it("builds exactly the contract's eject arguments", () => {
    const args = argsFromFixture();
    expect(args.cohort_id).toBe(cohort.id);
    expect(args.leaf).toEqual(fx.leaf);
    expect(args.proof).toEqual(fx.proof);
    expect(args.eject_args).toEqual(ea);
    expect("hash" in args.leaf).toBe(false);
  });

  it("user_id is keccak256('evm:' + lowercase address)", () => {
    expect(userIdForEvm(ea.user)).toBe(fx.leaf.user_id);
  });

  it("leaf hashes the same as the contract", () => {
    const l = fx.leaf;
    expect(leafHash({ cohortId: cohort.id, userId: l.user_id, collateral: BigInt(l.collateral), debt: BigInt(l.debt), nonce: BigInt(l.nonce), salt: l.salt })).toBe(fx.leaf_hash);
  });
});

describe("eject transaction", () => {
  it("encodes the helper calldata, unsigned tx and payload hash byte for byte", () => {
    const args = argsFromFixture();
    expect(ejectCalldata(cohort, args)).toBe(fx.expected.calldata);
    const unsigned = unsignedEjectTx(cohort, args);
    expect(unsigned).toBe(fx.expected.unsigned_tx);
    expect(payloadHash(unsigned)).toBe(fx.expected.payload_hash);
  });

  it("assembles the signed tx from an MPC style response", () => {
    const signed = assembleSigned(cohort, argsFromFixture(), {
      big_r: { affine_point: "03" + "aa".repeat(32) },
      s: { scalar: "bb".repeat(32) },
      recovery_id: 1,
    });
    expect(signed).toBe(fx.expected.signed_with_fake_sig);
  });
});

describe("a real MPC signed eject from NEAR testnet", () => {
  const outcome = parseEjectOutcome(real.outcome);

  it("parses the contract's outcome", () => {
    expect(outcome.leaf_hash).toBe(fx.leaf_hash);
    expect(outcome.signature).not.toBeNull();
    expect(outcome.signed_tx).toMatch(/^0x02/);
  });

  it("rebuilds the same payload and the same signed tx in the browser", async () => {
    const args = real.args as EjectCallArgs;
    const unsigned = unsignedEjectTx(cohort, args);
    expect(unsigned).toBe(outcome.unsigned_tx);
    expect(payloadHash(unsigned)).toBe(outcome.payload_hash);
    const signed = assembleSigned(cohort, args, outcome.signature!);
    expect(signed).toBe(outcome.signed_tx);
    expect(await recoverTransactionAddress({ serializedTransaction: signed as `0x02${string}` })).toBe(real.cohort_address);
  });

  it("surfaces the contract's refusal reason", () => {
    expect(() =>
      parseEjectOutcome({ status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: invalid Merkle proof" } } } } } }),
    ).toThrow(/invalid Merkle proof/);
  });
});
