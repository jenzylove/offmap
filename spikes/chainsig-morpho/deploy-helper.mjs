// Deploy EjectHelper on Base mainnet from the MPC controlled spike address (no private key exists for the deployer).
import fs from "node:fs";
import { encodeDeployData } from "viem";
import { evm, publicClient, mpcSign, baseAddress } from "./lib.mjs";
const art = JSON.parse(fs.readFileSync("../../contracts/base/out/EjectHelper.sol/EjectHelper.json", "utf8"));
const data = encodeDeployData({ abi: art.abi, bytecode: art.bytecode.object, args: ["0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"] });
const from = await baseAddress();
const { transaction, hashesToSign } = await evm.prepareTransactionForSigning({ from, data });
const sig = await mpcSign(hashesToSign[0]);
const signed = evm.finalizeTransactionSigning({ transaction, rsvSignatures: [sig] });
const { hash } = await evm.broadcastTx(signed);
const r = await publicClient.waitForTransactionReceipt({ hash });
console.log(JSON.stringify({ tx: hash, helper: r.contractAddress, status: r.status }));
