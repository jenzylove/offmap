use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, PublicKey};
use shade_attestation::measurements::FullMeasurementsHex;

use crate::Ppid;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct CohortConfig {
    pub id: String,
    /// Morpho market id (bytes32 hex); must equal keccak256(abi.encode(market params)).
    pub market_id: String,
    pub loan_token: String,
    pub collateral_token: String,
    pub oracle: String,
    pub irm: String,
    pub lltv: U128,
    pub base_chain_id: u64,
    pub eject_helper: String,
    /// Maximum cohort total debt, loan token smallest units.
    pub size_cap_loan: U128,
    /// Maximum total_debt / collateral_value_loan, in bps.
    pub ceiling_bps: u32,
}

#[near(serializers = [borsh, json])]
pub struct Config {
    pub mpc_contract_id: AccountId,
    /// Holds the confidential balance owned by this contract (intents.near).
    pub intents_contract: AccountId,
    pub cohorts: Vec<CohortConfig>,
    pub approved_measurements: Vec<FullMeasurementsHex>,
    pub approved_ppids: Vec<Ppid>,
    pub attestation_expiry_ms: U64,
    pub statement_max_age_ms: U64,
    pub recovery_delay_ms: U64,
    pub eject_min_gas_limit: U64,
    pub eject_max_gas_limit: U64,
    pub eject_max_fee_per_gas: U128,
    pub dev_mode: bool,
    /// Agents whitelisted at init (dev_mode only).
    #[serde(default)]
    pub dev_agents: Vec<AccountId>,
}

#[near(serializers = [borsh])]
pub struct Agent {
    pub measurements: FullMeasurementsHex,
    pub ppid: Ppid,
    pub valid_until_ms: u64,
    pub public_key: PublicKey,
}

/// Same shape as the Shade Agent reference contract (`Valid` | `{"Invalid": [...]}`).
#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub enum AgentValidity {
    Valid,
    Invalid(Vec<String>),
}

#[near(serializers = [json])]
pub struct AgentView {
    pub account_id: AccountId,
    pub measurements: FullMeasurementsHex,
    pub ppid: Ppid,
    pub valid_until_ms: U64,
    pub public_key: PublicKey,
    pub validity: AgentValidity,
}

#[near(serializers = [json])]
pub struct ContractInfo {
    pub requires_tee: bool,
    pub attestation_expiration_time_ms: U64,
    pub mpc_contract_id: AccountId,
    pub intents_contract: AccountId,
    pub mode: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Statement {
    pub cohort_id: String,
    pub batch_id: U64,
    pub total_collateral: U128,
    pub total_debt: U128,
    pub reserve: U128,
    /// Agent's median priced value of total_collateral in loan units; used for the ceiling check.
    pub collateral_value_loan: U128,
    /// Morpho borrow shares of the cohort position at this batch; bounds the shares an eject repays.
    pub borrow_shares: U128,
    pub merkle_root: String,
    /// Padded leaf count (power of two, at least 1024).
    pub leaf_count: u32,
    pub timestamp_ms: U64,
}

#[near(serializers = [borsh, json])]
pub struct StoredStatement {
    pub statement: Statement,
    pub accepted_at_ms: u64,
    pub agent: AccountId,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct Leaf {
    /// Exactly the userId string the agent hashed (lowercase hex of keccak256 of the owner auth string).
    pub user_id: String,
    pub collateral: U128,
    pub debt: U128,
    pub nonce: U128,
    pub salt: String,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct Proof {
    pub index: u32,
    pub siblings: Vec<String>,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct AuthorizationArg {
    pub authorizer: String,
    pub authorized: String,
    pub is_authorized: bool,
    pub nonce: U128,
    pub deadline: U128,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct SignatureArg {
    pub v: u8,
    pub r: String,
    pub s: String,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct EjectTxArgs {
    pub nonce: U64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub gas_limit: U64,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct EjectArgs {
    /// The user's own Base wallet that receives the position.
    pub user: String,
    pub borrow_shares: U128,
    pub flash_assets: U128,
    pub grant: AuthorizationArg,
    pub grant_sig: SignatureArg,
    pub revoke: AuthorizationArg,
    pub revoke_sig: SignatureArg,
    pub tx: EjectTxArgs,
}

/// The eject transaction, carried to the signing callback.
#[near(serializers = [json])]
pub struct TxParts {
    pub chain_id: U64,
    pub nonce: U64,
    pub max_priority_fee_per_gas: U128,
    pub max_fee_per_gas: U128,
    pub gas_limit: U64,
    pub to: String,
    pub data: String,
}

#[near(serializers = [json])]
pub struct AffinePoint {
    pub affine_point: String,
}

#[near(serializers = [json])]
pub struct Scalar {
    pub scalar: String,
}

/// v1.signer response for an ECDSA request.
#[near(serializers = [json])]
pub struct SignResponse {
    pub big_r: AffinePoint,
    pub s: Scalar,
    pub recovery_id: u8,
}

#[near(serializers = [json])]
pub struct EjectOutcome {
    pub leaf_hash: String,
    pub payload_hash: String,
    pub unsigned_tx: String,
    pub signature: Option<SignResponse>,
    /// Ready to broadcast on Base (eth_sendRawTransaction) by anyone.
    pub signed_tx: Option<String>,
}

#[near(serializers = [json])]
pub struct EjectPreview {
    pub leaf_hash: String,
    pub payload_hash: String,
    pub unsigned_tx: String,
}

#[near(serializers = [borsh, json])]
pub struct EjectRecord {
    pub cohort_id: String,
    pub leaf_hash: String,
    pub user: String,
    pub collateral: U128,
    pub debt: U128,
    pub batch_id: U64,
    pub tx_nonce: U64,
    pub signed_tx: String,
    pub at_ms: U64,
}
