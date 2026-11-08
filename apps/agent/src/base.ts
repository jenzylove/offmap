import { createPublicClient, encodeFunctionData, http, keccak256, parseAbi, serializeTransaction, getAddress, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha3_256 } from "@noble/hashes/sha3";
import bs58 from "bs58";
import { config, MORPHO, USDC_BASE, type CohortConfig } from "./config.js";
import type { Identity } from "./identity.js";

export const client = createPublicClient({ chain: base, transport: http(config.baseRpc) });

const mp = "(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv)";
export const abi = parseAbi([
  "function idToMarketParams(bytes32) view returns (address,address,address,address,uint256)",
  "function position(bytes32,address) view returns (uint256,uint128,uint128)",
  "function market(bytes32) view returns (uint128,uint128,uint128,uint128,uint128,uint128)",
  `function supplyCollateral(${mp} mp,uint256 assets,address onBehalf,bytes data)`,
  `function borrow(${mp} mp,uint256 assets,uint256 shares,address onBehalf,address receiver) returns (uint256,uint256)`,
  `function repay(${mp} mp,uint256 assets,uint256 shares,address onBehalf,bytes data) returns (uint256,uint256)`,
  `function withdrawCollateral(${mp} mp,uint256 assets,address onBehalf,address receiver)`,
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function price() view returns (uint256)",
]);

// v1.signer mainnet root key, as published in chainsig.js (constants.ROOT_PUBLIC_KEYS.MAINNET.secp256k1).
const MPC_ROOT_MAINNET = "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya";

/** NEAR MPC key derivation: child = root + sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:<predecessor>,<path>") * G. */
export function derivedAddress(predecessor: string, path: string): Address {
  const root = bs58.decode(MPC_ROOT_MAINNET.split(":")[1]!);
  const rootPoint = secp256k1.ProjectivePoint.fromHex(Buffer.concat([Buffer.from([4]), Buffer.from(root)]));
  const eps = BigInt("0x" + Buffer.from(sha3_256(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`)).toString("hex"));
  const child = rootPoint.add(secp256k1.ProjectivePoint.BASE.multiply(eps)).toRawBytes(false);
  return getAddress(("0x" + keccak256(child.slice(1)).slice(-40)) as Hex);
}
export const cohortAddress = (predecessor: string, cohortId: string) => derivedAddress(predecessor, `cohort:${cohortId}`);

export async function marketParams(c: CohortConfig) {
  const [loanToken, collateralToken, oracle, irm, lltv] = await client.readContract({ address: MORPHO, abi, functionName: "idToMarketParams", args: [c.marketId] });
  return { loanToken, collateralToken, oracle, irm, lltv };
}

export async function position(c: CohortConfig, who: Address) {
  const [supplyShares, borrowShares, collateral] = await client.readContract({ address: MORPHO, abi, functionName: "position", args: [c.marketId, who] });
  const [, , totalBorrowAssets, totalBorrowShares] = await client.readContract({ address: MORPHO, abi, functionName: "market", args: [c.marketId] });
  const debt = totalBorrowShares === 0n ? 0n : (borrowShares * totalBorrowAssets + totalBorrowShares - 1n) / totalBorrowShares;
  return { supplyShares, borrowShares, collateral, debt };
}

/** Prepare, MPC sign through the identity (offmap.near in production), broadcast, wait. */
export async function send(id: Identity, cohortId: string, tx: { to: Address; data?: Hex; value?: bigint }) {
  const from = cohortAddress(id.mpcPredecessor, cohortId);
  const [nonce, fees, gas] = await Promise.all([
    client.getTransactionCount({ address: from, blockTag: "pending" }),
    client.estimateFeesPerGas(),
    client.estimateGas({ account: from, ...tx }),
  ]);
  const unsigned = { chainId: base.id, type: "eip1559" as const, nonce, to: tx.to, data: tx.data, value: tx.value ?? 0n, gas: (gas * 12n) / 10n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  const hash = keccak256(serializeTransaction(unsigned));
  const sig = await id.mpcSign(cohortId, Buffer.from(hash.slice(2), "hex"));
  const signed = serializeTransaction(unsigned, { r: `0x${sig.r}`, s: `0x${sig.s}`, yParity: sig.v - 27 });
  const txHash = await client.sendRawTransaction({ serializedTransaction: signed });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`base tx reverted ${txHash}`);
  return txHash;
}

const call = (fn: string, args: unknown[]) => encodeFunctionData({ abi, functionName: fn as any, args: args as any });

export async function supply(id: Identity, c: CohortConfig, amount: bigint) {
  const me = cohortAddress(id.mpcPredecessor, c.id);
  const m = await marketParams(c);
  const a = await send(id, c.id, { to: c.collateralToken, data: call("approve", [MORPHO, amount]) });
  const b = await send(id, c.id, { to: MORPHO, data: call("supplyCollateral", [m, amount, me, "0x"]) });
  return [a, b];
}
export async function borrow(id: Identity, c: CohortConfig, amount: bigint) {
  const me = cohortAddress(id.mpcPredecessor, c.id);
  return [await send(id, c.id, { to: MORPHO, data: call("borrow", [await marketParams(c), amount, 0n, me, me]) })];
}
export async function repay(id: Identity, c: CohortConfig, amount: bigint) {
  const me = cohortAddress(id.mpcPredecessor, c.id);
  const a = await send(id, c.id, { to: USDC_BASE, data: call("approve", [MORPHO, amount]) });
  const b = await send(id, c.id, { to: MORPHO, data: call("repay", [await marketParams(c), amount, 0n, me, "0x"]) });
  return [a, b];
}
export async function withdraw(id: Identity, c: CohortConfig, amount: bigint) {
  const me = cohortAddress(id.mpcPredecessor, c.id);
  return [await send(id, c.id, { to: MORPHO, data: call("withdrawCollateral", [await marketParams(c), amount, me, me]) })];
}
export async function transfer(id: Identity, c: CohortConfig, token: Address, to: Address, amount: bigint) {
  return send(id, c.id, { to: token, data: call("transfer", [to, amount]) });
}
export const erc20Balance = (token: Address, who: Address) => client.readContract({ address: token, abi, functionName: "balanceOf", args: [who] });
export const ethBalance = (who: Address) => client.getBalance({ address: who });
