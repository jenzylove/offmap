import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { loadIdentity } from "./identity.js";
import { load } from "./store.js";
import { tick } from "./engine.js";
import { app } from "./server.js";

const id = await loadIdentity();
const state = load();
console.log(`offmap agent ${id.accountId} (tee=${id.tee}) intents owner ${id.intentsSigner} contract ${config.contractId || "none (dev)"}`);

serve({ fetch: app(id, state).fetch, port: config.port });
console.log(`api on :${config.port}, batch every ${config.batchSeconds}s`);

const loop = () => tick(id, state).catch((e) => console.error("tick", e));
setInterval(loop, config.batchSeconds * 1000);
loop();
