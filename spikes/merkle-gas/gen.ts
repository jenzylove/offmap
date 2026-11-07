import { buildTree, leafHash, proof, root, verify } from "../../packages/core/src/merkle.js";
const leaves: string[] = [];
for (let i = 0; i < 700; i++) {
  leaves.push(leafHash({ cohortId: "cbbtc-usdc", userId: `user${i}`, collateral: BigInt(1000 + i), debt: BigInt(500 + i), nonce: 1n, salt: ("0x" + i.toString(16).padStart(64, "0")) as `0x${string}` }));
}
const t = buildTree(leaves as any);
const idx = 421;
const p = proof(t, idx);
const r = root(t);
if (!verify(leaves[idx] as any, p, r)) throw new Error("local verify failed");
console.log(JSON.stringify({ leaf: leaves[idx], siblings: p.siblings, index: idx, root: r }));
