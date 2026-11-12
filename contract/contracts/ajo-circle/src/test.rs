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
const PURSE: i128 = 100 * DUES; // what every test wallet starts with

struct Book<'a> {
    env: Env,
    ajo: AjoCircleClient<'a>,
    money: TokenClient<'a>,
    mint: StellarAssetClient<'a>,
    ada: Address,
    bola: Address,
    chidi: Address,
}

fn s(env: &Env, text: &str) -> String {
    String::from_str(env, text)
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
        mint.mint(m, &PURSE);
    }
    Book { env, ajo, money, mint, ada, bola, chidi }
}

impl Book<'_> {
    /// A new wallet with a full purse.
    fn newcomer(&self) -> Address {
        let a = Address::generate(&self.env);
        self.mint.mint(&a, &PURSE);
        a
    }

    /// Ada hosts; Bola and Chidi join; not started yet.
    fn gather(&self, deposit: i128) -> u32 {
        let e = &self.env;
        let id = self.ajo.create_circle(&self.ada, &s(e, "Market women weekly"), &s(e, "Ada"), &DUES, &WEEK, &deposit);
        self.ajo.join(&id, &self.bola, &s(e, "Bola"));
        self.ajo.join(&id, &self.chidi, &s(e, "Chidi"));
        id
    }

    /// A running three-member circle.
    fn open(&self, deposit: i128) -> u32 {
        let id = self.gather(deposit);
        self.ajo.start(&id);
        id
    }

    /// Every unit the contract holds is accounted for in the book.
    fn check_books_balance(&self, id: u32) {
        let c = self.ajo.get_circle(&id);
        let mut owed = 0;
        let mut deposits = 0;
        for i in 0..c.members.len() {
            owed += c.owed.get_unchecked(i);
            deposits += c.deposits.get_unchecked(i);
        }
        assert_eq!(self.money.balance(&self.ajo.address), c.pot + owed + deposits);
    }
}

// ---------- gathering ----------

#[test]
fn host_opens_and_members_write_their_own_names() {
    let b = setup();
    let id = b.gather(0);
    assert_eq!(id, 0);
    assert_eq!(b.ajo.circle_count(), 1);
    assert_eq!(b.ajo.token(), b.money.address);

    let c = b.ajo.get_circle(&id);
    assert_eq!(c.organizer, b.ada);
    assert_eq!(c.members, vec![&b.env, b.ada.clone(), b.bola.clone(), b.chidi.clone()]);
    assert_eq!(c.names, vec![&b.env, s(&b.env, "Ada"), s(&b.env, "Bola"), s(&b.env, "Chidi")]);
    assert!(c.open && !c.started && !c.finished);
    assert_eq!(b.ajo.get_circles(&0, &10).len(), 1);
    // Joining a circle with no deposit moves no money.
    assert_eq!(b.money.balance(&b.bola), PURSE);
    // Nobody can pay or close before the host starts it.
    assert_eq!(b.ajo.try_contribute(&id, &b.ada), Err(Ok(Error::NotStarted)));
    assert_eq!(b.ajo.try_close_round(&id), Err(Ok(Error::NotStarted)));
}

#[test]
fn joining_rules() {
    let b = setup();
    let e = &b.env;
    let id = b.gather(0);
    assert_eq!(b.ajo.try_join(&id, &b.bola, &s(e, "Bola again")), Err(Ok(Error::AlreadyAMember)));
    assert_eq!(b.ajo.try_join(&id, &b.newcomer(), &s(e, "")), Err(Ok(Error::BadName)));
    assert_eq!(b.ajo.try_join(&99, &b.newcomer(), &s(e, "Dayo")), Err(Ok(Error::CircleNotFound)));

    // The host can stop new members, and let them in again.
    b.ajo.set_open(&id, &false);
    let dayo = b.newcomer();
    assert_eq!(b.ajo.try_join(&id, &dayo, &s(e, "Dayo")), Err(Ok(Error::ClosedToNewMembers)));
    b.ajo.set_open(&id, &true);
    b.ajo.join(&id, &dayo, &s(e, "Dayo"));
    assert_eq!(b.ajo.get_circle(&id).members.len(), 4);
}

#[test]
fn a_circle_holds_at_most_thirty_members() {
    let b = setup();
    let id = b.gather(0);
    for _ in 3..MAX_MEMBERS {
        b.ajo.join(&id, &Address::generate(&b.env), &s(&b.env, "Member"));
    }
    assert_eq!(b.ajo.try_join(&id, &Address::generate(&b.env), &s(&b.env, "One too many")), Err(Ok(Error::CircleFull)));
}

#[test]
fn start_needs_two_members_and_happens_once() {
    let b = setup();
    let e = &b.env;
    let id = b.ajo.create_circle(&b.ada, &s(e, "Solo"), &s(e, "Ada"), &DUES, &WEEK, &0);
    assert_eq!(b.ajo.try_start(&id), Err(Ok(Error::NeedTwoMembers)));
    b.ajo.join(&id, &b.bola, &s(e, "Bola"));
    b.ajo.start(&id);
    let c = b.ajo.get_circle(&id);
    assert!(c.started);
    assert_eq!(c.start_time, START);
    assert_eq!(c.round_ends_at, START + WEEK);
    assert_eq!(b.ajo.try_start(&id), Err(Ok(Error::AlreadyStarted)));
}

#[test]
fn leaving_before_the_start_returns_the_deposit() {
    let b = setup();
    let id = b.gather(DUES);
    assert_eq!(b.money.balance(&b.bola), PURSE - DUES);
    b.ajo.leave(&id, &b.bola);
    assert_eq!(b.money.balance(&b.bola), PURSE);
    let c = b.ajo.get_circle(&id);
    assert_eq!(c.members, vec![&b.env, b.ada.clone(), b.chidi.clone()]);
    assert_eq!(c.names, vec![&b.env, s(&b.env, "Ada"), s(&b.env, "Chidi")]);
    b.check_books_balance(id);

    assert_eq!(b.ajo.try_leave(&id, &b.ada), Err(Ok(Error::HostCannotLeave)));
    assert_eq!(b.ajo.try_leave(&id, &b.bola), Err(Ok(Error::NotAMember)));
    b.ajo.start(&id);
    assert_eq!(b.ajo.try_leave(&id, &b.chidi), Err(Ok(Error::AlreadyStarted)));
}

#[test]
fn a_cancelled_circle_gives_every_deposit_back() {
    let b = setup();
    let id = b.gather(DUES);
    b.ajo.cancel(&id);
    let c = b.ajo.get_circle(&id);
    assert!(c.cancelled && c.finished && !c.open);
    assert_eq!(c.owed, vec![&b.env, DUES, DUES, DUES]);
    b.check_books_balance(id);
    for m in [&b.ada, &b.bola, &b.chidi] {
        b.ajo.claim(&id, m);
        assert_eq!(b.money.balance(m), PURSE);
    }
    assert_eq!(b.money.balance(&b.ajo.address), 0);
    assert_eq!(b.ajo.try_join(&id, &b.newcomer(), &s(&b.env, "Dayo")), Err(Ok(Error::CircleFinished)));
    assert_eq!(b.ajo.try_start(&id), Err(Ok(Error::CircleFinished)));
}

#[test]
fn only_the_host_runs_the_circle() {
    let b = setup();
    let id = b.gather(0);
    b.ajo.start(&id);
    // `start` was authorised by the host (Ada), nobody else.
    let auths = b.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, b.ada);
    b.ajo.set_open(&id, &false);
    assert_eq!(b.env.auths()[0].0, b.ada);
}

// ---------- each turn ----------

#[test]
fn pays_out_the_moment_the_last_member_pays() {
    let b = setup();
    let id = b.open(0);

    b.ajo.contribute(&id, &b.ada);
    b.ajo.contribute(&id, &b.bola);
    let c = b.ajo.get_circle(&id);
    assert_eq!(c.pot, 2 * DUES);
    assert_eq!(c.paid, vec![&b.env, true, true, false]);
    b.check_books_balance(id);

    b.ajo.contribute(&id, &b.chidi);
    let c = b.ajo.get_circle(&id);
    // Ada collects turn 0: she paid 5 in and got 15 out.
    assert_eq!(b.money.balance(&b.ada), PURSE - DUES + 3 * DUES);
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
    let id = b.open(0);
    for _ in 0..3 {
        b.ajo.contribute(&id, &b.ada);
        b.ajo.contribute(&id, &b.bola);
        b.ajo.contribute(&id, &b.chidi);
    }
    let c = b.ajo.get_circle(&id);
    assert!(c.finished && !c.open);
    assert_eq!(c.received, vec![&b.env, 3 * DUES, 3 * DUES, 3 * DUES]);
    assert_eq!(c.missed, vec![&b.env, 0, 0, 0]);
    for m in [&b.ada, &b.bola, &b.chidi] {
        assert_eq!(b.money.balance(m), PURSE);
    }
    assert_eq!(b.money.balance(&b.ajo.address), 0);
    assert_eq!(b.ajo.try_contribute(&id, &b.ada), Err(Ok(Error::CircleFinished)));
}

#[test]
fn cannot_pay_twice_or_from_outside() {
    let b = setup();
    let id = b.open(0);
    b.ajo.contribute(&id, &b.ada);
    assert_eq!(b.ajo.try_contribute(&id, &b.ada), Err(Ok(Error::AlreadyPaidThisRound)));
    assert_eq!(b.ajo.try_contribute(&id, &Address::generate(&b.env)), Err(Ok(Error::NotAMember)));
    assert_eq!(b.ajo.try_contribute(&99, &b.ada), Err(Ok(Error::CircleNotFound)));
}

#[test]
fn only_the_member_can_pay_for_themselves() {
    let b = setup();
    let id = b.open(0);
    b.ajo.contribute(&id, &b.bola);
    let auths = b.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, b.bola);
}

#[test]
fn late_turn_is_closed_and_defaulters_are_marked() {
    let b = setup();
    let id = b.open(0);
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
    assert_eq!(b.money.balance(&b.ada), PURSE + 2 * DUES);
    assert_eq!(c.round_ends_at, START + 2 * WEEK);
}

#[test]
fn a_very_late_close_never_skips_the_next_turn() {
    let b = setup();
    let id = b.open(0);
    let late = START + 5 * WEEK;
    b.env.ledger().set_timestamp(late);
    b.ajo.close_round(&id); // nobody paid turn 0

    let c = b.ajo.get_circle(&id);
    assert_eq!(c.missed, vec![&b.env, 1, 1, 1]);
    assert_eq!(c.received, vec![&b.env, 0, 0, 0]);
    // Bola still gets a full week to be paid.
    assert_eq!(c.round_ends_at, late + WEEK);
    assert_eq!(b.ajo.try_close_round(&id), Err(Ok(Error::RoundStillOpen)));
    b.ajo.contribute(&id, &b.ada);
}

#[test]
fn rejects_bad_circles() {
    let b = setup();
    let e = &b.env;
    assert_eq!(b.ajo.try_create_circle(&b.ada, &s(e, "Circle"), &s(e, "Ada"), &0, &WEEK, &0), Err(Ok(Error::BadAmount)));
    assert_eq!(b.ajo.try_create_circle(&b.ada, &s(e, "Circle"), &s(e, "Ada"), &DUES, &WEEK, &-1), Err(Ok(Error::BadAmount)));
    assert_eq!(b.ajo.try_create_circle(&b.ada, &s(e, "Circle"), &s(e, "Ada"), &DUES, &0, &0), Err(Ok(Error::ZeroDuration)));
    assert_eq!(b.ajo.try_create_circle(&b.ada, &s(e, ""), &s(e, "Ada"), &DUES, &WEEK, &0), Err(Ok(Error::BadName)));
    assert_eq!(b.ajo.try_create_circle(&b.ada, &s(e, "Circle"), &s(e, ""), &DUES, &WEEK, &0), Err(Ok(Error::BadName)));
    assert_eq!(b.ajo.circle_count(), 0);
}

// ---------- deposits ----------

#[test]
fn a_deposit_pays_the_share_of_a_member_who_misses() {
    let b = setup();
    let id = b.open(DUES);
    assert_eq!(b.money.balance(&b.chidi), PURSE - DUES); // deposit locked on joining
    b.check_books_balance(id);

    // Turn 0 (Ada collects): Chidi does not pay.
    b.ajo.contribute(&id, &b.ada);
    b.ajo.contribute(&id, &b.bola);
    b.env.ledger().set_timestamp(START + WEEK + 1);
    b.ajo.close_round(&id);

    let c = b.ajo.get_circle(&id);
    // Ada still gets the full pot: Chidi's deposit paid his share.
    assert_eq!(c.received, vec![&b.env, 3 * DUES, 0, 0]);
    assert_eq!(c.missed, vec![&b.env, 0, 0, 1]);
    assert_eq!(c.deposits, vec![&b.env, DUES, DUES, 0]);
    b.check_books_balance(id);

    // Turn 1 (Bola collects): Chidi misses again, and now nothing covers him.
    b.ajo.contribute(&id, &b.ada);
    b.ajo.contribute(&id, &b.bola);
    b.env.ledger().set_timestamp(START + 2 * WEEK + 1);
    b.ajo.close_round(&id);
    let c = b.ajo.get_circle(&id);
    assert_eq!(c.received, vec![&b.env, 3 * DUES, 2 * DUES, 0]);
    assert_eq!(c.missed, vec![&b.env, 0, 0, 2]);
    b.check_books_balance(id);
}

#[test]
fn unused_deposits_come_back_when_the_circle_ends() {
    let b = setup();
    let id = b.open(DUES);
    for _ in 0..3 {
        b.ajo.contribute(&id, &b.ada);
        b.ajo.contribute(&id, &b.bola);
        b.ajo.contribute(&id, &b.chidi);
    }
    let c = b.ajo.get_circle(&id);
    assert!(c.finished);
    assert_eq!(c.deposits, vec![&b.env, 0, 0, 0]);
    assert_eq!(c.owed, vec![&b.env, DUES, DUES, DUES]);
    b.check_books_balance(id);
    for m in [&b.ada, &b.bola, &b.chidi] {
        b.ajo.claim(&id, m);
        assert_eq!(b.money.balance(m), PURSE);
    }
    assert_eq!(b.money.balance(&b.ajo.address), 0);
}

// ---------- joining a running circle ----------

#[test]
fn a_late_joiner_pays_catch_up_and_everyone_ends_square() {
    let b = setup();
    let e = &b.env;
    let id = b.open(0);

    // Turn 0: all three pay, Ada collects 15.
    b.ajo.contribute(&id, &b.ada);
    b.ajo.contribute(&id, &b.bola);
    b.ajo.contribute(&id, &b.chidi);

    // Dayo joins during turn 1, after Bola has already paid it.
    b.ajo.contribute(&id, &b.bola);
    let dayo = b.newcomer();
    b.ajo.join(&id, &dayo, &s(e, "Dayo"));

    // He paid one catch-up (for turn 0) plus his share of turn 1.
    assert_eq!(b.money.balance(&dayo), PURSE - 2 * DUES);
    let c = b.ajo.get_circle(&id);
    assert_eq!(c.members.len(), 4);
    assert_eq!(c.members.get_unchecked(3), dayo);
    assert_eq!(c.owed, vec![&b.env, DUES, 0, 0, 0]); // the catch-up waits for Ada
    assert_eq!(c.paid, vec![&b.env, false, true, false, true]);
    assert_eq!(c.pot, 2 * DUES);
    assert_eq!(c.current_round, 1);
    b.check_books_balance(id);

    // The circle now runs four turns with a pot of 20.
    b.ajo.contribute(&id, &b.ada);
    b.ajo.contribute(&id, &b.chidi); // turn 1 pays Bola
    assert_eq!(b.ajo.get_circle(&id).received.get_unchecked(1), 4 * DUES);
    for _ in 0..2 {
        for m in [&b.ada, &b.bola, &b.chidi, &dayo] {
            b.ajo.contribute(&id, m);
        }
    }
    let c = b.ajo.get_circle(&id);
    assert!(c.finished);
    assert_eq!(c.received, vec![&b.env, 3 * DUES, 4 * DUES, 4 * DUES, 4 * DUES]);

    b.ajo.claim(&id, &b.ada);
    for m in [&b.ada, &b.bola, &b.chidi, &dayo] {
        assert_eq!(b.money.balance(m), PURSE); // nobody gained, nobody lost
    }
    assert_eq!(b.money.balance(&b.ajo.address), 0);
}

#[test]
fn joining_late_also_locks_the_deposit_and_waits_for_an_overdue_turn_to_close() {
    let b = setup();
    let e = &b.env;
    let id = b.open(DUES);
    let dayo = b.newcomer();

    b.env.ledger().set_timestamp(START + WEEK + 1);
    assert_eq!(b.ajo.try_join(&id, &dayo, &s(e, "Dayo")), Err(Ok(Error::RoundOverdue)));
    b.ajo.close_round(&id); // everyone missed turn 0; deposits fill Ada's pot

    b.ajo.join(&id, &dayo, &s(e, "Dayo"));
    // deposit + catch-up for turn 0 + share of turn 1
    assert_eq!(b.money.balance(&dayo), PURSE - 3 * DUES);
    let c = b.ajo.get_circle(&id);
    assert_eq!(c.deposits, vec![&b.env, 0, 0, 0, DUES]);
    b.check_books_balance(id);
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
    let id = ajo.create_circle(&ada, &s(&env, "Two friends"), &s(&env, "Ada"), &DUES, &WEEK, &0);
    ajo.join(&id, &bola, &s(&env, "Bola"));
    ajo.start(&id);

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
