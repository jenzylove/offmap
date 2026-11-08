import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
const R = "C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@neardefi/shade-agent-cli/dist/src/utils";
const { deployToPhala } = await import(pathToFileURL(R + "/phala-deploy.js").href);
const { extractAllowedEnvs } = await import(pathToFileURL(R + "/measurements.js").href);
const apiKey = fs.readFileSync(os.homedir() + "/.offmap-secrets/phala.env", "utf8").match(/PHALA_CLOUD_API_KEY=(.+)/)[1].trim();
const compose = "../../../apps/agent/docker-compose.yaml";
const allowed = extractAllowedEnvs(compose);
console.log("allowed envs", allowed);
const r = await deployToPhala({ appName: "offmap-agent", apiKey, composePath: compose, envFilePath: os.homedir() + "/.offmap-secrets/phala-cvm.env",
  allowedEnvKeys: allowed, dstackVersion: "0.5.8", instanceType: "tdx.small", publicLogs: false, publicSysinfo: false });
fs.writeFileSync("phala-deploy.json", JSON.stringify(r, null, 2));
console.log(JSON.stringify(r));
