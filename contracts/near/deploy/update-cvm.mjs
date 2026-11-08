// Update the running CVM's compose in place: same app id and disk, so the encrypted ledger survives.
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
const P = "C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@neardefi/shade-agent-cli/node_modules/@phala/cloud/dist/index.js";
const { createClient, updateDockerCompose } = await import(pathToFileURL(P).href);
const apiKey = fs.readFileSync(os.homedir() + "/.offmap-secrets/phala.env", "utf8").match(/PHALA_CLOUD_API_KEY=(.+)/)[1].trim();
const client = createClient({ apiKey });
const id = process.argv[2];
const docker_compose_file = fs.readFileSync("../../../apps/agent/docker-compose.yaml", "utf8");
const r = await updateDockerCompose(client, { id, docker_compose_file });
console.log(JSON.stringify(r).slice(0, 400));
