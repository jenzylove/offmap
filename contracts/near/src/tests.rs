use super::*;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::testing_env;
use serde_json::Value;

const FIXTURES: &str = include_str!("../tests/fixtures.json");
const T0: u64 = 1_800_000_000_000; // ms
const MAX_AGE: u64 = 60 * 60 * 1000;
const RECOVERY: u64 = 3 * 24 * 60 * 60 * 1000;
const EXPIRY: u64 = 7 * 24 * 60 * 60 * 1000;

fn fx() -> Value {
    serde_json::from_str(FIXTURES).unwrap()
}

fn from<T: near_sdk::serde::de::DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap()
}

fn deployer() -> AccountId {
    "offmap.testnet".parse().unwrap()
}
fn agent_id() -> AccountId {
    "ab".repeat(32).parse().unwrap()
}
fn other_agent() -> AccountId {
    "cd".repeat(32).parse().unwrap()
}

fn ctx(predecessor: AccountId, now_ms: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(deployer())
        .predecessor_account_id(predecessor)
        .block_timestamp(now_ms * 1_000_000)
        .attached_deposit(deposit)
        .build());
}

fn config(dev: bool) -> Config {
    Config {
        mpc_contract_id: "v1.signer-prod.testnet".parse().unwrap(),
        intents_contract: "intents.near".parse().unwrap(),
        cohorts: vec![from(&fx()["cohort"])],
        approved_measurements: if dev { vec![] } else { vec![create_mock_full_measurements_hex()] },
        approved_ppids: vec![],
        attestation_expiry_ms: U64(EXPIRY),
        statement_max_age_ms: U64(MAX_AGE),
        recovery_delay_ms: U64(RECOVERY),
        eject_min_gas_limit: U64(300_000),
        eject_max_gas_limit: U64(3_000_000),
        eject_max_fee_per_gas: U128(50_000_000_000),
        dev_mode: dev,
        dev_agents: vec![],
    }
}

fn storage() -> NearToken {
    NearToken::from_millinear(5)
}

fn mock_attestation() -> DstackAttestation {
    // The fake attestation shade-agent-js sends in local mode.
    serde_json::from_value(serde_json::json!({
        "quote": [],
        "collateral": {
            "pck_crl_issuer_chain": "", "root_ca_crl": "", "pck_crl": "", "tcb_info_issuer_chain": "",
            "tcb_info": "", "tcb_info_signature": "", "qe_identity_issuer_chain": "", "qe_identity": "",
            "qe_identity_signature": ""
        },
        "tcb_info": {
            "mrtd": "0".repeat(96), "rtmr0": "0".repeat(96), "rtmr1": "0".repeat(96), "rtmr2": "0".repeat(96),
            "rtmr3": "0".repeat(96), "os_image_hash": "", "compose_hash": "0".repeat(64),
            "device_id": "0".repeat(64), "app_compose": "", "event_log": []
        }
    }))
    .expect("shade-agent-js fake attestation shape")
}

/// Deployed in dev mode with one registered agent.
fn setup() -> Contract {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut c = Contract::new(config(true));
    c.whitelist_agent_dev(agent_id());
    ctx(agent_id(), T0, storage());
    assert!(c.register_agent(mock_attestation()));
    c
}

fn stmt(batch: u64, now: u64) -> Statement {
    let mut s: Statement = from(&fx()["statement"]);
    s.batch_id = U64(batch);
    s.timestamp_ms = U64(now);
    s
}

/// setup() plus the fixture statement accepted at T0.
fn with_statement() -> Contract {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    c.submit_statement(stmt(1, T0));
    ctx("relayer.testnet".parse().unwrap(), T0 + 1, EJECT_DEPOSIT);
    c
}

fn leaf() -> Leaf {
    from(&fx()["leaf"])
}
fn proof() -> Proof {
    from(&fx()["proof"])
}
fn args() -> EjectArgs {
    from(&fx()["eject_args"])
}

fn calls() -> Vec<(String, String, Vec<u8>, NearToken)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => {
                    Some((to.clone(), String::from_utf8(method_name).unwrap(), args, attached_deposit))
                }
                _ => None,
            })
        })
        .collect()
}

// ---------------- agents and intents keys ----------------

#[test]
fn register_adds_intents_key_for_the_implicit_account() {
    setup();
    let c = calls();
    assert_eq!(c.len(), 1);
    let (to, method, args, dep) = &c[0];
    assert_eq!((to.as_str(), method.as_str()), ("intents.near", "add_public_key"));
    assert_eq!(*dep, NearToken::from_yoctonear(1));
    let pk = PublicKey::from_parts(CurveType::ED25519, hex::decode("ab".repeat(32)).unwrap()).unwrap();
    let v: Value = serde_json::from_slice(args).unwrap();
    assert_eq!(v["public_key"], serde_json::to_value(&pk).unwrap());
    assert!(v["public_key"].as_str().unwrap().starts_with("ed25519:"));
}

#[test]
fn re_register_needs_no_deposit_and_adds_no_key() {
    let mut c = setup();
    ctx(agent_id(), T0 + 1000, NearToken::from_yoctonear(0));
    c.register_agent(mock_attestation());
    assert!(calls().iter().all(|x| x.1 != "add_public_key"));
    assert_eq!(c.get_agent(agent_id()).unwrap().valid_until_ms, U64(T0 + 1000 + EXPIRY));
}

#[test]
#[should_panic(expected = "attach at least")]
fn register_requires_storage_deposit() {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut c = Contract::new(config(true));
    c.whitelist_agent_dev(agent_id());
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    c.register_agent(mock_attestation());
}

#[test]
#[should_panic(expected = "not whitelisted")]
fn dev_register_requires_whitelist() {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut c = Contract::new(config(true));
    ctx(agent_id(), T0, storage());
    c.register_agent(mock_attestation());
}

#[test]
#[should_panic(expected = "implicit account")]
fn agent_must_be_implicit() {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut c = Contract::new(config(true));
    c.whitelist_agent_dev("bob.testnet".parse().unwrap());
    ctx("bob.testnet".parse().unwrap(), T0, storage());
    c.register_agent(mock_attestation());
}

#[test]
#[should_panic(expected = "only the deployer")]
fn only_deployer_whitelists() {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut c = Contract::new(config(true));
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    c.whitelist_agent_dev(agent_id());
}

#[test]
#[should_panic(expected = "dev mode is off")]
fn no_whitelist_without_dev_mode() {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut c = Contract::new(config(false));
    c.whitelist_agent_dev(agent_id());
}

#[test]
#[should_panic(expected = "attestation verification failed")]
fn tee_mode_rejects_fake_attestation() {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut c = Contract::new(config(false));
    assert!(c.get_contract_info().requires_tee);
    ctx(agent_id(), T0, storage());
    c.register_agent(mock_attestation());
}

#[test]
fn prune_removes_expired_agents_and_their_keys() {
    let mut c = setup();
    ctx(agent_id(), T0 + EXPIRY / 2, NearToken::from_yoctonear(0));
    assert_eq!(c.prune_agents(), 0);
    assert!(calls().is_empty());

    ctx(other_agent(), T0 + EXPIRY + 1, NearToken::from_yoctonear(0));
    assert_eq!(c.prune_agents(), 1);
    let c2 = calls();
    assert_eq!(c2.len(), 1);
    assert_eq!((c2[0].0.as_str(), c2[0].1.as_str()), ("intents.near", "remove_public_key"));
    assert!(c.get_agent(agent_id()).is_none());
}

#[test]
fn new_registration_prunes_expired_agents() {
    let mut c = setup();
    ctx(deployer(), T0 + EXPIRY + 1, NearToken::from_yoctonear(0));
    c.whitelist_agent_dev(other_agent());
    ctx(other_agent(), T0 + EXPIRY + 1, storage());
    c.register_agent(mock_attestation());
    let methods: Vec<String> = calls().into_iter().map(|x| x.1).collect();
    assert_eq!(methods, vec!["remove_public_key", "add_public_key"]);
    assert!(c.get_agent(agent_id()).is_none());
    assert!(c.get_agent(other_agent()).is_some());
}

#[test]
fn get_agent_shape_matches_shade_reference() {
    let c = setup();
    let v = serde_json::to_value(c.get_agent(agent_id()).unwrap()).unwrap();
    assert_eq!(v["validity"], Value::String("Valid".into()));
    assert!(v["measurements"]["rtmrs"]["mrtd"].is_string());
    assert!(v["valid_until_ms"].is_string());
    assert!(c.get_agent(other_agent()).is_none());
    assert_eq!(c.get_whitelisted_agents_for_local(), vec![agent_id()]);
}

// ---------------- statements ----------------

#[test]
#[should_panic(expected = "agent not registered")]
fn unregistered_agent_cannot_submit() {
    let mut c = setup();
    ctx(other_agent(), T0, NearToken::from_yoctonear(0));
    c.submit_statement(stmt(1, T0));
}

#[test]
#[should_panic(expected = "invalid agent: expired_attestation")]
fn expired_agent_cannot_submit() {
    let mut c = setup();
    ctx(agent_id(), T0 + EXPIRY + 1, NearToken::from_yoctonear(0));
    c.submit_statement(stmt(1, T0 + EXPIRY + 1));
}

#[test]
fn statement_is_stored_with_event() {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    c.submit_statement(stmt(1, T0));
    assert!(get_logs().iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains("\"event\":\"statement\"")));
    let s = c.statement("cbbtc-usdc".into()).unwrap();
    assert_eq!(s.statement.collateral_value_loan, from::<Statement>(&fx()["statement"]).collateral_value_loan);
    assert_eq!(c.last_statement_ms(), U64(T0));
}

#[test]
#[should_panic(expected = "batch_id must increase")]
fn batch_must_increase() {
    let mut c = with_statement();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    c.submit_statement(stmt(1, T0));
}

#[test]
#[should_panic(expected = "statement is stale")]
fn stale_statement_refused() {
    let mut c = setup();
    ctx(agent_id(), T0 + MAX_AGE + 1, NearToken::from_yoctonear(0));
    c.submit_statement(stmt(1, T0));
}

#[test]
#[should_panic(expected = "cohort size cap exceeded")]
fn size_cap_refused() {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    let mut s = stmt(1, T0);
    s.total_debt = U128(1_000_000_000_001);
    s.collateral_value_loan = U128(10_000_000_000_000);
    c.submit_statement(s);
}

#[test]
#[should_panic(expected = "cohort ceiling exceeded")]
fn ceiling_refused() {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    let mut s = stmt(1, T0);
    s.collateral_value_loan = U128(s.total_debt.0 * 2 - 1); // 50% ceiling, one unit short
    c.submit_statement(s);
}

#[test]
fn ceiling_boundary_accepted() {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    let mut s = stmt(1, T0);
    s.collateral_value_loan = U128(s.total_debt.0 * 2);
    c.submit_statement(s);
}

#[test]
#[should_panic(expected = "leaf_count must be a power of two")]
fn leaf_count_must_be_padded() {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    let mut s = stmt(1, T0);
    s.leaf_count = 512;
    c.submit_statement(s);
}

// ---------------- signing ----------------

#[test]
fn request_signature_calls_mpc_with_cohort_path() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
    c.request_signature("cbbtc-usdc".into(), format!("0x{}", "11".repeat(32)));
    let cs = calls();
    let (to, method, args, dep) = &cs[0];
    assert_eq!((to.as_str(), method.as_str()), ("v1.signer-prod.testnet", "sign"));
    assert_eq!(*dep, NearToken::from_yoctonear(1));
    let v: Value = serde_json::from_slice(args).unwrap();
    assert_eq!(v["request"]["path"], "cohort:cbbtc-usdc");
    assert_eq!(v["request"]["domain_id"], 0);
    assert_eq!(v["request"]["payload_v2"]["Ecdsa"], "11".repeat(32));
    assert_eq!(cs[1].1, "on_signature");
}

#[test]
#[should_panic(expected = "agent not registered")]
fn request_signature_unregistered() {
    let mut c = with_statement();
    ctx(other_agent(), T0, NearToken::from_yoctonear(0));
    c.request_signature("cbbtc-usdc".into(), format!("0x{}", "11".repeat(32)));
}

#[test]
#[should_panic(expected = "statement is stale")]
fn request_signature_stale_statement() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + MAX_AGE + 1, NearToken::from_yoctonear(0));
    c.request_signature("cbbtc-usdc".into(), format!("0x{}", "11".repeat(32)));
}

#[test]
#[should_panic(expected = "no statement for cohort")]
fn request_signature_without_statement() {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    c.request_signature("cbbtc-usdc".into(), format!("0x{}", "11".repeat(32)));
}

// ---------------- core and viem cross checks ----------------

#[test]
fn core_leaf_and_proof_verify() {
    let f = fx();
    let lh = leaf_hash("cbbtc-usdc", &leaf());
    assert_eq!(to_hex(&lh), f["leaf_hash"].as_str().unwrap());
    let root = hex32(f["statement"]["merkle_root"].as_str().unwrap(), "root");
    assert!(verify_proof(&lh, &proof(), &root));
    // A different leaf with the same proof fails.
    let other = hex32(f["other_leaf"]["leaf_hash"].as_str().unwrap(), "x");
    assert!(!verify_proof(&other, &proof(), &root));
}

#[test]
fn eject_encoding_matches_viem() {
    let c = with_statement();
    let f = fx();
    let p = c.eject_tx_preview("cbbtc-usdc".into(), leaf(), proof(), args(), None);
    assert_eq!(p.leaf_hash, f["leaf_hash"].as_str().unwrap());
    assert_eq!(p.unsigned_tx, f["expected"]["unsigned_tx"].as_str().unwrap());
    assert_eq!(p.payload_hash, f["expected"]["payload_hash"].as_str().unwrap());
}

// ---------------- eject ----------------

#[test]
fn eject_marks_leaf_and_requests_mpc_signature() {
    let mut c = with_statement();
    ctx("relayer.testnet".parse().unwrap(), T0 + 5, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    let lh = fx()["leaf_hash"].as_str().unwrap().to_string();
    assert!(c.ejected(lh.clone()));
    let cs = calls();
    let v: Value = serde_json::from_slice(&cs[0].2).unwrap();
    assert_eq!(cs[0].1, "sign");
    assert_eq!(v["request"]["path"], "cohort:cbbtc-usdc");
    let expected = fx()["expected"]["payload_hash"].as_str().unwrap().trim_start_matches("0x").to_string();
    assert_eq!(v["request"]["payload_v2"]["Ecdsa"], expected);
    assert_eq!(cs[1].1, "on_eject_signed");
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"eject_requested\"")));
}

fn fake_sig() -> SignResponse {
    SignResponse {
        big_r: AffinePoint { affine_point: format!("03{}", "aa".repeat(32)) },
        s: Scalar { scalar: "bb".repeat(32) },
        recovery_id: 1,
    }
}

fn prepared(c: &Contract) -> Prepared {
    c.prepare_eject("cbbtc-usdc", &leaf(), &proof(), &args(), None)
}

fn eject_callback(c: &mut Contract, p: Prepared, r: Result<SignResponse, PromiseError>) -> EjectOutcome {
    ctx(deployer(), T0 + 6, NearToken::from_yoctonear(0));
    let a = args();
    c.on_eject_signed("cbbtc-usdc".into(), p.leaf_hash, p.user_key, a.user, leaf().collateral, leaf().debt, U64(1), p.tx, r)
}

#[test]
fn eject_callback_returns_signed_tx() {
    let mut c = with_statement();
    let p = prepared(&c);
    let out = eject_callback(&mut c, p, Ok(fake_sig()));
    assert_eq!(out.unsigned_tx, fx()["expected"]["unsigned_tx"].as_str().unwrap());
    // fake_sig() is r = aa.., s = bb.., parity 1: viem serializes the same bytes.
    assert_eq!(out.signed_tx.unwrap(), fx()["expected"]["signed_with_fake_sig"].as_str().unwrap());
    assert_eq!(c.ejects("cbbtc-usdc".into(), None, None).len(), 1);
}

#[test]
fn failed_signature_releases_the_leaf() {
    let mut c = with_statement();
    let p = prepared(&c);
    ctx("relayer.testnet".parse().unwrap(), T0 + 5, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    let out = eject_callback(&mut c, p, Err(PromiseError::Failed));
    assert!(out.signature.is_none());
    assert!(!c.ejected(fx()["leaf_hash"].as_str().unwrap().into()));
    // and the user can try again
    ctx("relayer.testnet".parse().unwrap(), T0 + 7, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
}

#[test]
#[should_panic(expected = "leaf already ejected")]
fn double_eject_refused() {
    let mut c = with_statement();
    ctx("relayer.testnet".parse().unwrap(), T0 + 5, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
}

#[test]
#[should_panic(expected = "user already ejected")]
fn same_user_new_leaf_refused_until_next_statement() {
    let mut c = with_statement();
    ctx("relayer.testnet".parse().unwrap(), T0 + 5, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    // Pretend the leaf mark is gone (a new note for the same user against the same root).
    c.ejected_leaves.remove(&fx()["leaf_hash"].as_str().unwrap().to_string());
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
}

#[test]
#[should_panic(expected = "invalid Merkle proof")]
fn wrong_proof_refused() {
    let mut c = with_statement();
    let mut p = proof();
    p.index = 1;
    c.eject("cbbtc-usdc".into(), leaf(), p, args());
}

#[test]
#[should_panic(expected = "invalid Merkle proof")]
fn tampered_amount_refused() {
    let mut c = with_statement();
    let mut l = leaf();
    l.collateral = U128(l.collateral.0 + 1);
    c.eject("cbbtc-usdc".into(), l, proof(), args());
}

#[test]
#[should_panic(expected = "proof depth")]
fn short_proof_refused() {
    let mut c = with_statement();
    let mut p = proof();
    p.siblings.pop();
    c.eject("cbbtc-usdc".into(), leaf(), p, args());
}

#[test]
#[should_panic(expected = "not the owner of this leaf")]
fn other_destination_refused() {
    let mut c = with_statement();
    let mut a = args();
    a.user = "0x1111111111111111111111111111111111111111".into();
    c.eject("cbbtc-usdc".into(), leaf(), proof(), a);
}

#[test]
#[should_panic(expected = "borrow_shares below")]
fn too_few_shares_refused() {
    let mut c = with_statement();
    let mut a = args();
    a.borrow_shares = U128(a.borrow_shares.0 - 1);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), a);
}

#[test]
#[should_panic(expected = "gas_limit out of bounds")]
fn gas_bounds_enforced() {
    let mut c = with_statement();
    let mut a = args();
    a.tx.gas_limit = U64(30_000_000);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), a);
}

#[test]
#[should_panic(expected = "max_fee_per_gas above bound")]
fn fee_bound_enforced() {
    let mut c = with_statement();
    let mut a = args();
    a.tx.max_fee_per_gas = U128(60_000_000_000);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), a);
}

#[test]
#[should_panic(expected = "authorized must be the eject helper")]
fn grant_must_name_helper() {
    let mut c = with_statement();
    let mut a = args();
    a.grant.authorized = "0x1111111111111111111111111111111111111111".into();
    c.eject("cbbtc-usdc".into(), leaf(), proof(), a);
}

// ---------------- recovery ----------------

#[test]
#[should_panic(expected = "agent is still active")]
fn recover_too_early() {
    let mut c = with_statement();
    ctx(other_agent(), T0 + RECOVERY, NearToken::from_yoctonear(0));
    c.recover();
}

fn recovered() -> Contract {
    let mut c = with_statement();
    ctx(other_agent(), T0 + RECOVERY + 1, NearToken::from_yoctonear(0));
    c.recover();
    c
}

#[test]
fn recovery_removes_agent_keys_and_keeps_statements() {
    let c = recovered();
    let cs = calls();
    assert_eq!(cs.len(), 1);
    assert_eq!((cs[0].0.as_str(), cs[0].1.as_str()), ("intents.near", "remove_public_key"));
    assert_eq!(c.mode(), "recovery");
    assert!(c.get_agent(agent_id()).is_none());
    assert!(c.statement("cbbtc-usdc".into()).is_some());
}

#[test]
#[should_panic(expected = "recovery mode: signing closed")]
fn recovery_closes_signing() {
    let mut c = recovered();
    ctx(agent_id(), T0 + RECOVERY + 2, NearToken::from_yoctonear(0));
    c.request_signature("cbbtc-usdc".into(), format!("0x{}", "11".repeat(32)));
}

#[test]
#[should_panic(expected = "recovery mode: registration closed")]
fn recovery_closes_registration() {
    let mut c = recovered();
    ctx(agent_id(), T0 + RECOVERY + 2, storage());
    c.register_agent(mock_attestation());
}

#[test]
#[should_panic(expected = "recovery mode")]
fn recovery_closes_statements() {
    let mut c = recovered();
    ctx(agent_id(), T0 + RECOVERY + 2, NearToken::from_yoctonear(0));
    c.submit_statement(stmt(2, T0 + RECOVERY + 2));
}

#[test]
fn eject_works_in_recovery() {
    let mut c = recovered();
    ctx("relayer.testnet".parse().unwrap(), T0 + RECOVERY + 2, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    assert_eq!(calls()[0].1, "sign");
}

#[test]
#[should_panic(expected = "market_id does not match")]
fn init_checks_market_id() {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut cfg = config(true);
    cfg.cohorts[0].lltv = U128(1);
    Contract::new(cfg);
}


#[test]
#[should_panic(expected = "only the contract account itself")]
fn propose_config_refused_for_anyone_but_the_contract_account() {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    c.propose_config(config(true));
}

#[test]
#[should_panic(expected = "notice period has not passed")]
fn config_cannot_apply_before_the_notice_period() {
    let mut c = setup();
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    c.propose_config(config(true));
    ctx("anyone.testnet".parse().unwrap(), T0 + CONFIG_DELAY_MS - 1, NearToken::from_yoctonear(0));
    c.apply_config();
}

#[test]
fn config_applies_after_the_notice_period_by_anyone() {
    let mut c = setup();
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut cfg = config(true);
    cfg.recovery_delay_ms = U64(RECOVERY + 1);
    c.propose_config(cfg);
    assert!(c.pending_config().is_some());
    ctx("anyone.testnet".parse().unwrap(), T0 + CONFIG_DELAY_MS, NearToken::from_yoctonear(0));
    c.apply_config();
    assert_eq!(c.config().recovery_delay_ms.0, RECOVERY + 1);
    assert!(c.pending_config().is_none());
}

#[test]
#[should_panic(expected = "market_id does not match")]
fn proposed_config_gets_the_init_checks() {
    let mut c = setup();
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut cfg = config(true);
    cfg.cohorts[0].lltv = U128(1);
    c.propose_config(cfg);
}

#[test]
#[should_panic(expected = "only the contract account itself")]
fn sweep_only_by_the_contract_account() {
    let mut c = setup();
    ctx(agent_id(), T0, NearToken::from_yoctonear(0));
    c.sweep();
}

#[test]
#[should_panic(expected = "a cohort still holds positions")]
fn wind_down_refused_while_a_cohort_holds_positions() {
    let mut c = with_statement();
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    c.announce_wind_down(to_hex(&env::sha256_array(&[0, 97, 115, 109])));
    ctx(deployer(), T0 + WIND_DOWN_DELAY_MS, NearToken::from_yoctonear(0));
    c.wind_down(near_sdk::json_types::Base64VecU8(vec![0, 97, 115, 109]));
}

// ---------------- batch lock ----------------

#[test]
#[should_panic(expected = "open a batch first")]
fn agent_cannot_sign_outside_a_batch() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.request_signature("cbbtc-usdc".into(), format!("0x{}", "11".repeat(32)));
}

#[test]
#[should_panic(expected = "a batch is open for this cohort")]
fn eject_refused_while_a_batch_is_open() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
    ctx("relayer.testnet".parse().unwrap(), T0 + 20, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
}

#[test]
fn eject_opens_when_the_batch_ends() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
    c.end_batch("cbbtc-usdc".into());
    ctx("relayer.testnet".parse().unwrap(), T0 + 20, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    assert_eq!(calls()[0].1, "sign");
}

#[test]
fn eject_opens_when_a_lock_expires() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
    ctx("relayer.testnet".parse().unwrap(), T0 + 10 + LOCK_MS, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
}

#[test]
#[should_panic(expected = "ejects keep a window after each batch")]
fn agent_cannot_relock_inside_the_eject_window() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
    c.end_batch("cbbtc-usdc".into());
    ctx(agent_id(), T0 + 10 + EJECT_WINDOW_MS - 1, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
}

#[test]
fn agent_can_relock_after_the_eject_window() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
    c.end_batch("cbbtc-usdc".into());
    ctx(agent_id(), T0 + 10 + EJECT_WINDOW_MS, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
}

#[test]
#[should_panic(expected = "an eject is being signed")]
fn agent_cannot_lock_while_an_eject_is_being_signed() {
    let mut c = with_statement();
    ctx("relayer.testnet".parse().unwrap(), T0 + 5, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    ctx(agent_id(), T0 + 10 + EJECT_WINDOW_MS, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
}

#[test]
fn agent_can_lock_once_the_eject_signature_returned() {
    let mut c = with_statement();
    let p = prepared(&c);
    ctx("relayer.testnet".parse().unwrap(), T0 + 5, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    eject_callback(&mut c, p, Err(PromiseError::Failed));
    ctx(agent_id(), T0 + 10 + EJECT_WINDOW_MS, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
}

#[test]
#[should_panic(expected = "attach 0.02 NEAR")]
fn eject_needs_a_storage_deposit() {
    let mut c = with_statement();
    ctx("relayer.testnet".parse().unwrap(), T0 + 5, NearToken::from_yoctonear(0));
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
}

#[test]
fn a_lost_eject_signature_stops_holding_the_lock_after_the_timeout() {
    let mut c = with_statement();
    ctx("relayer.testnet".parse().unwrap(), T0 + 5, EJECT_DEPOSIT);
    c.eject("cbbtc-usdc".into(), leaf(), proof(), args());
    ctx(agent_id(), T0 + 5 + SIGN_TIMEOUT_MS, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
}

#[test]
#[should_panic(expected = "a new root needs an open batch")]
fn a_new_root_needs_the_lock() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    let mut s = stmt(2, T0 + 10);
    s.merkle_root = format!("0x{}", "77".repeat(32));
    c.submit_statement(s);
}

#[test]
fn a_new_root_inside_the_lock_is_accepted() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
    let mut s = stmt(2, T0 + 10);
    s.merkle_root = format!("0x{}", "77".repeat(32));
    c.submit_statement(s);
}

#[test]
#[should_panic(expected = "a new root needs an open batch with time left")]
fn a_new_root_refused_when_the_lock_is_about_to_expire() {
    let mut c = with_statement();
    ctx(agent_id(), T0 + 10, NearToken::from_yoctonear(0));
    c.begin_batch("cbbtc-usdc".into());
    ctx(agent_id(), T0 + 10 + LOCK_MS - STATEMENT_LOCK_MARGIN_MS + 1, NearToken::from_yoctonear(0));
    let mut s = stmt(2, T0 + 10 + LOCK_MS - STATEMENT_LOCK_MARGIN_MS + 1);
    s.merkle_root = format!("0x{}", "77".repeat(32));
    c.submit_statement(s);
}

#[test]
#[should_panic(expected = "dev mode cannot be switched on")]
fn dev_mode_cannot_be_switched_on_later() {
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    let mut c = Contract::new(config(false));
    c.propose_config(config(true));
}

#[test]
#[should_panic(expected = "code is not the announced code")]
fn wind_down_only_with_the_announced_code() {
    let mut c = setup();
    ctx(deployer(), T0, NearToken::from_yoctonear(0));
    c.announce_wind_down(to_hex(&env::sha256_array(&[1, 2, 3])));
    ctx(deployer(), T0 + WIND_DOWN_DELAY_MS, NearToken::from_yoctonear(0));
    c.wind_down(near_sdk::json_types::Base64VecU8(vec![0, 97, 115, 109]));
}
