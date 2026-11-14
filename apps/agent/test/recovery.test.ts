import { describe, expect, it, vi, afterEach } from "vitest";
import { JsonRpcProvider } from "@near-js/providers";
import { RotatingRpcProvider } from "../src/identity.js";
import { backoffDelayMs } from "../src/engine.js";

const signedTx = { transaction: { signerId: "agent.near", encode: () => new Uint8Array([1, 2, 3]) } };
const ok = { status: { SuccessValue: Buffer.from(JSON.stringify({ recovery_id: 0 })).toString("base64") }, transaction_outcome: {}, receipts_outcome: [] };

function provider() {
  const p = new RotatingRpcProvider(["https://a.invalid", "https://b.invalid"]);
  p.lookupMs = 300;
  p.lookupEveryMs = 10;
  return p;
}
afterEach(() => vi.restoreAllMocks());

describe("a send that errors is looked up before it counts", () => {
  it("returns the real outcome when the RPC errors but the transaction ran", async () => {
    vi.spyOn(JsonRpcProvider.prototype, "sendTransactionUntil").mockRejectedValue(new Error("Internal server error"));
    const view = vi.spyOn(JsonRpcProvider.prototype, "viewTransactionStatus").mockRejectedValueOnce(new Error("UNKNOWN_TRANSACTION")).mockResolvedValue(ok as any);
    const r = await provider().sendTransactionUntil(signedTx, "EXECUTED_OPTIMISTIC");
    expect(r).toBe(ok);
    expect(view.mock.calls[0]![0]).toBe("EutHBsdT1YCzHxjCfQHnLPL1vFrkSyLSio4vkphfnEk"); // base58(sha256([1,2,3]))
  });
  it("keeps the original error when no RPC knows the transaction", async () => {
    vi.spyOn(JsonRpcProvider.prototype, "sendTransactionUntil").mockRejectedValue(new Error("Internal server error"));
    vi.spyOn(JsonRpcProvider.prototype, "viewTransactionStatus").mockRejectedValue(new Error("UNKNOWN_TRANSACTION"));
    await expect(provider().sendTransactionUntil(signedTx, "EXECUTED_OPTIMISTIC")).rejects.toThrow("Internal server error");
  });
  it("returns a failed outcome as is, so the caller still sees the contract's refusal", async () => {
    const failed = { status: { Failure: { ActionError: {} } }, transaction_outcome: {}, receipts_outcome: [] };
    vi.spyOn(JsonRpcProvider.prototype, "sendTransactionUntil").mockRejectedValue(new Error("Internal server error"));
    vi.spyOn(JsonRpcProvider.prototype, "viewTransactionStatus").mockResolvedValue(failed as any);
    expect(await provider().sendTransactionUntil(signedTx, "EXECUTED_OPTIMISTIC")).toBe(failed);
  });
  it("does not look anything up when the send succeeds", async () => {
    vi.spyOn(JsonRpcProvider.prototype, "sendTransactionUntil").mockResolvedValue(ok as any);
    const view = vi.spyOn(JsonRpcProvider.prototype, "viewTransactionStatus");
    expect(await provider().sendTransactionUntil(signedTx, "EXECUTED_OPTIMISTIC")).toBe(ok);
    expect(view).not.toHaveBeenCalled();
  });
});

describe("a failing cohort backs off", () => {
  it("waits 1, 2, 4 ... minutes and never more than an hour", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => backoffDelayMs(n) / 60_000)).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });
});
