// Generates tests/fixtures.json: a cohort tree built with @offmap/core and an eject transaction
// encoded with viem, so the Rust contract can be checked against both bit for bit.
// Run from the repo root: npx tsx contracts/near/tests/gen-fixtures.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keccak_256 } from "../../../packages/core/node_modules/@noble/hashes/sha3.js";
import { buildTree, leafHash, proof, root, verify } from "../../../packages/core/src/merkle.ts";
import { bytesToHex, utf8 } from "../../../packages/core/src/hex.ts";
import {
  encodeFunctionData,
  keccak256,
  parseAbi,
  serializeTransaction,
} from "../../../spikes/chainsig-morpho/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../../../spikes/chainsig-morpho/node_modules/viem/_esm/accounts/index.js";

const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const cohort = {
  id: "cbbtc-usdc",
  market_id: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836",
  loan_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  collateral_token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9",
  irm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
  lltv: "860000000000000000",
  base_chain_id: 8453,
  // Placeholder until EjectHelper is deployed on Base.
  eject_helper: "0x00000000000000000000000000000000000e1ec7",
  size_cap_loan: "1000000000000",
  ceiling_bps: 5000,
};

// Public anvil test key #0. Not a secret; it only signs the fixture's Morpho authorizations.
const user = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const uid = (auth: string) => bytesToHex(keccak_256(utf8(auth)));

const positions = [
  { userId: uid(`evm:${user.address.toLowerCase()}`), collateral: 2_500_000n, debt: 600_000_000n, nonce: 3n },
  { userId: uid("evm:0x1111111111111111111111111111111111111111"), collateral: 10_000_000n, debt: 2_000_000_000n, nonce: 1n },
  { userId: uid("near:alice.near"), collateral: 700_000n, debt: 0n, nonce: 7n },
  { userId: uid("evm:0x2222222222222222222222222222222222222222"), collateral: 1_234_567n, debt: 333_333_333n, nonce: 2n },
].map((p, i) => ({ ...p, cohortId: cohort.id, salt: bytesToHex(keccak_256(utf8(`fixture-salt-${i}`))) }));

const leaves = positions.map((p) => leafHash(p));
const tree = buildTree(leaves);
const r = root(tree);
const idx = 0;
const p = proof(tree, idx);
if (!verify(leaves[idx]!, p, r)) throw new Error("core verify failed");

const totalCollateral = positions.reduce((s, x) => s + x.collateral, 0n);
const totalDebt = positions.reduce((s, x) => s + x.debt, 0n);
const borrowShares = totalDebt * 999_000n; // Morpho shares carry 1e6 virtual shares, minus accrued interest
const statement = {
  cohort_id: cohort.id,
  batch_id: "1",
  total_collateral: totalCollateral.toString(),
  total_debt: totalDebt.toString(),
  reserve: "1000000",
  collateral_value_loan: (totalDebt * 3n).toString(),
  borrow_shares: borrowShares.toString(),
  merkle_root: r,
  leaf_count: tree.levels[0]!.length,
  timestamp_ms: "0", // tests set this to the block time
};

const me = positions[idx]!;
const userShares = (me.debt * borrowShares + totalDebt - 1n) / totalDebt;
const flashAssets = me.debt + me.debt / 100n;

const domain = { chainId: 8453, verifyingContract: MORPHO } as const;
const types = {
  Authorization: [
    { name: "authorizer", type: "address" },
    { name: "authorized", type: "address" },
    { name: "isAuthorized", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const deadline = 1893456000n; // 2030-01-01
const grant = { authorizer: user.address, authorized: cohort.eject_helper, isAuthorized: true, nonce: 0n, deadline };
const revoke = { ...grant, isAuthorized: false, nonce: 1n };
const split = (sig: string) => ({ v: parseInt(sig.slice(130, 132), 16), r: "0x" + sig.slice(2, 66), s: "0x" + sig.slice(66, 130) });
const grantSig = split(await user.signTypedData({ domain, types, primaryType: "Authorization", message: grant }));
const revokeSig = split(await user.signTypedData({ domain, types, primaryType: "Authorization", message: revoke }));

const abi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct Authorization { address authorizer; address authorized; bool isAuthorized; uint256 nonce; uint256 deadline; }",
  "struct Signature { uint8 v; bytes32 r; bytes32 s; }",
  "function eject(MarketParams mp, address user, uint256 collateral, uint256 borrowShares, uint256 flashAssets, Authorization grant, Signature grantSig, Authorization revoke, Signature revokeSig)",
]);
const data = encodeFunctionData({
  abi,
  functionName: "eject",
  args: [
    { loanToken: cohort.loan_token, collateralToken: cohort.collateral_token, oracle: cohort.oracle, irm: cohort.irm, lltv: BigInt(cohort.lltv) },
    user.address,
    me.collateral,
    userShares,
    flashAssets,
    grant,
    grantSig,
    revoke,
    revokeSig,
  ] as any,
});
const tx = { nonce: 5, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n, gas: 1_500_000n };
const unsigned = serializeTransaction({
  type: "eip1559",
  chainId: 8453,
  nonce: tx.nonce,
  maxFeePerGas: tx.maxFeePerGas,
  maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  gas: tx.gas,
  to: cohort.eject_helper as `0x${string}`,
  value: 0n,
  data,
  accessList: [],
});

// Same tx with a fixed fake signature, to check the contract's signed serialization.
const fakeSigned = serializeTransaction(
  { type: "eip1559", chainId: 8453, nonce: tx.nonce, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, gas: tx.gas, to: cohort.eject_helper as `0x${string}`, value: 0n, data, accessList: [] },
  { r: `0x${"aa".repeat(32)}`, s: `0x${"bb".repeat(32)}`, yParity: 1 },
);

const auth = (a: typeof grant) => ({ authorizer: a.authorizer, authorized: a.authorized, is_authorized: a.isAuthorized, nonce: a.nonce.toString(), deadline: a.deadline.toString() });
const out = {
  cohort,
  statement,
  leaf: { user_id: me.userId, collateral: me.collateral.toString(), debt: me.debt.toString(), nonce: me.nonce.toString(), salt: me.salt },
  leaf_hash: leaves[idx],
  proof: p,
  other_leaf: { index: 1, leaf_hash: leaves[1] },
  eject_args: {
    user: user.address,
    borrow_shares: userShares.toString(),
    flash_assets: flashAssets.toString(),
    grant: auth(grant),
    grant_sig: grantSig,
    revoke: auth(revoke),
    revoke_sig: revokeSig,
    tx: { nonce: String(tx.nonce), max_fee_per_gas: tx.maxFeePerGas.toString(), max_priority_fee_per_gas: tx.maxPriorityFeePerGas.toString(), gas_limit: tx.gas.toString() },
  },
  expected: { calldata: data, unsigned_tx: unsigned, payload_hash: keccak256(unsigned), signed_with_fake_sig: fakeSigned },
};
writeFileSync(fileURLToPath(new URL("./fixtures.json", import.meta.url)), JSON.stringify(out, null, 2) + "\n");
console.log("wrote fixtures.json", out.expected.payload_hash);
