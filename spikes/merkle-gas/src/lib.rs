use near_sdk::{env, near};

/// Spike S5: cost of verifying one salted Merkle proof (keccak256, positional hashing,
/// depth 10 = 1024 padded leaves) inside a NEAR contract, the same encoding as @offmap/core.
#[near(contract_state)]
#[derive(Default)]
pub struct Spike {}

fn h32(s: &str) -> [u8; 32] {
    let v = hex::decode(s.trim_start_matches("0x")).expect("hex");
    v.try_into().expect("32 bytes")
}

#[near]
impl Spike {
    pub fn verify(&self, leaf: String, siblings: Vec<String>, index: u64, root: String) -> bool {
        let mut acc = h32(&leaf);
        let mut i = index;
        for s in siblings.iter() {
            let sib = h32(s);
            let mut buf = [0u8; 64];
            if i & 1 == 1 {
                buf[..32].copy_from_slice(&sib);
                buf[32..].copy_from_slice(&acc);
            } else {
                buf[..32].copy_from_slice(&acc);
                buf[32..].copy_from_slice(&sib);
            }
            acc = env::keccak256_array(&buf);
            i >>= 1;
        }
        acc == h32(&root)
    }

    /// Same check as a state-changing call, so the receipt reports burnt gas.
    pub fn verify_call(&mut self, leaf: String, siblings: Vec<String>, index: u64, root: String) -> bool {
        let ok = self.verify(leaf, siblings, index, root);
        env::log_str(&format!("verified={ok}"));
        ok
    }
}
