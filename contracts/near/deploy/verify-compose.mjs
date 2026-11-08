import { pathToFileURL } from "node:url";
const R = "C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@neardefi/shade-agent-cli/dist/src/utils";
const m = await import(pathToFileURL(R + "/measurements.js").href);
console.log("compose hash from repo file:", m.calculateAppComposeHash("../../../apps/agent/docker-compose.yaml", { publicLogs: false, publicSysinfo: false }));
