# offmapfi.near

The NEAR contract behind Offmap. It accepts solvency statements from an attested agent, is the only path to a chain signature for a cohort's Base account, and lets any user eject their share with a Merkle proof whether the agent is alive or not. Rules are set at `new(config)`. A config change (for example new agent code) waits 24 hours in public before anyone can apply it, and winding the contract down needs a 48 hour notice with every cohort empty.

## Methods

| Method | Who | Does |
|---|---|---|
| `new(config)` | the contract account, once | Fixes MPC contract, intents contract, cohorts (Morpho market params; `market_id` must equal `keccak256(abi.encode(params))`), approved TEE measurements and PPIDs, attestation expiry, statement max age, recovery delay, eject gas bounds, `dev_mode` |
| `register_agent(attestation)` | the agent (shade-agent-js `register()`) | Verifies the Dstack TDX attestation with `shade-attestation` (report data = agent implicit account id). New agents attach 0.005 NEAR for storage. Adds the agent key to intents.near (below) |
| `whitelist_agent_dev(account_id)` | deployer, `dev_mode` only | Lets a local agent register with the mock attestation |
| `prune_agents()` | anyone | Removes agents whose attestation expired and removes their intents keys |
| `submit_statement(stmt)` | valid agent | Per cohort, strictly increasing `batch_id`, timestamp within max age, padded `leaf_count`, `total_debt <= size_cap_loan`, `total_debt * 10000 <= ceiling_bps * collateral_value_loan`. Emits a `statement` event |
| `request_signature(cohort_id, payload_hex)` | valid agent | Needs a statement for that cohort accepted within max age and normal mode. Calls `sign` on the MPC contract with path `cohort:<id>`, 1 yocto, returns `{big_r, s, recovery_id}` |
| `eject(cohort_id, leaf, proof, eject_args)` | anyone | See below. Returns `{leaf_hash, payload_hash, unsigned_tx, signature, signed_tx}`; `signed_tx` is ready for `eth_sendRawTransaction` on Base |
| `begin_batch(cohort_id)` / `end_batch(cohort_id)` | valid agent | Opens and closes the batch lock. Signatures for a cohort are given only inside a lock; ejects wait while it is open (30 minutes at most) |
| `propose_config(config)` / `cancel_config()` | the contract account | Announces a new config; it can be applied 24 hours later. Dev mode can never be switched back on |
| `apply_config()` | anyone | Applies the announced config once its notice has passed |
| `sweep()` | the contract account | Moves spare NEAR above what storage needs |
| `announce_wind_down(code_hash)` / `wind_down(code)` | the contract account | Replaces the code only after a 48 hour notice and only when every cohort holds nothing |
| `recover()` | anyone | After `recovery_delay_ms` without a statement in any cohort: recovery mode, permanently |

Views: `config`, `mode`, `pending_config`, `batch_status`, `agent` / `get_agent`, `get_agents`, `get_contract_info`, `get_approved_measurements`, `get_whitelisted_agents_for_local`, `statement`, `statements`, `ejected(leaf_hash)`, `ejects(cohort_id)`, `cohort_address_path`, `last_statement_ms`, `eject_tx_preview(...)`.

Events are NEP 297 logs with standard `offmap`: `agent_registered`, `agent_removed`, `intents_key`, `statement`, `signature_requested`, `eject_requested`, `eject_signed`, `eject_failed`, `recovery`.

## The confidential balance belongs to the contract

The confidential Intents balance is owned by this contract account, not by the agent's TEE account, so funds survive any agent restart. The agent only holds a signing key for it:

1. `register_agent` derives the agent's ed25519 key from its implicit account id (the id is the hex of the key) and calls `intents.near.add_public_key({public_key})` with 1 yocto. The agent then signs intents with `signer_id` = this contract.
2. A key stops being valid when its attestation expires. `prune_agents()` (and every new registration) removes expired agents and calls `remove_public_key` for each.
3. `recover()` removes every agent and every agent key, so nothing can move the confidential balance. Statements stay readable for ejects.

## Eject

1. The leaf is hashed exactly as `packages/core/src/merkle.ts` does and checked against the latest root of the cohort (`proof.siblings.length == log2(leaf_count)`).
2. The leaf's `user_id` must be `keccak256("evm:" + user)` for the destination address given, or `keccak256("near:" + caller)` when a NEAR user calls it themselves. A copied note cannot redirect the position.
3. Collateral passed to the helper is the leaf collateral exactly. `borrow_shares` must cover at least `leaf.debt * stmt.borrow_shares / stmt.total_debt` (rounded up) and `flash_assets >= leaf.debt`.
4. Both Morpho authorizations must be by the user, for the cohort's EjectHelper, grant then revoke with consecutive nonces.
5. Gas limit and max fee are bounded by config; the chain id is the cohort's.
6. The leaf hash is marked spent before signing, and the user is blocked until a newer statement. If the MPC call fails, the marks are released.

The transaction is EIP 1559 to `EjectHelper.eject(MarketParams,address,uint256,uint256,uint256,Authorization,Signature,Authorization,Signature)`, value 0, empty access list; the signed payload is `keccak256(0x02 || rlp(fields))`. `eject_tx_preview` runs every check and returns the same encoding without signing.

## Build and test

```sh
cargo test                                                     # 69 tests, host
cargo near build non-reproducible-wasm --no-abi
npx tsx contracts/near/tests/gen-fixtures.ts                   # from the repo root: refresh fixtures
node contracts/near/scripts/testnet-smoke.mjs <contract> <agent> <funder> [recovery_ms]
```

`shade-attestation` pulls in `ring`, which needs a C compiler that targets wasm32. Any clang with wasm32 support works (set `CC_wasm32_unknown_unknown` and `AR_wasm32_unknown_unknown`), or `zig cc`. The reproducible Docker build of cargo near already has one.

`tests/fixtures.json` holds a cohort tree built with `@offmap/core` and an eject transaction encoded by viem; the unit tests check the contract against both byte for byte. Testnet runs are in [TESTNET.md](TESTNET.md).
