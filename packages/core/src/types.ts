/** 0x-prefixed lowercase hex string. */
export type Hex = `0x${string}`;

/** Basis points denominator. */
export const BPS = 10_000n;

/** Price scale: 1e8 means a price of 1.0. */
export const PRICE_SCALE = 100_000_000n;

export interface Cohort {
  id: string;
  collateralAsset: string;
  collateralDecimals: number;
  loanDecimals: number;
  /** Morpho market LLTV in bps (8600). */
  lltvBps: bigint;
  /** Maximum cohort wide debt / collateral value, in bps (5000). */
  cohortCeilingBps: bigint;
  /** Maximum total debt of the cohort, in loan smallest units. */
  sizeCapLoan: bigint;
}

export interface UserPosition {
  userId: string;
  cohortId: string;
  /** Collateral in collateral smallest units. */
  collateral: bigint;
  /** Debt in loan smallest units, interest included. */
  debt: bigint;
  nonce: bigint;
  /** 32 random bytes, known only to the agent and the user's note. */
  salt: Hex;
}

/** The private state of one cohort inside the agent. */
export interface CohortLedger {
  cohort: Cohort;
  positions: Map<string, UserPosition>;
  /** Cohort reserve in loan smallest units. */
  reserve: bigint;
  /** Unix seconds of the last interest accrual. */
  lastAccrual: number;
}

export type Op =
  | { kind: "deposit"; userId: string; amount: bigint }
  | { kind: "borrow"; userId: string; amount: bigint }
  | { kind: "repay"; userId: string; amount: bigint }
  | { kind: "withdraw"; userId: string; amount: bigint }
  | { kind: "liquidate"; userId: string };

export type OpKind = Op["kind"];

export type RejectReason =
  | "zero_amount"
  | "unknown_user"
  | "insufficient_collateral"
  | "repay_exceeds_debt"
  | "ltv_exceeds_open_limit"
  | "user_cap_exceeded"
  | "cohort_size_cap_exceeded"
  | "cohort_ceiling_exceeded"
  | "not_liquidatable";

/** A published loss. It never carries a user id. */
export interface LossEvent {
  cohortId: string;
  amount: bigint;
  coveredByReserve: bigint;
  socialized: bigint;
}

export interface SolvencyStatement {
  cohortId: string;
  totalCollateral: bigint;
  totalDebt: bigint;
  reserve: bigint;
  merkleRoot: Hex;
  /** Padded leaf count of the tree. */
  leafCount: number;
  timestamp: number;
  batchId: string;
}

export interface MerkleProof {
  /** Leaf slot in the padded tree. Left or right at each level follows its bits. */
  index: number;
  /** Sibling hashes from the leaf level up to just below the root. */
  siblings: Hex[];
}

export interface Note {
  cohortId: string;
  userId: string;
  collateral: bigint;
  debt: bigint;
  nonce: bigint;
  salt: Hex;
  root: Hex;
  proof: MerkleProof;
  batchId: string;
}
