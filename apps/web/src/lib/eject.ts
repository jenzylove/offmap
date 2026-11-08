/**
 * Eject: argument building, transaction encoding and signed transaction assembly for offmap.near.
 * Shapes follow contracts/near/src/types.rs exactly. U128 / U64 travel as decimal strings.
 * Pure functions (no network), unit tested against contracts/near/tests/fixtures.json.
 */
import type { Note } from "@offmap/core";
import { encodeFunctionData, getAddress, keccak256, parseAbi, serializeTransaction, toBytes, type Address, type Hex } from "viem";

/* ---------- contract shapes ---------- */

export interface CohortConfigWire {
  id: string;
  market_id: string;
  loan_token: string;
  collateral_token: string;
  oracle: string;
  irm: string;
  lltv: string;
  base_chain_id: number;
  eject_helper: string;
  size_cap_loan: string;
  ceiling_bps: number;
}

export interface ContractConfigWire {
  cohorts: CohortConfigWire[];
  eject_min_gas_limit: string;
  eject_max_gas_limit: string;
  eject_max_fee_per_gas: string;
  statement_max_age_ms?: string;
  dev_mode?: boolean;
  [k: string]: unknown;
}

export interface StatementWire {
  cohort_id: string;
  batch_id: string;
  total_collateral: string;
  total_debt: string;
  reserve: string;
  collateral_value_loan: string;
  borrow_shares: string;
  merkle_root: string;
  leaf_count: number;
  timestamp_ms: string;
}

export interface StoredStatementWire {
  statement: StatementWire;
  accepted_at_ms: number;
  agent: string;
}

export interface AuthorizationArg {
  authorizer: string;
  authorized: string;
  is_authorized: boolean;
  nonce: string;
  deadline: string;
}

export interface SignatureArg {
  v: number;
  r: string;
  s: string;
}

export interface EjectTxArgs {
  nonce: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  gas_limit: string;
}

export interface LeafArg {
  user_id: string;
  collateral: string;
  debt: string;
  nonce: string;
  salt: string;
}

export interface EjectArgs {
  user: string;
  borrow_shares: string;
  flash_assets: string;
  grant: AuthorizationArg;
  grant_sig: SignatureArg;
  revoke: AuthorizationArg;
  revoke_sig: SignatureArg;
  tx: EjectTxArgs;
}

export interface EjectCallArgs {
  cohort_id: string;
  leaf: LeafArg;
  proof: { index: number; siblings: string[] };
  eject_args: EjectArgs;
}

export interface SignResponse {
  big_r: { affine_point: string };
  s: { scalar: string };
  recovery_id: number;
}

export interface EjectOutcome {
  leaf_hash: string;
  payload_hash: string;
  unsigned_tx: string;
  signature: SignResponse | null;
  signed_tx: string | null;
}

export interface EjectPreview {
  leaf_hash: string;
  payload_hash: string;
  unsigned_tx: string;
}

/* ---------- amounts ---------- */

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Smallest borrow_shares the contract accepts: ceil(debt * stmt.borrow_shares / stmt.total_debt). */
export function minBorrowShares(debt: bigint, s: Pick<StatementWire, "borrow_shares" | "total_debt">): bigint {
  const total = BigInt(s.total_debt);
  if (total === 0n || debt === 0n) return 0n;
  return ceilDiv(debt * BigInt(s.borrow_shares), total);
}

/** Flash loan size: the leaf debt plus 1%, which covers interest accrued since the statement. */
export const flashAssetsFor = (debt: bigint) => debt + debt / 100n;

/* ---------- authorizations ---------- */

export interface Authorization {
  authorizer: Address;
  authorized: Address;
  isAuthorized: boolean;
  nonce: bigint;
  deadline: bigint;
}

export const AUTH_TYPES = {
  Authorization: [
    { name: "authorizer", type: "address" },
    { name: "authorized", type: "address" },
    { name: "isAuthorized", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Morpho's EIP-712 domain has only chainId and verifyingContract. */
export const morphoDomain = (chainId: number, morpho: Address) => ({ chainId, verifyingContract: morpho }) as const;

export const authArg = (a: Authorization): AuthorizationArg => ({
  authorizer: a.authorizer,
  authorized: a.authorized,
  is_authorized: a.isAuthorized,
  nonce: a.nonce.toString(),
  deadline: a.deadline.toString(),
});

/** Splits a 65 byte signature into the v, r, s Morpho expects (v is 27 or 28). */
export function splitSig(sig: Hex): SignatureArg {
  const h = sig.slice(2);
  if (h.length !== 130) throw new Error("signature must be 65 bytes");
  let v = parseInt(h.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { v, r: "0x" + h.slice(0, 64), s: "0x" + h.slice(64, 128) };
}

/* ---------- argument building ---------- */

export function buildEjectArgs(p: {
  cohortId: string;
  note: Pick<Note, "userId" | "collateral" | "debt" | "nonce" | "salt" | "proof">;
  user: string;
  statement: Pick<StatementWire, "borrow_shares" | "total_debt">;
  grant: Authorization;
  grantSig: SignatureArg;
  revoke: Authorization;
  revokeSig: SignatureArg;
  tx: { nonce: bigint | number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasLimit: bigint };
}): EjectCallArgs {
  return {
    cohort_id: p.cohortId,
    leaf: {
      user_id: p.note.userId,
      collateral: p.note.collateral.toString(),
      debt: p.note.debt.toString(),
      nonce: p.note.nonce.toString(),
      salt: p.note.salt,
    },
    proof: { index: p.note.proof.index, siblings: [...p.note.proof.siblings] },
    eject_args: {
      user: p.user,
      borrow_shares: minBorrowShares(p.note.debt, p.statement).toString(),
      flash_assets: flashAssetsFor(p.note.debt).toString(),
      grant: authArg(p.grant),
      grant_sig: p.grantSig,
      revoke: authArg(p.revoke),
      revoke_sig: p.revokeSig,
      tx: {
        nonce: p.tx.nonce.toString(),
        max_fee_per_gas: p.tx.maxFeePerGas.toString(),
        max_priority_fee_per_gas: p.tx.maxPriorityFeePerGas.toString(),
        gas_limit: p.tx.gasLimit.toString(),
      },
    },
  };
}

/* ---------- transaction encoding (mirror of the contract, for checking its preview) ---------- */

const helperAbi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct Authorization { address authorizer; address authorized; bool isAuthorized; uint256 nonce; uint256 deadline; }",
  "struct Signature { uint8 v; bytes32 r; bytes32 s; }",
  "function eject(MarketParams mp, address user, uint256 collateral, uint256 borrowShares, uint256 flashAssets, Authorization grant, Signature grantSig, Authorization revoke, Signature revokeSig)",
]);

const addr = (a: string) => getAddress(a.toLowerCase());
const auth = (a: AuthorizationArg) => ({
  authorizer: addr(a.authorizer),
  authorized: addr(a.authorized),
  isAuthorized: a.is_authorized,
  nonce: BigInt(a.nonce),
  deadline: BigInt(a.deadline),
});
const sig = (s: SignatureArg) => ({ v: s.v, r: s.r as Hex, s: s.s as Hex });

export function ejectCalldata(c: CohortConfigWire, a: EjectCallArgs): Hex {
  return encodeFunctionData({
    abi: helperAbi,
    functionName: "eject",
    args: [
      { loanToken: addr(c.loan_token), collateralToken: addr(c.collateral_token), oracle: addr(c.oracle), irm: addr(c.irm), lltv: BigInt(c.lltv) },
      addr(a.eject_args.user),
      BigInt(a.leaf.collateral),
      BigInt(a.eject_args.borrow_shares),
      BigInt(a.eject_args.flash_assets),
      auth(a.eject_args.grant),
      sig(a.eject_args.grant_sig),
      auth(a.eject_args.revoke),
      sig(a.eject_args.revoke_sig),
    ],
  });
}

/** The EIP-1559 transaction the contract builds: from the cohort address to the EjectHelper, value 0, no access list. */
export function ejectTx(c: CohortConfigWire, a: EjectCallArgs) {
  return {
    type: "eip1559" as const,
    chainId: c.base_chain_id,
    nonce: Number(a.eject_args.tx.nonce),
    maxFeePerGas: BigInt(a.eject_args.tx.max_fee_per_gas),
    maxPriorityFeePerGas: BigInt(a.eject_args.tx.max_priority_fee_per_gas),
    gas: BigInt(a.eject_args.tx.gas_limit),
    to: addr(c.eject_helper),
    value: 0n,
    data: ejectCalldata(c, a),
    accessList: [] as const,
  };
}

export function unsignedEjectTx(c: CohortConfigWire, a: EjectCallArgs): Hex {
  return serializeTransaction(ejectTx(c, a));
}

/** What the MPC network signs: keccak256(0x02 || rlp(fields)). */
export const payloadHash = (unsigned: Hex): Hex => keccak256(unsigned);

/* ---------- signed transaction assembly ---------- */

/** r, s and y parity from a v1.signer response. big_r is a compressed point whose x coordinate is r. */
export function signatureParts(r: SignResponse): { r: Hex; s: Hex; yParity: number } {
  const big = r.big_r.affine_point.replace(/^0x/, "");
  if (big.length !== 66) throw new Error("big_r must be a 33 byte compressed point");
  const s = r.s.scalar.replace(/^0x/, "");
  if (s.length !== 64) throw new Error("s must be 32 bytes");
  return { r: ("0x" + big.slice(2)) as Hex, s: ("0x" + s) as Hex, yParity: r.recovery_id };
}

/** Builds the broadcastable transaction from the unsigned tx and the MPC signature, in the browser. */
export function assembleSigned(c: CohortConfigWire, a: EjectCallArgs, r: SignResponse): Hex {
  return serializeTransaction(ejectTx(c, a), signatureParts(r));
}

export const txHashOf = (signed: Hex): Hex => keccak256(signed);

/* ---------- reading the NEAR result ---------- */

interface FinalOutcomeLike {
  status?: { SuccessValue?: string; Failure?: unknown } | string;
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  receipts_outcome?: { outcome?: { logs?: string[]; status?: { SuccessValue?: string; Failure?: unknown } } }[];
}

function b64json<T>(b64: string): T | null {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))) as T;
  } catch {
    return null;
  }
}

/** Pulls the EjectOutcome out of a NEAR final execution outcome. Throws with the contract's reason on failure. */
export function parseEjectOutcome(o: FinalOutcomeLike): EjectOutcome {
  const st = o.status;
  if (st && typeof st === "object" && "Failure" in st && st.Failure) {
    throw new Error(`offmap.near refused the eject: ${failureText(st.Failure)}`);
  }
  if (st && typeof st === "object" && typeof st.SuccessValue === "string") {
    const v = b64json<EjectOutcome>(st.SuccessValue);
    if (v && "payload_hash" in v) return v;
  }
  for (const r of o.receipts_outcome ?? []) {
    const v = r.outcome?.status?.SuccessValue ? b64json<EjectOutcome>(r.outcome.status.SuccessValue) : null;
    if (v && "payload_hash" in v) return v;
  }
  throw new Error("The NEAR result did not contain an eject outcome.");
}

function failureText(f: unknown): string {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/) ?? s.match(/"ExecutionError":"([^"]+)"/);
  return m ? m[1]! : s.slice(0, 300);
}

export const userIdForEvm = (address: string): string => keccak256(toBytes(`evm:${address.toLowerCase()}`)).toLowerCase();
