import { createPublicClient, formatUnits, http, parseAbi, type Address } from "viem";
import { base, mainnet } from "viem/chains";
import { BASE_RPC } from "./config";

const clients = {
  base: createPublicClient({ chain: base, transport: http(BASE_RPC) }),
  eth: createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") }),
};
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** The connected wallet's balance of a NEAR Intents asset that lives on Base or Ethereum, or null. */
export async function readBalance(assetId: string, decimals: number, owner: string): Promise<{ raw: bigint; text: string } | null> {
  const m = /^nep141:(base|eth)(?:-(0x[0-9a-fA-F]{40}))?\.omft\.near$/.exec(assetId);
  if (!m) return null;
  const c = clients[m[1] as "base" | "eth"];
  const raw = m[2]
    ? await c.readContract({ address: m[2] as Address, abi: erc20, functionName: "balanceOf", args: [owner as Address] })
    : await c.getBalance({ address: owner as Address });
  const text = formatUnits(raw, decimals).replace(/(\.\d{0,8})\d*$/, "$1").replace(/\.$/, "");
  return { raw, text };
}
