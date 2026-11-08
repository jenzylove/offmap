import { describe, expect, it } from "vitest";
import { derivedAddress } from "../src/base.js";

describe("MPC address derivation", () => {
  it("matches the mainnet spike address derived by chainsig.js", () => {
    expect(derivedAddress("864a509491f1c806e57e0c7ed3423737195cfb19783340576166654a8ab587b5", "offmap-spike-base-1")).toBe("0xf0Ad15b5AC0A6Ec7109c29D45F752bb944666004");
  });
});
