import { describe, expect, it } from "vitest";
import { SECONDS_PER_YEAR, accrue } from "../src/index.js";

describe("accrue", () => {
  it("is a no-op with no time, no debt or no rate", () => {
    expect(accrue(1000n, 500n, 100n, 0).debt).toBe(1000n);
    expect(accrue(0n, 500n, 100n, 99).debt).toBe(0n);
    expect(accrue(1000n, 0n, 0n, 99).debt).toBe(1000n);
  });
  it("charges APR plus 1% over a year, compounded per second", () => {
    const a = accrue(1_000_000_000_000n, 500n, 100n, Number(SECONDS_PER_YEAR));
    // 6% nominal compounded per second: e^0.06 - 1 = 6.1837%
    expect(a.interest).toBeGreaterThan(61_800_000_000n);
    expect(a.interest).toBeLessThan(61_900_000_000n);
  });
  it("splits interest between Morpho and the spread by rate", () => {
    const a = accrue(1_000_000_000_000n, 500n, 100n, Number(SECONDS_PER_YEAR));
    expect(a.spread + a.morpho).toBe(a.interest);
    const diff = a.spread * 6n - a.interest;
    expect(diff >= -6n && diff <= 6n).toBe(true);
  });
  it("is deterministic and path independent up to rounding", () => {
    const once = accrue(5_000_000n, 300n, 100n, 7200);
    expect(accrue(5_000_000n, 300n, 100n, 7200)).toEqual(once);
    const twice = accrue(accrue(5_000_000n, 300n, 100n, 3600).debt, 300n, 100n, 3600);
    const d = twice.debt - once.debt;
    expect(d >= -1n && d <= 1n).toBe(true);
  });
  it("rejects invalid input", () => {
    expect(() => accrue(-1n, 1n, 1n, 1)).toThrow();
    expect(() => accrue(1n, 1n, 1n, -1)).toThrow();
  });
});
