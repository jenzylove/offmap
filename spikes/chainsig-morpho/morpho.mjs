import { encodeFunctionData, parseAbi } from "viem";
import { publicClient, sendFromDerived, baseAddress } from "./lib.mjs";

const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const MARKET = "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836";
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const mpTuple = "(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv)";
const abi = parseAbi([
  "function idToMarketParams(bytes32) view returns (address,address,address,address,uint256)",
  "function position(bytes32,address) view returns (uint256,uint128,uint128)",
  `function supplyCollateral(${mpTuple} mp,uint256 assets,address onBehalf,bytes data)`,
  `function borrow(${mpTuple} mp,uint256 assets,uint256 shares,address onBehalf,address receiver) returns (uint256,uint256)`,
  `function repay(${mpTuple} mp,uint256 assets,uint256 shares,address onBehalf,bytes data) returns (uint256,uint256)`,
  `function withdrawCollateral(${mpTuple} mp,uint256 assets,address onBehalf,address receiver)`,
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const me = await baseAddress();
const [l, c, o, i, lltv] = await publicClient.readContract({ address: MORPHO, abi, functionName: "idToMarketParams", args: [MARKET] });
const mp = { loanToken: l, collateralToken: c, oracle: o, irm: i, lltv };
const call = (to, functionName, args) => sendFromDerived({ to, data: encodeFunctionData({ abi, functionName, args }) });
const pos = async () => (await publicClient.readContract({ address: MORPHO, abi, functionName: "position", args: [MARKET, me] })).map(String);
const bal = (t) => publicClient.readContract({ address: t, abi, functionName: "balanceOf", args: [me] });

const coll = await bal(CBBTC);
const log = [];
const step = async (name, p) => { const h = await p; log.push({ step: name, tx: `https://basescan.org/tx/${h}` }); console.log(name, h, "position", await pos()); };
await step("approve cbBTC", call(CBBTC, "approve", [MORPHO, coll]));
await step("supplyCollateral", call(MORPHO, "supplyCollateral", [mp, coll, me, "0x"]));
await step("borrow 2 USDC", call(MORPHO, "borrow", [mp, 2_000_000n, 0n, me, me]));
await step("approve USDC", call(USDC, "approve", [MORPHO, 2_000_000n]));
await step("repay 1.9 USDC", call(MORPHO, "repay", [mp, 1_900_000n, 0n, me, "0x"]));
await step("withdrawCollateral 1000 sats", call(MORPHO, "withdrawCollateral", [mp, 1000n, me, me]));
console.log(JSON.stringify({ address: me, log }, null, 1));
