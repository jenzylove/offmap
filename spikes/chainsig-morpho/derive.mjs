import { baseAddress, accountId } from "./lib.mjs";
console.log(JSON.stringify({ accountId, baseAddress: await baseAddress() }));
