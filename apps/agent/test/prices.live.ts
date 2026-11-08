// Live check, not part of the unit suite: npx tsx test/prices.live.ts
import { COHORTS } from "../src/config.js";
import { cohortPrice } from "../src/prices.js";

for (const c of COHORTS) {
  const r = await cohortPrice(c);
  console.log(c.id, "median", Number(r.price) / 1e8, r.readings.map((x) => `${x.source}=${Number(x.price) / 1e8}`).join(" "), r.errors.join(";"));
}
