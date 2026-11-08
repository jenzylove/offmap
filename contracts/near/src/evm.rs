//! Minimal EVM encoding: hex helpers, ABI words, RLP and the EIP-1559 transaction for EjectHelper.eject.

use near_sdk::env;

pub type Address = [u8; 20];
pub type Word = [u8; 32];

pub fn keccak(b: &[u8]) -> Word {
    env::keccak256_array(b)
}

/// Decodes 0x-prefixed (or bare) hex. Panics with `what` in the message on bad input.
pub fn hex_bytes(s: &str, what: &str) -> Vec<u8> {
    hex::decode(s.strip_prefix("0x").unwrap_or(s)).unwrap_or_else(|_| env::panic_str(&format!("{what}: invalid hex")))
}

pub fn hex32(s: &str, what: &str) -> Word {
    hex_bytes(s, what).try_into().unwrap_or_else(|_| env::panic_str(&format!("{what}: must be 32 bytes")))
}

pub fn address(s: &str, what: &str) -> Address {
    hex_bytes(s, what).try_into().unwrap_or_else(|_| env::panic_str(&format!("{what}: must be a 20 byte address")))
}

pub fn to_hex(b: &[u8]) -> String {
    format!("0x{}", hex::encode(b))
}

// ---------- ABI (static types only) ----------

pub fn word_u128(n: u128) -> Word {
    let mut w = [0u8; 32];
    w[16..].copy_from_slice(&n.to_be_bytes());
    w
}

pub fn word_addr(a: &Address) -> Word {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(a);
    w
}

pub fn word_bool(b: bool) -> Word {
    word_u128(b as u128)
}

pub struct MarketParams {
    pub loan_token: Address,
    pub collateral_token: Address,
    pub oracle: Address,
    pub irm: Address,
    pub lltv: u128,
}

impl MarketParams {
    fn words(&self) -> [Word; 5] {
        [
            word_addr(&self.loan_token),
            word_addr(&self.collateral_token),
            word_addr(&self.oracle),
            word_addr(&self.irm),
            word_u128(self.lltv),
        ]
    }

    /// Morpho market id: keccak256(abi.encode(marketParams)).
    pub fn id(&self) -> Word {
        keccak(&self.words().concat())
    }
}

pub struct Authorization {
    pub authorizer: Address,
    pub authorized: Address,
    pub is_authorized: bool,
    pub nonce: u128,
    pub deadline: u128,
}

impl Authorization {
    fn words(&self) -> [Word; 5] {
        [
            word_addr(&self.authorizer),
            word_addr(&self.authorized),
            word_bool(self.is_authorized),
            word_u128(self.nonce),
            word_u128(self.deadline),
        ]
    }
}

pub struct Signature {
    pub v: u8,
    pub r: Word,
    pub s: Word,
}

impl Signature {
    fn words(&self) -> [Word; 3] {
        [word_u128(self.v as u128), self.r, self.s]
    }
}

pub const EJECT_SIGNATURE: &str = "eject((address,address,address,address,uint256),address,uint256,uint256,uint256,(address,address,bool,uint256,uint256),(uint8,bytes32,bytes32),(address,address,bool,uint256,uint256),(uint8,bytes32,bytes32))";

pub struct EjectCall {
    pub mp: MarketParams,
    pub user: Address,
    pub collateral: u128,
    pub borrow_shares: u128,
    pub flash_assets: u128,
    pub grant: Authorization,
    pub grant_sig: Signature,
    pub revoke: Authorization,
    pub revoke_sig: Signature,
}

impl EjectCall {
    /// Calldata: selector then 25 static words (static tuples are encoded inline).
    pub fn calldata(&self) -> Vec<u8> {
        let mut out = keccak(EJECT_SIGNATURE.as_bytes())[..4].to_vec();
        let words: Vec<Word> = [
            self.mp.words().to_vec(),
            vec![word_addr(&self.user), word_u128(self.collateral), word_u128(self.borrow_shares), word_u128(self.flash_assets)],
            self.grant.words().to_vec(),
            self.grant_sig.words().to_vec(),
            self.revoke.words().to_vec(),
            self.revoke_sig.words().to_vec(),
        ]
        .concat();
        for w in words {
            out.extend_from_slice(&w);
        }
        out
    }
}

// ---------- RLP ----------

fn rlp_len_prefix(len: usize, short: u8, long: u8) -> Vec<u8> {
    if len < 56 {
        vec![short + len as u8]
    } else {
        let be = trim(&(len as u64).to_be_bytes()).to_vec();
        let mut v = vec![long + be.len() as u8];
        v.extend(be);
        v
    }
}

fn trim(b: &[u8]) -> &[u8] {
    let first = b.iter().position(|x| *x != 0).unwrap_or(b.len());
    &b[first..]
}

pub fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return b.to_vec();
    }
    let mut v = rlp_len_prefix(b.len(), 0x80, 0xb7);
    v.extend_from_slice(b);
    v
}

/// Integers are big endian with no leading zeros; zero is the empty string.
pub fn rlp_uint(n: u128) -> Vec<u8> {
    rlp_bytes(trim(&n.to_be_bytes()))
}

pub fn rlp_uint_bytes(b: &[u8]) -> Vec<u8> {
    rlp_bytes(trim(b))
}

pub fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let body: Vec<u8> = items.concat();
    let mut v = rlp_len_prefix(body.len(), 0xc0, 0xf7);
    v.extend(body);
    v
}

// ---------- EIP-1559 ----------

pub struct Tx1559 {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: Address,
    pub value: u128,
    pub data: Vec<u8>,
}

impl Tx1559 {
    fn fields(&self) -> Vec<Vec<u8>> {
        vec![
            rlp_uint(self.chain_id as u128),
            rlp_uint(self.nonce as u128),
            rlp_uint(self.max_priority_fee_per_gas),
            rlp_uint(self.max_fee_per_gas),
            rlp_uint(self.gas_limit as u128),
            rlp_bytes(&self.to),
            rlp_uint(self.value),
            rlp_bytes(&self.data),
            rlp_list(&[]), // empty access list
        ]
    }

    /// 0x02 || rlp([chainId, nonce, maxPriorityFee, maxFee, gas, to, value, data, accessList])
    pub fn unsigned(&self) -> Vec<u8> {
        let mut v = vec![0x02];
        v.extend(rlp_list(&self.fields()));
        v
    }

    /// The hash the cohort key signs.
    pub fn signing_hash(&self) -> Word {
        keccak(&self.unsigned())
    }

    pub fn signed(&self, y_parity: u8, r: &Word, s: &Word) -> Vec<u8> {
        let mut f = self.fields();
        f.push(rlp_uint(y_parity as u128));
        f.push(rlp_uint_bytes(r));
        f.push(rlp_uint_bytes(s));
        let mut v = vec![0x02];
        v.extend(rlp_list(&f));
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rlp_known_vectors() {
        assert_eq!(rlp_uint(0), vec![0x80]);
        assert_eq!(rlp_uint(15), vec![0x0f]);
        assert_eq!(rlp_uint(1024), vec![0x82, 0x04, 0x00]);
        assert_eq!(rlp_bytes(b"dog"), vec![0x83, b'd', b'o', b'g']);
        assert_eq!(rlp_list(&[rlp_bytes(b"cat"), rlp_bytes(b"dog")]), vec![0xc8, 0x83, b'c', b'a', b't', 0x83, b'd', b'o', b'g']);
        assert_eq!(rlp_list(&[]), vec![0xc0]);
        let long = vec![0xaa; 60];
        assert_eq!(&rlp_bytes(&long)[..2], &[0xb8, 60]);
    }

    #[test]
    fn morpho_market_id_matches_cbbtc_usdc() {
        // cbBTC/USDC on Base, from docs/ARCHITECTURE.md; params read from Morpho's idToMarketParams.
        let mp = MarketParams {
            loan_token: address("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "loan"),
            collateral_token: address("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "coll"),
            oracle: address("0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9", "oracle"),
            irm: address("0x46415998764C29aB2a25CbeA6254146D50D22687", "irm"),
            lltv: 860000000000000000,
        };
        assert_eq!(to_hex(&mp.id()), "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836");
    }
}
