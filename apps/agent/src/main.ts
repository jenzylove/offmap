import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { loadIdentity } from "./identity.js";
import { load } from "./store.js";
import { tick } from "./engine.js";
import { app } from "./server.js";

const id = await loadIdentity();
if (id.tee) {
  // Inside the TEE, secrets come from dstack's key service, bound to this exact app: only this code can read the ledger.
  const { DstackClient } = await import("@phala/dstack-sdk");
  const ds = new DstackClient();
  const hex = async (p: string) => Buffer.from((await ds.getKey(p, "offmap")).key).toString("hex").slice(0, 64);
  if (!config.stateKey) (config as any).stateKey = await hex("offmap/state-key");
  if (!config.sessionSecret) (config as any).sessionSecret = await hex("offmap/session-secret");
}
if (id.register) await id.register();
const state = load();
console.log(`offmap agent ${id.accountId} (tee=${id.tee}) intents owner ${id.intentsSigner} contract ${config.contractId || "none (dev)"}`);

serve({ fetch: app(id, state).fetch, port: config.port });
console.log(`api on :${config.port}, batch every ${config.batchSeconds}s`);

const loop = () => tick(id, state).catch((e) => console.error("tick", e));
setInterval(loop, config.batchSeconds * 1000);
loop();
