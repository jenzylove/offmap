# Testnet smoke runs

NEAR testnet only, dev mode (local agent whitelisted, mock attestation exactly as shade-agent-js sends it), MPC `v1.signer-prod.testnet`. Produced by `node contracts/near/scripts/testnet-smoke.mjs`; raw results in `scripts/<contract>.run.json`. Built 2026-11-08 with `cargo near build non-reproducible-wasm --no-abi` (797,257 bytes, sha256 `75c53c3b04b6be1e069dbcfb8be12d39e9e6b500db3c3feae061aef69a4c616c`).

The eject uses the fixture note from `tests/fixtures.json` (tree built by packages/core, transaction encoded by viem). The EjectHelper address in the fixture is a placeholder (`0x...0e1ec7`) because these runs came before the helper was deployed (it is now live on Base at `0x262fe96b235be762dca8cc1937a542848e12f8b8`), so the signed eject transactions are real signatures over a transaction that is not meant to be broadcast.

`intents_contract` is `intents.near`, which does not exist on testnet: the `add_public_key` / `remove_public_key` receipts are created as designed and fail with AccountDoesNotExist (visible in the register and recover transactions).

## Run 1: full flow (recovery delay 3 days)

- Contract: `offmap-dev-153243.testnet`
- Agent (implicit): `8c3b9d669877a9275f9d73c9960bf16c69abbbbb84f199ac9f72c25bbde87aac`
- Relayer / funder: `offmap-fund-53656.testnet`
- Cohort `cbbtc-usdc` Base address derived from `offmap-dev-153243.testnet` path `cohort:cbbtc-usdc`: `0xB3fad03F0FB28603b48446FC256E11eBF780383b`
- Signed eject tx recovers to: `0xB3fad03F0FB28603b48446FC256E11eBF780383b` (matches)
- `eject_tx_preview` payload hash: `0xe591758b653f5f9602796406c6ee7e190ca969f5c21cc380439dc55c9fc8131c` (equals viem)

| Step | Result | Tx |
|---|---|---|
| fund agent 2 NEAR | ok | [`A5LkGR2kW4N2Fv4gjPDgpQWgKAy7pz2e8JJY6FgkAB5`](https://testnet.nearblocks.io/txns/A5LkGR2kW4N2Fv4gjPDgpQWgKAy7pz2e8JJY6FgkAB5) |
| fund contract 3 NEAR | ok | [`88ocrWKRhLnefunA8P516rAaiB3qUibvJhviQ5qZ5fM8`](https://testnet.nearblocks.io/txns/88ocrWKRhLnefunA8P516rAaiB3qUibvJhviQ5qZ5fM8) |
| deploy + new(config) | ok | [`68P8Ep8oeknuWjWGLTWdQ8uy7LVVrtNPPJ2qo1TjLyuC`](https://testnet.nearblocks.io/txns/68P8Ep8oeknuWjWGLTWdQ8uy7LVVrtNPPJ2qo1TjLyuC) |
| register_agent before whitelist (refused) | refused: agent is not whitelisted for dev mode | [`D4wpNQcq9Gwame6ebQJmm2wTKhSp8NX57dyy8CH9sfZk`](https://testnet.nearblocks.io/txns/D4wpNQcq9Gwame6ebQJmm2wTKhSp8NX57dyy8CH9sfZk) |
| whitelist_agent_dev | ok | [`CxfDRYWg5ZMpXaqJXioCwsrAwuS1rx4ynrdwbkSZBk4U`](https://testnet.nearblocks.io/txns/CxfDRYWg5ZMpXaqJXioCwsrAwuS1rx4ynrdwbkSZBk4U) |
| whitelist_agent_dev by a stranger (refused) | refused: only the deployer | [`9VyadMT6qksG84cyV6AvMZBpf3ZT572XusYNdy3nfMSv`](https://testnet.nearblocks.io/txns/9VyadMT6qksG84cyV6AvMZBpf3ZT572XusYNdy3nfMSv) |
| register_agent (0.005 NEAR, adds intents key) | ok (intents receipt failed: account does not exist on testnet) | [`GqVWoEbrvCCqcDtsS77egJKv9NdWKBw8ydfReWfBCE9T`](https://testnet.nearblocks.io/txns/GqVWoEbrvCCqcDtsS77egJKv9NdWKBw8ydfReWfBCE9T) |
| submit_statement by unregistered account (refused) | refused: agent not registered | [`5kvvv71rdKVeTReKu7pez4xz95wXEzUChjdRZ2opUryw`](https://testnet.nearblocks.io/txns/5kvvv71rdKVeTReKu7pez4xz95wXEzUChjdRZ2opUryw) |
| submit_statement batch 1 | ok | [`6eLZVPkMyTSTLTi3FNZ8GN3Ec8Qhj8fEbrTbKjSPp4c8`](https://testnet.nearblocks.io/txns/6eLZVPkMyTSTLTi3FNZ8GN3Ec8Qhj8fEbrTbKjSPp4c8) |
| submit_statement batch 1 again (refused, non increasing) | refused: batch_id must increase | [`3BKqSLZ6CfSmCxyuQ5bo4E7s2kRHAJNnSBfdyMDZ1xH1`](https://testnet.nearblocks.io/txns/3BKqSLZ6CfSmCxyuQ5bo4E7s2kRHAJNnSBfdyMDZ1xH1) |
| submit_statement over ceiling (refused) | refused: cohort ceiling exceeded | [`HQShJC1y8j5jHP8m7ECx2Y7EhFuCugrtSU3yxyX3pHXB`](https://testnet.nearblocks.io/txns/HQShJC1y8j5jHP8m7ECx2Y7EhFuCugrtSU3yxyX3pHXB) |
| submit_statement stale (refused) | refused: statement is stale | [`97ZsRPQ1ato69vxStDH7WVQWfA1K34gWhnenFMVHGf3Y`](https://testnet.nearblocks.io/txns/97ZsRPQ1ato69vxStDH7WVQWfA1K34gWhnenFMVHGf3Y) |
| request_signature by unregistered account (refused) | refused: agent not registered | [`G3W8Rb3CNnwBqcP38stgifd7KWKDYS5xurG2T9Fv4YZF`](https://testnet.nearblocks.io/txns/G3W8Rb3CNnwBqcP38stgifd7KWKDYS5xurG2T9Fv4YZF) |
| request_signature (real MPC) | ok | [`9tRTCQDstZHnL7m23nWFGFv4Pikuk5RtD2c12HKEPbTc`](https://testnet.nearblocks.io/txns/9tRTCQDstZHnL7m23nWFGFv4Pikuk5RtD2c12HKEPbTc) |
| eject with wrong proof (refused) | refused: invalid Merkle proof | [`97sYTppk7jQqyZVAFp4GTVnwtJk541yXtnE5Jc1oTZio`](https://testnet.nearblocks.io/txns/97sYTppk7jQqyZVAFp4GTVnwtJk541yXtnE5Jc1oTZio) |
| eject (real MPC signature) | ok | [`HZ6AqSmEBBDGrEtCUc2uhpK5shgbkEHww7R6pAZM5Gud`](https://testnet.nearblocks.io/txns/HZ6AqSmEBBDGrEtCUc2uhpK5shgbkEHww7R6pAZM5Gud) |
| eject same leaf again (refused) | refused: leaf already ejected | [`GP8WmYanYV21EsGdUHnaE7zP6Ej7NPfLFkXmCpX1yqAx`](https://testnet.nearblocks.io/txns/GP8WmYanYV21EsGdUHnaE7zP6Ej7NPfLFkXmCpX1yqAx) |
| recover while agent active (refused) | refused: agent is still active | [`4yByXSxdFtWt9Hjb1KENotVcP4c24JLN4XL4dcwmsjxT`](https://testnet.nearblocks.io/txns/4yByXSxdFtWt9Hjb1KENotVcP4c24JLN4XL4dcwmsjxT) |

Signed eject transaction (Base, chain 8453):

```
0x02f9039282210505830f424084773594008316e3609400000000000000000000000000000000000e1ec780b90324cffc3736000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf000000000000000000000000663becd10dae6c4a3dcd89f1d76c1174199639b900000000000000000000000046415998764c29ab2a25cbea6254146d50d226870000000000000000000000000000000000000000000000000bef55718ad60000000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000002625a000000000000000000000000000000000000000000000000000022126b014100000000000000000000000000000000000000000000000000000000000241ed380000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000000e1ec7000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000070dbd880000000000000000000000000000000000000000000000000000000000000001cf2018d2faf211ed768be053f71dc44092a1971bfb8dddc6387a56a19a01ea387185a2b125e8ad4bb3926759c8e39db9f087eaa6cac271d0570861f8a7cfd3414000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000000e1ec7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000070dbd880000000000000000000000000000000000000000000000000000000000000001ba5a74f6711f31c14d928673d9e518827ff1e03da42d02809aa5aa938f6c9b7d47ad9d3145987c3894ec43a10c740ec7ecb80995f640041acc206e327f4ffe98cc080a08cf20690e56f1a419e56c9aca95a8b98ef90ae36c35ff725cd0842561ca84703a0745f7ef429dfdd662cdd3123fd2a69a4332fcc4c490e9a33e49b03d0e031133c
```

## Run 2: recovery mode (recovery delay 60 s)

- Contract: `offmap-rec-53853.testnet`
- Agent (implicit): `8c3b9d669877a9275f9d73c9960bf16c69abbbbb84f199ac9f72c25bbde87aac`
- Relayer / funder: `offmap-fundb-53853.testnet`
- Cohort `cbbtc-usdc` Base address derived from `offmap-rec-53853.testnet` path `cohort:cbbtc-usdc`: `0xe6d77f08B9e791f9828D5dc6a6caD4078C236CB8`
- Signed eject tx recovers to: `0xe6d77f08B9e791f9828D5dc6a6caD4078C236CB8` (matches)
- `eject_tx_preview` payload hash: `0xe591758b653f5f9602796406c6ee7e190ca969f5c21cc380439dc55c9fc8131c` (equals viem)

| Step | Result | Tx |
|---|---|---|
| fund agent 2 NEAR | ok | [`6UWPPGDrxBGxbjNMQG7HCbHr7Sa7xV9v7Ln9Z3ZgJ4gN`](https://testnet.nearblocks.io/txns/6UWPPGDrxBGxbjNMQG7HCbHr7Sa7xV9v7Ln9Z3ZgJ4gN) |
| fund contract 3 NEAR | ok | [`R7pHqHRmPJoKGjiXL9Nmv6VRdhifdtgZMR1kRprpMhu`](https://testnet.nearblocks.io/txns/R7pHqHRmPJoKGjiXL9Nmv6VRdhifdtgZMR1kRprpMhu) |
| deploy + new(config) | ok | [`723qQr6HMZnbhNpK8LYEGuAnNTS64PR2XaP8J95mtUDd`](https://testnet.nearblocks.io/txns/723qQr6HMZnbhNpK8LYEGuAnNTS64PR2XaP8J95mtUDd) |
| register_agent before whitelist (refused) | refused: agent is not whitelisted for dev mode | [`AwBhNgAispazSyTCTgt1QE71p73wgCzr5MH4eU7ecRS9`](https://testnet.nearblocks.io/txns/AwBhNgAispazSyTCTgt1QE71p73wgCzr5MH4eU7ecRS9) |
| whitelist_agent_dev | ok | [`9TNfUQuW3FBV47Ffa9Ez8MH4NSndvtAtvy7RYpYL44fM`](https://testnet.nearblocks.io/txns/9TNfUQuW3FBV47Ffa9Ez8MH4NSndvtAtvy7RYpYL44fM) |
| whitelist_agent_dev by a stranger (refused) | refused: only the deployer | [`A1RMu4M42iWsAAs2jv4iFx2UNzxV25Y88povjyoe5jCG`](https://testnet.nearblocks.io/txns/A1RMu4M42iWsAAs2jv4iFx2UNzxV25Y88povjyoe5jCG) |
| register_agent (0.005 NEAR, adds intents key) | ok (intents receipt failed: account does not exist on testnet) | [`3p8hbZKqMzgAmCWyiot6CpzJDVBWMnU844aLB7TKQRbx`](https://testnet.nearblocks.io/txns/3p8hbZKqMzgAmCWyiot6CpzJDVBWMnU844aLB7TKQRbx) |
| submit_statement by unregistered account (refused) | refused: agent not registered | [`DvoZhEugSACkF5a5a6dqei9YTzKrC9ZYZJHkDsbFWSRQ`](https://testnet.nearblocks.io/txns/DvoZhEugSACkF5a5a6dqei9YTzKrC9ZYZJHkDsbFWSRQ) |
| submit_statement batch 1 | ok | [`Fes26PqStRreYoAhLmWHpYSE4SPwQtPsTk4iHfMLgc4P`](https://testnet.nearblocks.io/txns/Fes26PqStRreYoAhLmWHpYSE4SPwQtPsTk4iHfMLgc4P) |
| submit_statement batch 1 again (refused, non increasing) | refused: batch_id must increase | [`H2P47Q5FNHAnSUEhbejD5YXpBZRJhow2zRwoH6o14qJw`](https://testnet.nearblocks.io/txns/H2P47Q5FNHAnSUEhbejD5YXpBZRJhow2zRwoH6o14qJw) |
| submit_statement over ceiling (refused) | refused: cohort ceiling exceeded | [`3Dkhrr8YLx1fRSMzuqoRb6eG3U7gEFtMZBJpVBFjdnLs`](https://testnet.nearblocks.io/txns/3Dkhrr8YLx1fRSMzuqoRb6eG3U7gEFtMZBJpVBFjdnLs) |
| submit_statement stale (refused) | refused: statement is stale | [`8yZPiqHU9XW4i8Cz6GMbrCkg3XnqC79x3G1SNbWrRmyv`](https://testnet.nearblocks.io/txns/8yZPiqHU9XW4i8Cz6GMbrCkg3XnqC79x3G1SNbWrRmyv) |
| request_signature by unregistered account (refused) | refused: agent not registered | [`BkZxBEd18aL5BTSfjSxfWC4MEdinEFyZYUDG4oajrQWN`](https://testnet.nearblocks.io/txns/BkZxBEd18aL5BTSfjSxfWC4MEdinEFyZYUDG4oajrQWN) |
| request_signature (real MPC) | ok | [`APw73SnHp1Q5Bfk6BozUYFBXobniVeJMqEiT2v1xb7bi`](https://testnet.nearblocks.io/txns/APw73SnHp1Q5Bfk6BozUYFBXobniVeJMqEiT2v1xb7bi) |
| recover while agent active (refused) | refused: agent is still active | [`B8ZZDg53HrNbp8snckMQJocSq9a7CUunuSrunnqsySuJ`](https://testnet.nearblocks.io/txns/B8ZZDg53HrNbp8snckMQJocSq9a7CUunuSrunnqsySuJ) |
| recover (removes agent intents keys) | ok (intents receipt failed: account does not exist on testnet) | [`CewjkFumCN3iquDqiszkVR2YvTffxx5LZ7vPAMQKRwQd`](https://testnet.nearblocks.io/txns/CewjkFumCN3iquDqiszkVR2YvTffxx5LZ7vPAMQKRwQd) |
| request_signature in recovery (refused) | refused: recovery mode: signing closed | [`3wQ39sJ9xMjnjdyzGdm7SSQ5FWFAp3VT9FVPfUTmXrrJ`](https://testnet.nearblocks.io/txns/3wQ39sJ9xMjnjdyzGdm7SSQ5FWFAp3VT9FVPfUTmXrrJ) |
| register_agent in recovery (refused) | refused: recovery mode: registration closed | [`F5maHY1rhBnTKNgDXjuTLCCAYGH2XiFUnux8X72CwKyu`](https://testnet.nearblocks.io/txns/F5maHY1rhBnTKNgDXjuTLCCAYGH2XiFUnux8X72CwKyu) |
| eject with wrong proof (refused) in recovery mode | refused: invalid Merkle proof | [`71KC7qZoc1oDijgrFfmRWM9nXEEZtFjjrTpqtYLoEAFz`](https://testnet.nearblocks.io/txns/71KC7qZoc1oDijgrFfmRWM9nXEEZtFjjrTpqtYLoEAFz) |
| eject (real MPC signature) in recovery mode | ok | [`25gemZFhWMo4gxT45PcN4b4ddL5fjeFnbcG7BzzY8Eyc`](https://testnet.nearblocks.io/txns/25gemZFhWMo4gxT45PcN4b4ddL5fjeFnbcG7BzzY8Eyc) |
| eject same leaf again (refused) in recovery mode | refused: leaf already ejected | [`3nG8PBbXiNSWcWeCa4Hcq8XndkmrpFGvnDGXgc1yw94A`](https://testnet.nearblocks.io/txns/3nG8PBbXiNSWcWeCa4Hcq8XndkmrpFGvnDGXgc1yw94A) |

Signed eject transaction (Base, chain 8453):

```
0x02f9039282210505830f424084773594008316e3609400000000000000000000000000000000000e1ec780b90324cffc3736000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf000000000000000000000000663becd10dae6c4a3dcd89f1d76c1174199639b900000000000000000000000046415998764c29ab2a25cbea6254146d50d226870000000000000000000000000000000000000000000000000bef55718ad60000000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000002625a000000000000000000000000000000000000000000000000000022126b014100000000000000000000000000000000000000000000000000000000000241ed380000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000000e1ec7000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000070dbd880000000000000000000000000000000000000000000000000000000000000001cf2018d2faf211ed768be053f71dc44092a1971bfb8dddc6387a56a19a01ea387185a2b125e8ad4bb3926759c8e39db9f087eaa6cac271d0570861f8a7cfd3414000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000000e1ec7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000070dbd880000000000000000000000000000000000000000000000000000000000000001ba5a74f6711f31c14d928673d9e518827ff1e03da42d02809aa5aa938f6c9b7d47ad9d3145987c3894ec43a10c740ec7ecb80995f640041acc206e327f4ffe98cc001a0d0075d39a6022371e24a1f76731d15566e637eeccd8413a5bc80ced5ada99ed4a0753852c75de11fe7ef282ccf92562f8512d911aca05686e0daf2edefcf918bf0
```
