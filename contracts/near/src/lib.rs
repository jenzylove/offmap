//! offmap.near: accepts solvency statements from an attested agent, gates chain signatures for the
//! cohort accounts on Base, and lets any user eject their share with a Merkle proof, agent or not.
//! No owner and no upgrade path: everything that matters is fixed at init.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, CurveType, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PublicKey,
};
use shade_attestation::attestation::DstackAttestation;
use shade_attestation::measurements::{create_mock_full_measurements_hex, FullMeasurementsHex};
use shade_attestation::tcb_info::HexBytes;

pub mod evm;
mod types;

pub use types::*;

use evm::{address, hex32, keccak, to_hex, Authorization, EjectCall, MarketParams, Signature, Tx1559};

pub type Ppid = HexBytes<16>;

/// Storage a new agent pays for. shade-agent-js attaches 0.005 NEAR by default, which is exactly this.
const AGENT_STORAGE_BYTES: u128 = 500;
const MIN_LEAVES: u32 = 1024;
const MAX_DEPTH: u32 = 20;
const SIGN_GAS: Gas = Gas::from_tgas(15);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const INTENTS_GAS: Gas = Gas::from_tgas(10);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Agents,
    DevWhitelist,
    Statements,
    EjectedLeaves,
    EjectedUsers,
    Ejects,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    /// Account that ran `new`; may whitelist agents only when `dev_mode` is on.
    dev_admin: AccountId,
    agents: IterableMap<AccountId, Agent>,
    dev_whitelist: LookupSet<AccountId>,
    statements: IterableMap<String, StoredStatement>,
    /// Leaf hashes that have been ejected.
    ejected_leaves: LookupSet<String>,
    /// "<cohort>:<user_id>" -> batch_id of the statement the user last ejected against.
    ejected_users: LookupMap<String, u64>,
    ejects: Vector<EjectRecord>,
    /// Block time of the newest accepted statement in any cohort (init time before the first).
    last_statement_ms: u64,
    recovery: bool,
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(config: Config) -> Self {
        require!(!config.cohorts.is_empty(), "at least one cohort");
        for (i, c) in config.cohorts.iter().enumerate() {
            require!(!c.id.is_empty() && !c.id.contains(':'), "cohort id must be non empty without ':'");
            require!(config.cohorts[..i].iter().all(|o| o.id != c.id), "duplicate cohort id");
            require!(c.ceiling_bps > 0 && c.ceiling_bps <= 10_000, "ceiling_bps must be in 1..=10000");
            // The market id must be the Morpho id of the params we encode into ejects.
            require!(to_hex(&market_params(c).id()) == c.market_id.to_lowercase(), "market_id does not match market params");
            address(&c.eject_helper, "eject_helper");
        }
        require!(config.eject_min_gas_limit.0 <= config.eject_max_gas_limit.0, "eject gas bounds");
        if !config.dev_mode {
            require!(config.dev_agents.is_empty(), "dev_agents only in dev_mode");
            require!(!config.approved_measurements.is_empty(), "approved_measurements required");
        }
        let mut dev_whitelist = LookupSet::new(Key::DevWhitelist);
        for a in &config.dev_agents {
            dev_whitelist.insert(a.clone());
        }
        Self {
            config,
            dev_admin: env::predecessor_account_id(),
            agents: IterableMap::new(Key::Agents),
            dev_whitelist,
            statements: IterableMap::new(Key::Statements),
            ejected_leaves: LookupSet::new(Key::EjectedLeaves),
            ejected_users: LookupMap::new(Key::EjectedUsers),
            ejects: Vector::new(Key::Ejects),
            last_statement_ms: env::block_timestamp_ms(),
            recovery: false,
        }
    }

    // ---------------- agents ----------------

    /// Dev builds only: lets a local (non TEE) agent register with a mock attestation.
    pub fn whitelist_agent_dev(&mut self, account_id: AccountId) {
        require!(self.config.dev_mode, "dev mode is off");
        require!(env::predecessor_account_id() == self.dev_admin, "only the deployer");
        self.dev_whitelist.insert(account_id);
    }

    /// Shade Agent registration, called by the agent itself (shade-agent-js `register()`).
    /// The report data must be the agent's implicit account id, which is also its ed25519 key:
    /// that key is added to intents.near so the agent can sign intents for this contract's balance.
    #[payable]
    pub fn register_agent(&mut self, attestation: DstackAttestation) -> bool {
        require!(!self.recovery, "recovery mode: registration closed");
        let account = env::predecessor_account_id();
        let key = implicit_key(&account);
        let existing = self.agents.get(&account).is_some();
        if !existing {
            let cost = env::storage_byte_cost().saturating_mul(AGENT_STORAGE_BYTES);
            require!(env::attached_deposit() >= cost, format!("attach at least {} yocto for storage", cost.as_yoctonear()));
        }

        let (measurements, ppid) = self.verify_attestation(&account, attestation);
        self.prune_expired();

        let valid_until_ms = env::block_timestamp_ms() + self.config.attestation_expiry_ms.0;
        self.agents.insert(account.clone(), Agent { measurements, ppid, valid_until_ms, public_key: key.clone() });
        emit("agent_registered", json!({ "account_id": account, "public_key": key, "valid_until_ms": U64(valid_until_ms) }));
        if !existing {
            let _ = self.intents_key("add_public_key", &key);
        }
        true
    }

    /// Removes agents whose attestation expired, and their intents keys. Anyone can call.
    pub fn prune_agents(&mut self) -> u32 {
        self.prune_expired()
    }

    // ---------------- statements ----------------

    pub fn submit_statement(&mut self, stmt: Statement) {
        require!(!self.recovery, "recovery mode");
        let agent = self.require_valid_agent();
        let cohort = self.cohort(&stmt.cohort_id).clone();
        let now = env::block_timestamp_ms();

        if let Some(prev) = self.statements.get(&stmt.cohort_id) {
            require!(stmt.batch_id.0 > prev.statement.batch_id.0, "batch_id must increase");
        }
        require!(stmt.timestamp_ms.0 <= now, "statement timestamp is in the future");
        require!(now - stmt.timestamp_ms.0 <= self.config.statement_max_age_ms.0, "statement is stale");
        let lc = stmt.leaf_count;
        require!(lc.is_power_of_two() && lc >= MIN_LEAVES && lc <= 1 << MAX_DEPTH, "leaf_count must be a power of two >= 1024");
        hex32(&stmt.merkle_root, "merkle_root");

        let debt = stmt.total_debt.0;
        require!(debt <= cohort.size_cap_loan.0, "cohort size cap exceeded");
        let lhs = debt.checked_mul(10_000).expect("overflow");
        let rhs = (cohort.ceiling_bps as u128).checked_mul(stmt.collateral_value_loan.0).expect("overflow");
        require!(lhs <= rhs, "cohort ceiling exceeded");
        require!(debt == 0 || stmt.borrow_shares.0 > 0, "borrow_shares required when there is debt");

        emit("statement", json!({ "agent": agent, "statement": stmt }));
        self.last_statement_ms = now;
        self.statements.insert(stmt.cohort_id.clone(), StoredStatement { statement: stmt, accepted_at_ms: now, agent });
    }

    // ---------------- chain signatures ----------------

    /// Signs a 32 byte payload with the cohort key. Agent only, fresh statement, not in recovery.
    pub fn request_signature(&mut self, cohort_id: String, payload_hex: String) -> Promise {
        require!(!self.recovery, "recovery mode: signing closed");
        self.require_valid_agent();
        self.cohort(&cohort_id);
        let s = self.statements.get(&cohort_id).unwrap_or_else(|| env::panic_str("no statement for cohort"));
        require!(env::block_timestamp_ms() - s.accepted_at_ms <= self.config.statement_max_age_ms.0, "statement is stale");
        let payload = hex32(&payload_hex, "payload");
        emit("signature_requested", json!({ "cohort_id": cohort_id, "payload": to_hex(&payload) }));
        self.sign(&cohort_id, &payload)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signature())
    }

    #[private]
    pub fn on_signature(#[callback_result] r: Result<SignResponse, PromiseError>) -> SignResponse {
        r.unwrap_or_else(|_| env::panic_str("MPC sign failed"))
    }

    // ---------------- eject ----------------

    /// Permissionless exit. Verifies the leaf against the latest root, marks it spent, builds the
    /// EIP-1559 call to EjectHelper.eject and asks the MPC network to sign it with the cohort key.
    pub fn eject(&mut self, cohort_id: String, leaf: Leaf, proof: Proof, eject_args: EjectArgs) -> Promise {
        let caller = env::predecessor_account_id();
        let p = self.prepare_eject(&cohort_id, &leaf, &proof, &eject_args, Some(&caller));

        self.ejected_leaves.insert(p.leaf_hash.clone());
        self.ejected_users.insert(p.user_key.clone(), p.batch_id);
        emit("eject_requested", json!({ "cohort_id": cohort_id, "leaf_hash": p.leaf_hash, "user": eject_args.user, "collateral": leaf.collateral, "debt": leaf.debt, "batch_id": U64(p.batch_id), "payload": to_hex(&p.payload) }));

        self.sign(&cohort_id, &p.payload).then(
            Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_eject_signed(
                cohort_id,
                p.leaf_hash,
                p.user_key,
                eject_args.user,
                leaf.collateral,
                leaf.debt,
                U64(p.batch_id),
                p.tx,
            ),
        )
    }

    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn on_eject_signed(
        &mut self,
        cohort_id: String,
        leaf_hash: String,
        user_key: String,
        user: String,
        collateral: U128,
        debt: U128,
        batch_id: U64,
        tx: TxParts,
        #[callback_result] r: Result<SignResponse, PromiseError>,
    ) -> EjectOutcome {
        let t = tx.to_tx();
        let unsigned_tx = to_hex(&t.unsigned());
        let payload_hash = to_hex(&t.signing_hash());
        match r {
            Ok(sig) => {
                let (y, rr, ss) = sig.parts();
                let signed_tx = to_hex(&t.signed(y, &rr, &ss));
                self.ejects.push(EjectRecord {
                    cohort_id: cohort_id.clone(),
                    leaf_hash: leaf_hash.clone(),
                    user,
                    collateral,
                    debt,
                    batch_id,
                    tx_nonce: U64(t.nonce),
                    signed_tx: signed_tx.clone(),
                    at_ms: U64(env::block_timestamp_ms()),
                });
                emit("eject_signed", json!({ "cohort_id": cohort_id, "leaf_hash": leaf_hash, "signed_tx": signed_tx }));
                EjectOutcome { leaf_hash, payload_hash, unsigned_tx, signature: Some(sig), signed_tx: Some(signed_tx) }
            }
            Err(_) => {
                // Signing failed: release the leaf so the user can retry. No signature exists, so nothing can execute.
                self.ejected_leaves.remove(&leaf_hash);
                self.ejected_users.remove(&user_key);
                emit("eject_failed", json!({ "cohort_id": cohort_id, "leaf_hash": leaf_hash }));
                EjectOutcome { leaf_hash, payload_hash, unsigned_tx, signature: None, signed_tx: None }
            }
        }
    }

    // ---------------- recovery ----------------

    /// If no statement arrived in any cohort for `recovery_delay_ms`, switch to recovery mode for good:
    /// signing closes, agents and their intents keys are removed, eject stays open.
    pub fn recover(&mut self) {
        require!(!self.recovery, "already in recovery mode");
        let idle = env::block_timestamp_ms() - self.last_statement_ms;
        require!(idle > self.config.recovery_delay_ms.0, "agent is still active");
        self.recovery = true;
        let removed: Vec<(AccountId, PublicKey)> = self.agents.iter().map(|(a, g)| (a.clone(), g.public_key.clone())).collect();
        self.agents.clear();
        for (a, key) in removed {
            emit("agent_removed", json!({ "account_id": a, "reason": "recovery" }));
            let _ = self.intents_key("remove_public_key", &key);
        }
        emit("recovery", json!({ "idle_ms": U64(idle) }));
    }

    // ---------------- views ----------------

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn mode(&self) -> &'static str {
        if self.recovery { "recovery" } else { "normal" }
    }

    pub fn agent(&self, account_id: AccountId) -> Option<AgentView> {
        self.get_agent(account_id)
    }

    /// shade-agent-js reads this to decide whether to attach the storage deposit.
    pub fn get_agent(&self, account_id: AccountId) -> Option<AgentView> {
        self.agents.get(&account_id).map(|a| self.agent_view(&account_id, a))
    }

    pub fn get_agents(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<AgentView> {
        self.agents
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .map(|(id, a)| self.agent_view(id, a))
            .collect()
    }

    pub fn get_contract_info(&self) -> ContractInfo {
        ContractInfo {
            requires_tee: !self.config.dev_mode,
            attestation_expiration_time_ms: self.config.attestation_expiry_ms,
            mpc_contract_id: self.config.mpc_contract_id.clone(),
            intents_contract: self.config.intents_contract.clone(),
            mode: self.mode().to_string(),
        }
    }

    pub fn get_approved_measurements(&self) -> &Vec<FullMeasurementsHex> {
        &self.config.approved_measurements
    }

    pub fn get_whitelisted_agents_for_local(&self) -> Vec<AccountId> {
        require!(self.config.dev_mode, "not supported when TEE is required");
        let mut v: Vec<AccountId> = self.config.dev_agents.clone();
        for a in self.agents.keys() {
            if self.dev_whitelist.contains(a) && !v.contains(a) {
                v.push(a.clone());
            }
        }
        v
    }

    pub fn is_whitelisted_dev(&self, account_id: AccountId) -> bool {
        self.config.dev_mode && self.dev_whitelist.contains(&account_id)
    }

    pub fn statement(&self, cohort_id: String) -> Option<&StoredStatement> {
        self.statements.get(&cohort_id)
    }

    pub fn statements(&self) -> Vec<&StoredStatement> {
        self.statements.values().collect()
    }

    pub fn ejected(&self, leaf_hash: String) -> bool {
        self.ejected_leaves.contains(&leaf_hash.to_lowercase())
    }

    pub fn ejects(&self, cohort_id: String, from_index: Option<u32>, limit: Option<u32>) -> Vec<&EjectRecord> {
        self.ejects
            .iter()
            .filter(|e| e.cohort_id == cohort_id)
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .collect()
    }

    pub fn cohort_address_path(&self, cohort_id: String) -> String {
        self.cohort(&cohort_id);
        format!("cohort:{cohort_id}")
    }

    pub fn last_statement_ms(&self) -> U64 {
        U64(self.last_statement_ms)
    }

    /// Runs every eject check and returns the encoding without signing. `as_account` stands in for
    /// the caller when the leaf belongs to a `near:` user.
    pub fn eject_tx_preview(
        &self,
        cohort_id: String,
        leaf: Leaf,
        proof: Proof,
        eject_args: EjectArgs,
        as_account: Option<AccountId>,
    ) -> EjectPreview {
        let p = self.prepare_eject(&cohort_id, &leaf, &proof, &eject_args, as_account.as_ref());
        let t = p.tx.to_tx();
        EjectPreview { leaf_hash: p.leaf_hash, payload_hash: to_hex(&p.payload), unsigned_tx: to_hex(&t.unsigned()) }
    }
}

// ---------------- internals ----------------

struct Prepared {
    leaf_hash: String,
    user_key: String,
    batch_id: u64,
    payload: [u8; 32],
    tx: TxParts,
}

impl Contract {
    fn cohort(&self, id: &str) -> &CohortConfig {
        self.config.cohorts.iter().find(|c| c.id == id).unwrap_or_else(|| env::panic_str("unknown cohort"))
    }

    fn verify_attestation(&self, account: &AccountId, attestation: DstackAttestation) -> (FullMeasurementsHex, Ppid) {
        if self.config.dev_mode {
            require!(self.dev_whitelist.contains(account), "agent is not whitelisted for dev mode");
            return (create_mock_full_measurements_hex(), Ppid::default());
        }
        let mut report = [0u8; 64];
        report[..32].copy_from_slice(&hex::decode(account.as_str()).expect("implicit account"));
        let expected: Vec<_> = self.config.approved_measurements.iter().cloned().map(Into::into).collect();
        match attestation.verify(report.into(), env::block_timestamp_ms() / 1000, &expected, &self.config.approved_ppids) {
            Ok(a) => (a.measurements.into(), a.ppid),
            Err(e) => env::panic_str(&format!("attestation verification failed: {e}")),
        }
    }

    fn agent_invalid_reason(&self, account: &AccountId, a: &Agent) -> Option<&'static str> {
        if a.valid_until_ms < env::block_timestamp_ms() {
            Some("expired_attestation")
        } else if self.config.dev_mode && !self.dev_whitelist.contains(account) {
            Some("not_whitelisted_for_local")
        } else if !self.config.dev_mode && !self.config.approved_measurements.contains(&a.measurements) {
            Some("invalid_measurements")
        } else {
            None
        }
    }

    fn require_valid_agent(&self) -> AccountId {
        let account = env::predecessor_account_id();
        let a = self.agents.get(&account).unwrap_or_else(|| env::panic_str("agent not registered"));
        if let Some(reason) = self.agent_invalid_reason(&account, a) {
            env::panic_str(&format!("invalid agent: {reason}"));
        }
        account
    }

    fn agent_view(&self, id: &AccountId, a: &Agent) -> AgentView {
        let validity = match self.agent_invalid_reason(id, a) {
            None => AgentValidity::Valid,
            Some(r) => AgentValidity::Invalid(vec![r.to_string()]),
        };
        AgentView {
            account_id: id.clone(),
            measurements: a.measurements.clone(),
            ppid: a.ppid.clone(),
            valid_until_ms: U64(a.valid_until_ms),
            public_key: a.public_key.clone(),
            validity,
        }
    }

    fn prune_expired(&mut self) -> u32 {
        let now = env::block_timestamp_ms();
        let expired: Vec<(AccountId, PublicKey)> = self
            .agents
            .iter()
            .filter(|(_, a)| a.valid_until_ms < now)
            .map(|(id, a)| (id.clone(), a.public_key.clone()))
            .collect();
        for (id, key) in &expired {
            self.agents.remove(id);
            emit("agent_removed", json!({ "account_id": id, "reason": "expired_attestation" }));
            let _ = self.intents_key("remove_public_key", key);
        }
        expired.len() as u32
    }

    /// add_public_key / remove_public_key on the intents contract, signed by this account, 1 yocto.
    fn intents_key(&self, method: &str, key: &PublicKey) -> Promise {
        emit("intents_key", json!({ "method": method, "public_key": key }));
        Promise::new(self.config.intents_contract.clone()).function_call(
            method.to_string(),
            serde_json::to_vec(&json!({ "public_key": key })).unwrap(),
            ONE_YOCTO,
            INTENTS_GAS,
        )
    }

    fn sign(&self, cohort_id: &str, payload: &[u8; 32]) -> Promise {
        let args = json!({ "request": { "payload_v2": { "Ecdsa": hex::encode(payload) }, "path": format!("cohort:{cohort_id}"), "domain_id": 0 } });
        Promise::new(self.config.mpc_contract_id.clone()).function_call(
            "sign".to_string(),
            serde_json::to_vec(&args).unwrap(),
            ONE_YOCTO,
            SIGN_GAS,
        )
    }

    fn prepare_eject(&self, cohort_id: &str, leaf: &Leaf, proof: &Proof, a: &EjectArgs, caller: Option<&AccountId>) -> Prepared {
        let cohort = self.cohort(cohort_id);
        let st = self.statements.get(cohort_id).unwrap_or_else(|| env::panic_str("no statement for cohort"));
        let s = &st.statement;

        // 1. leaf against the latest root
        let lh = leaf_hash(cohort_id, leaf);
        let depth = s.leaf_count.trailing_zeros() as usize;
        require!(proof.siblings.len() == depth, "proof depth does not match leaf_count");
        require!(proof.index < s.leaf_count, "proof index out of range");
        require!(verify_proof(&lh, proof, &hex32(&s.merkle_root, "root")), "invalid Merkle proof");
        let leaf_hash = to_hex(&lh);
        require!(!self.ejected_leaves.contains(&leaf_hash), "leaf already ejected");

        // 2. the leaf's owner decides the destination
        let user = address(&a.user, "user");
        let uid = leaf.user_id.trim_start_matches("0x").to_lowercase();
        let evm_uid = hex::encode(keccak(format!("evm:{}", to_hex(&user)).as_bytes()));
        let near_ok = caller.map_or(false, |c| hex::encode(keccak(format!("near:{c}").as_bytes())) == uid);
        require!(uid == evm_uid || near_ok, "user address is not the owner of this leaf");
        let user_key = format!("{cohort_id}:{uid}");
        if let Some(b) = self.ejected_users.get(&user_key) {
            require!(s.batch_id.0 > *b, "user already ejected; wait for the next statement");
        }

        // 3. amounts: collateral exactly the leaf's, debt shares at least the user's pro rata share
        require!(a.flash_assets.0 >= leaf.debt.0, "flash_assets below the leaf debt");
        if s.total_debt.0 > 0 && leaf.debt.0 > 0 {
            let min_shares = mul_div_ceil(leaf.debt.0, s.borrow_shares.0, s.total_debt.0);
            require!(a.borrow_shares.0 >= min_shares, "borrow_shares below the user's share of cohort debt");
        }

        // 4. Morpho authorizations as the helper will check them
        let helper = address(&cohort.eject_helper, "eject_helper");
        let grant = a.grant.parse("grant");
        let revoke = a.revoke.parse("revoke");
        require!(grant.authorizer == user && revoke.authorizer == user, "authorizer must be the user");
        require!(grant.authorized == helper && revoke.authorized == helper, "authorized must be the eject helper");
        require!(grant.is_authorized && !revoke.is_authorized, "grant must authorize, revoke must revoke");
        require!(revoke.nonce == grant.nonce + 1, "revoke nonce must follow grant nonce");

        // 5. tx params within bounds
        let t = &a.tx;
        let c = &self.config;
        require!(t.gas_limit.0 >= c.eject_min_gas_limit.0 && t.gas_limit.0 <= c.eject_max_gas_limit.0, "gas_limit out of bounds");
        require!(t.max_fee_per_gas.0 <= c.eject_max_fee_per_gas.0, "max_fee_per_gas above bound");
        require!(t.max_priority_fee_per_gas.0 <= t.max_fee_per_gas.0, "priority fee above max fee");

        let call = EjectCall {
            mp: market_params(cohort),
            user,
            collateral: leaf.collateral.0,
            borrow_shares: a.borrow_shares.0,
            flash_assets: a.flash_assets.0,
            grant,
            grant_sig: a.grant_sig.parse("grant_sig"),
            revoke,
            revoke_sig: a.revoke_sig.parse("revoke_sig"),
        };
        let tx = TxParts {
            chain_id: U64(cohort.base_chain_id),
            nonce: t.nonce,
            max_priority_fee_per_gas: t.max_priority_fee_per_gas,
            max_fee_per_gas: t.max_fee_per_gas,
            gas_limit: t.gas_limit,
            to: to_hex(&helper),
            data: to_hex(&call.calldata()),
        };
        Prepared { leaf_hash, user_key, batch_id: s.batch_id.0, payload: tx.to_tx().signing_hash(), tx }
    }
}

// ---------------- pure helpers ----------------

/// leaf = keccak256(keccak(cohortId) || keccak(userId) || u256 collateral || u256 debt || u256 nonce || salt)
/// Same bytes as packages/core/src/merkle.ts leafHash.
pub fn leaf_hash(cohort_id: &str, l: &Leaf) -> [u8; 32] {
    let mut b = Vec::with_capacity(192);
    b.extend_from_slice(&keccak(cohort_id.as_bytes()));
    b.extend_from_slice(&keccak(l.user_id.as_bytes()));
    b.extend_from_slice(&evm::word_u128(l.collateral.0));
    b.extend_from_slice(&evm::word_u128(l.debt.0));
    b.extend_from_slice(&evm::word_u128(l.nonce.0));
    b.extend_from_slice(&hex32(&l.salt, "salt"));
    keccak(&b)
}

/// Positional hashing: bit i of the index says whether the node is the right child at level i.
pub fn verify_proof(leaf: &[u8; 32], p: &Proof, root: &[u8; 32]) -> bool {
    let mut acc = *leaf;
    let mut i = p.index;
    for s in &p.siblings {
        let sib = hex32(s, "sibling");
        let mut buf = [0u8; 64];
        let (l, r) = if i & 1 == 1 { (&sib, &acc) } else { (&acc, &sib) };
        buf[..32].copy_from_slice(l);
        buf[32..].copy_from_slice(r);
        acc = keccak(&buf);
        i >>= 1;
    }
    &acc == root
}

fn mul_div_ceil(a: u128, b: u128, d: u128) -> u128 {
    // a*b can exceed u128 for large share counts; split to stay exact.
    let (q, r) = (a / d, a % d);
    let hi = q.checked_mul(b).expect("overflow");
    let lo = r.checked_mul(b).expect("overflow");
    hi + lo / d + if lo % d == 0 { 0 } else { 1 }
}

fn market_params(c: &CohortConfig) -> MarketParams {
    MarketParams {
        loan_token: address(&c.loan_token, "loan_token"),
        collateral_token: address(&c.collateral_token, "collateral_token"),
        oracle: address(&c.oracle, "oracle"),
        irm: address(&c.irm, "irm"),
        lltv: c.lltv.0,
    }
}

/// An implicit account id is the hex of its ed25519 public key.
fn implicit_key(account: &AccountId) -> PublicKey {
    let s = account.as_str();
    require!(s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)), "agent must be an implicit account");
    PublicKey::from_parts(CurveType::ED25519, hex::decode(s).unwrap()).unwrap()
}

/// NEP-297 event log.
fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "offmap", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

impl AuthorizationArg {
    fn parse(&self, what: &str) -> Authorization {
        Authorization {
            authorizer: address(&self.authorizer, what),
            authorized: address(&self.authorized, what),
            is_authorized: self.is_authorized,
            nonce: self.nonce.0,
            deadline: self.deadline.0,
        }
    }
}

impl SignatureArg {
    fn parse(&self, what: &str) -> Signature {
        Signature { v: self.v, r: hex32(&self.r, what), s: hex32(&self.s, what) }
    }
}

impl TxParts {
    pub fn to_tx(&self) -> Tx1559 {
        Tx1559 {
            chain_id: self.chain_id.0,
            nonce: self.nonce.0,
            max_priority_fee_per_gas: self.max_priority_fee_per_gas.0,
            max_fee_per_gas: self.max_fee_per_gas.0,
            gas_limit: self.gas_limit.0,
            to: address(&self.to, "to"),
            value: 0,
            data: evm::hex_bytes(&self.data, "data"),
        }
    }
}

impl SignResponse {
    /// (y parity, r, s) from the MPC response; big_r is a compressed point whose x is r.
    pub fn parts(&self) -> (u8, [u8; 32], [u8; 32]) {
        let big_r = evm::hex_bytes(&self.big_r.affine_point, "big_r");
        require!(big_r.len() == 33, "big_r must be a compressed point");
        let r: [u8; 32] = big_r[1..].try_into().unwrap();
        (self.recovery_id, r, hex32(&self.s.scalar, "s"))
    }
}

#[cfg(test)]
#[allow(unused_must_use)]
mod tests;
