# Spike S5: salted Merkle proof verification gas on NEAR

**Question.** How much gas does a NEAR contract spend verifying one user's position proof, using the exact leaf and tree encoding of `@offmap/core` (keccak256, positional hashing, 1,024 padded leaves)?

**What was run.**
1. `spikes/merkle-gas/gen.ts` builds a 700 user cohort tree with `@offmap/core`, padded to 1,024 leaves (depth 10), and outputs one real proof.
2. `spikes/merkle-gas/src/lib.rs` verifies it on chain with `env::keccak256_array`.
3. Deployed to NEAR testnet as `offmap-merkle-1794084444.testnet` and called `verify_call` (transaction `96u6BujBjQz9NJWB5jKAj8ceH6k1fNztAVTgJ75WMzXy`).

**Output.** `verified=true`, **gas used 2.0 Tgas** (limit per call 300 Tgas). The same proof against a wrong root returns `false`.

**Verdict.** Pass. The TypeScript and Rust encodings agree, and proof checks cost about 1% of a call's gas, so eject and note checks fit easily even for trees of 64k leaves (depth 16).
