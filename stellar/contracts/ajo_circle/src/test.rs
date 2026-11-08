#![cfg(test)]
#![allow(dead_code)] // remove once Build Day tests use setup()
//! Test plumbing is ready; the tests themselves are written on Build Day,
//! one per step in BUILD_DAY.md. Port them from ../../../contracts/test/AjoCircle.t.sol.

extern crate std;

use super::{AjoCircle, AjoCircleClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

/// A fresh test chain with a fake USDC (a Stellar Asset Contract), the Ajo
/// contract deployed against it, and `n` members each holding 1,000 USDC.
pub struct Setup<'a> {
    pub env: Env,
    pub usdc: TokenClient<'a>,
    pub ajo: AjoCircleClient<'a>,
    pub members: std::vec::Vec<Address>,
}

pub fn setup<'a>(n: usize) -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths(); // skip real signatures in tests

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let usdc = TokenClient::new(&env, &sac.address());
    let minter = StellarAssetClient::new(&env, &sac.address());

    let ajo_id = env.register(AjoCircle, (sac.address(),));
    let ajo = AjoCircleClient::new(&env, &ajo_id);

    let mut members = std::vec::Vec::new();
    for _ in 0..n {
        let m = Address::generate(&env);
        minter.mint(&m, &1_000_0000000); // 1,000 USDC (7 decimals)
        members.push(m);
    }

    Setup { env, usdc, ajo, members }
}

// BUILD DAY tests to write (in this order):
// - create_circle_stores_members_in_order
// - create_circle_rejects_duplicates_and_tiny_circles
// - contribute_moves_usdc_into_contract
// - last_contribution_pays_whole_pot_to_this_rounds_member
// - cannot_pay_twice_in_one_round
// - close_round_after_deadline_marks_missed_and_pays_partial_pot
// - circle_finishes_after_everyone_has_collected
