#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, String,
};

const WEEK: u64 = 7 * 24 * 60 * 60;
const DUES: i128 = 5_0000000; // 5.00 in a 7-decimal Stellar asset
const START: u64 = 1_800_000_000;

struct Book<'a> {
    env: Env,
    ajo: AjoCircleClient<'a>,
    money: TokenClient<'a>,
    ada: Address,
    bola: Address,
    chidi: Address,
}

fn setup<'a>() -> Book<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let money = TokenClient::new(&env, &sac.address());
    let mint = StellarAssetClient::new(&env, &sac.address());

    let ajo_id = env.register(AjoCircle, (sac.address(),));
    let ajo = AjoCircleClient::new(&env, &ajo_id);

    let ada = Address::generate(&env);
    let bola = Address::generate(&env);
    let chidi = Address::generate(&env);
    for m in [&ada, &bola, &chidi] {
        mint.mint(m, &(100 * DUES));
    }
    Book { env, ajo, money, ada, bola, chidi }
}

fn open(b: &Book) -> u32 {
    b.ajo.create_circle(
        &b.ada,
        &String::from_str(&b.env, "Market women weekly"),
        &vec![&b.env, b.ada.clone(), b.bola.clone(), b.chidi.clone()],
        &vec![
            &b.env,
            String::from_str(&b.env, "Ada"),
            String::from_str(&b.env, "Bola"),
            String::from_str(&b.env, "Chidi"),
        ],
        &DUES,
        &0,
        &WEEK,
    )
}

#[test]
fn opens_a_circle() {
    let b = setup();
    let id = open(&b);
    assert_eq!(id, 0);
    assert_eq!(b.ajo.circle_count(), 1);
    assert_eq!(b.ajo.token(), b.money.address);

    let c = b.ajo.get_circle(&id);
    assert_eq!(c.members.len(), 3);
    assert_eq!(c.contribution, DUES);
    assert_eq!(c.start_time, START);
    assert_eq!(c.round_ends_at, START + WEEK);
    assert_eq!(c.current_round, 0);
    assert!(!c.finished);
    assert_eq!(b.ajo.get_circles(&0, &10).len(), 1);
}

#[test]
fn pays_out_the_moment_the_last_member_pays() {
    let b = setup();
    let id = open(&b);

    b.ajo.contribute(&id, &b.ada);
    b.ajo.contribute(&id, &b.bola);
    let c = b.ajo.get_circle(&id);
    assert_eq!(c.pot, 2 * DUES);
    assert_eq!(c.paid, vec![&b.env, true, true, false]);
    assert_eq!(b.money.balance(&b.ajo.address), 2 * DUES);

    b.ajo.contribute(&id, &b.chidi);
    let c = b.ajo.get_circle(&id);
    // Ada collects round 0: she paid 5 in and got 15 out.
    assert_eq!(b.money.balance(&b.ada), 100 * DUES - DUES + 3 * DUES);
    assert_eq!(b.money.balance(&b.ajo.address), 0);
    assert_eq!(c.current_round, 1);
    assert_eq!(c.pot, 0);
    assert_eq!(c.paid_count, 0);
    assert_eq!(c.paid, vec![&b.env, false, false, false]);
    assert_eq!(c.received, vec![&b.env, 3 * DUES, 0, 0]);
    assert_eq!(c.round_ends_at, START + 2 * WEEK);
}

#[test]
fn full_rotation_leaves_everyone_square() {
    let b = setup();
    let id = open(&b);
    for _ in 0..3 {
        b.ajo.contribute(&id, &b.ada);
        b.ajo.contribute(&id, &b.bola);
        b.ajo.contribute(&id, &b.chidi);
    }
    let c = b.ajo.get_circle(&id);
    assert!(c.finished);
    assert_eq!(c.received, vec![&b.env, 3 * DUES, 3 * DUES, 3 * DUES]);
    assert_eq!(c.missed, vec![&b.env, 0, 0, 0]);
    for m in [&b.ada, &b.bola, &b.chidi] {
        assert_eq!(b.money.balance(m), 100 * DUES);
    }
    assert_eq!(b.money.balance(&b.ajo.address), 0);
    assert_eq!(b.ajo.try_contribute(&id, &b.ada), Err(Ok(Error::CircleFinished)));
}

#[test]
fn cannot_pay_twice_or_from_outside() {
    let b = setup();
    let id = open(&b);
    b.ajo.contribute(&id, &b.ada);
    assert_eq!(b.ajo.try_contribute(&id, &b.ada), Err(Ok(Error::AlreadyPaidThisRound)));
    let stranger = Address::generate(&b.env);
    assert_eq!(b.ajo.try_contribute(&id, &stranger), Err(Ok(Error::NotAMember)));
    assert_eq!(b.ajo.try_contribute(&99, &b.ada), Err(Ok(Error::CircleNotFound)));
}

#[test]
fn late_round_is_closed_and_defaulters_are_marked() {
    let b = setup();
    let id = open(&b);
    b.ajo.contribute(&id, &b.bola);
    b.ajo.contribute(&id, &b.chidi);
    // Ada (the recipient) never pays. Nobody can close early...
    assert_eq!(b.ajo.try_close_round(&id), Err(Ok(Error::RoundStillOpen)));

    // ...and once time is up nobody can pay late; anyone can close.
    b.env.ledger().set_timestamp(START + WEEK + 1);
    assert_eq!(b.ajo.try_contribute(&id, &b.ada), Err(Ok(Error::RoundOverdue)));
    b.ajo.close_round(&id);

    let c = b.ajo.get_circle(&id);
    assert_eq!(c.current_round, 1);
    assert_eq!(c.missed, vec![&b.env, 1, 0, 0]);
    assert_eq!(c.received, vec![&b.env, 2 * DUES, 0, 0]);
    assert_eq!(b.money.balance(&b.ada), 100 * DUES + 2 * DUES);
    assert_eq!(c.round_ends_at, START + 2 * WEEK);
}

#[test]
fn a_very_late_close_never_skips_the_next_turn() {
    let b = setup();
    let id = open(&b);
    let late = START + 5 * WEEK;
    b.env.ledger().set_timestamp(late);
    b.ajo.close_round(&id); // nobody paid round 0

    let c = b.ajo.get_circle(&id);
    assert_eq!(c.missed, vec![&b.env, 1, 1, 1]);
    assert_eq!(c.received, vec![&b.env, 0, 0, 0]);
    // Bola still gets a full week to be paid.
    assert_eq!(c.round_ends_at, late + WEEK);
    assert_eq!(b.ajo.try_close_round(&id), Err(Ok(Error::RoundStillOpen)));
    b.ajo.contribute(&id, &b.ada);
}

#[test]
fn a_circle_can_start_later() {
    let b = setup();
    let id = b.ajo.create_circle(
        &b.ada,
        &String::from_str(&b.env, "January circle"),
        &vec![&b.env, b.ada.clone(), b.bola.clone()],
        &vec![&b.env, String::from_str(&b.env, "Ada"), String::from_str(&b.env, "Bola")],
        &DUES,
        &(START + 100),
        &WEEK,
    );
    assert_eq!(b.ajo.try_contribute(&id, &b.ada), Err(Ok(Error::RoundNotOpen)));
    b.env.ledger().set_timestamp(START + 100);
    b.ajo.contribute(&id, &b.ada);
}

#[test]
fn rejects_bad_circles() {
    let b = setup();
    let e = &b.env;
    let name = String::from_str(e, "Circle");
    let two = vec![e, b.ada.clone(), b.bola.clone()];
    let two_names = vec![e, String::from_str(e, "Ada"), String::from_str(e, "Bola")];

    // one member only
    assert_eq!(
        b.ajo.try_create_circle(&b.ada, &name, &vec![e, b.ada.clone()], &vec![e, String::from_str(e, "Ada")], &DUES, &0, &WEEK),
        Err(Ok(Error::BadMembers))
    );
    // the same member twice
    assert_eq!(
        b.ajo.try_create_circle(&b.ada, &name, &vec![e, b.ada.clone(), b.ada.clone()], &two_names, &DUES, &0, &WEEK),
        Err(Ok(Error::BadMembers))
    );
    // names do not line up with members
    assert_eq!(
        b.ajo.try_create_circle(&b.ada, &name, &two, &vec![e, String::from_str(e, "Ada")], &DUES, &0, &WEEK),
        Err(Ok(Error::BadMembers))
    );
    assert_eq!(b.ajo.try_create_circle(&b.ada, &name, &two, &two_names, &0, &0, &WEEK), Err(Ok(Error::ZeroAmount)));
    assert_eq!(b.ajo.try_create_circle(&b.ada, &name, &two, &two_names, &DUES, &0, &0), Err(Ok(Error::ZeroDuration)));
    assert_eq!(
        b.ajo.try_create_circle(&b.ada, &String::from_str(e, ""), &two, &two_names, &DUES, &0, &WEEK),
        Err(Ok(Error::BadName))
    );
    assert_eq!(b.ajo.circle_count(), 0);
}

#[test]
fn only_the_member_can_pay_for_themselves() {
    let b = setup();
    let id = open(&b);
    b.ajo.contribute(&id, &b.bola);
    // The contribution was authorised by Bola, nobody else.
    let auths = b.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, b.bola);
}

// ---------- a payout that cannot be delivered ----------

/// A tiny token that refuses to pay one "frozen" address, standing in for a
/// member whose wallet is not ready to hold the token (no USDC trustline,
/// account not created yet, ...).
#[contracttype]
enum FussyKey {
    Frozen,
    Balance(Address),
}

#[contract]
struct FussyToken;

#[contractimpl]
impl FussyToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = FussyKey::Balance(to);
        let bal: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(bal + amount));
    }
    pub fn freeze(env: Env, who: Address) {
        env.storage().instance().set(&FussyKey::Frozen, &who);
    }
    pub fn thaw(env: Env) {
        env.storage().instance().remove(&FussyKey::Frozen);
    }
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().persistent().get(&FussyKey::Balance(id)).unwrap_or(0)
    }
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let frozen: Option<Address> = env.storage().instance().get(&FussyKey::Frozen);
        if frozen == Some(to.clone()) {
            panic!("this wallet cannot hold the token yet");
        }
        let from_key = FussyKey::Balance(from);
        let to_key = FussyKey::Balance(to);
        let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        assert!(from_bal >= amount, "not enough money");
        let to_bal: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage().persistent().set(&from_key, &(from_bal - amount));
        env.storage().persistent().set(&to_key, &(to_bal + amount));
    }
}

#[test]
fn an_undeliverable_payout_waits_for_the_member_and_never_blocks_the_circle() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);
    let token_id = env.register(FussyToken, ());
    let money = FussyTokenClient::new(&env, &token_id);
    let ajo = AjoCircleClient::new(&env, &env.register(AjoCircle, (token_id.clone(),)));

    let ada = Address::generate(&env);
    let bola = Address::generate(&env);
    money.mint(&ada, &(10 * DUES));
    money.mint(&bola, &(10 * DUES));
    let id = ajo.create_circle(
        &ada,
        &String::from_str(&env, "Two friends"),
        &vec![&env, ada.clone(), bola.clone()],
        &vec![&env, String::from_str(&env, "Ada"), String::from_str(&env, "Bola")],
        &DUES,
        &0,
        &WEEK,
    );

    // Ada collects first, but her wallet cannot receive.
    money.freeze(&ada);
    ajo.contribute(&id, &ada);
    ajo.contribute(&id, &bola); // must not fail

    let c = ajo.get_circle(&id);
    assert_eq!(c.current_round, 1);
    assert_eq!(c.received, vec![&env, 2 * DUES, 0]);
    assert_eq!(c.owed, vec![&env, 2 * DUES, 0]);
    assert_eq!(money.balance(&ajo.address), 2 * DUES);
    assert_eq!(ajo.try_claim(&id, &ada), Err(Ok(Error::PayoutFailed)));
    assert_eq!(ajo.try_claim(&id, &bola), Err(Ok(Error::NothingToClaim)));

    // The circle carries on: Bola's turn pays out normally.
    ajo.contribute(&id, &ada);
    ajo.contribute(&id, &bola);
    assert!(ajo.get_circle(&id).finished);
    assert_eq!(money.balance(&bola), 10 * DUES);

    // Once Ada's wallet is ready she collects, exactly once.
    money.thaw();
    ajo.claim(&id, &ada);
    assert_eq!(money.balance(&ada), 10 * DUES);
    assert_eq!(money.balance(&ajo.address), 0);
    assert_eq!(ajo.get_circle(&id).owed, vec![&env, 0, 0]);
    assert_eq!(ajo.try_claim(&id, &ada), Err(Ok(Error::NothingToClaim)));
}
