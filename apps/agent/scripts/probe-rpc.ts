import { FailoverRpcProvider, JsonRpcProvider } from "@near-js/providers";
for (const url of ["https://rpc.mainnet.fastnear.com", "https://near.lava.build", "https://1rpc.io/near", "https://near.drpc.org", "https://free.rpc.fastnear.com"]) {
  try { const p = new JsonRpcProvider({ url }); const r: any = await p.callFunction("offmapfi.near", "get_contract_info", {}); console.log("ok", url, JSON.stringify(r).slice(0, 40)); } catch (e) { console.log("FAIL", url, String(e).slice(0, 120)); }
}
const f = new FailoverRpcProvider(["https://rpc.mainnet.fastnear.com", "https://near.lava.build"].map((url) => new JsonRpcProvider({ url })));
try { await f.callFunction("offmapfi.near", "statement", { cohort_id: "nope" }); } catch (e) { console.log("failover on a contract panic:", String(e).slice(0, 160)); }
