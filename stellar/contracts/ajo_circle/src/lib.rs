#![no_std]
//! AjoCircle on Stellar: rotating savings (Esusu / Ajo) circles, enforced onchain.
//!
//! SKELETON ONLY. The shapes (types, errors, function signatures) are set up so we
//! don't waste Build Day on boilerplate. Every function body is a `todo!()` that we
//! write together on Thursday, in the room. See ../../BUILD_DAY.md for the order.
//!
//! The rules are the same as the EVM version (../../../contracts/src/AjoCircle.sol):
//!   - fixed, ordered member list + fixed contribution per round
//!   - each round every member pays once; the whole pot goes to that round's member
//!   - the moment the last member pays, the contract pays out
//!   - after the deadline anyone can close the round: recipient gets what came in,
//!     non-payers get a "missed" mark everyone can see

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec};

pub const MAX_MEMBERS: u32 = 50;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Circle {
    pub name: String,
    pub organizer: Address,
    pub contribution: i128, // per member, per round, in token units (USDC = 7 decimals on Stellar)
    pub start_time: u64,    // round 0 opens here (unix seconds)
    pub round_ends_at: u64, // deadline of the current round
    pub round_duration: u64,
    pub current_round: u32, // index into members: whose turn it is
    pub paid_count: u32,
    pub pot: i128,
    pub finished: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberView {
    pub member: Address,
    pub paid_this_round: bool,
    pub missed: u32,
    pub received: i128,
}

/// Where everything lives in contract storage. Replaces Solidity's mappings.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,                         // instance: the USDC token contract address
    CircleCount,                   // instance: u32
    Circle(u32),                   // persistent: Circle
    Members(u32),                  // persistent: Vec<Address> (payout order)
    Paid(u32, u32, Address),       // persistent: (circle, round, member) -> bool
    Missed(u32, Address),          // persistent: (circle, member) -> u32
    PayoutOfRound(u32, u32),       // persistent: (circle, round) -> i128
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    CircleNotFound = 1,
    CircleFinished = 2,
    NotAMember = 3,
    AlreadyPaidThisRound = 4,
    RoundNotOpen = 5,
    RoundOverdue = 6,
    RoundStillOpen = 7,
    BadMembers = 8,
    ZeroAmount = 9,
    ZeroDuration = 10,
    EmptyName = 11,
    AlreadyInitialized = 12,
}

#[contract]
pub struct AjoCircle;

#[contractimpl]
impl AjoCircle {
    /// Runs once at deploy (`stellar contract deploy ... -- --token <USDC_ID>`).
    pub fn __constructor(env: Env, token: Address) {
        let _ = (env, token);
        todo!("BUILD DAY step 1: save token in instance storage, CircleCount = 0")
    }

    /// Open a circle. `members[0]` collects in round 0, `members[1]` in round 1, ...
    /// `start_time = 0` means "now".
    pub fn create_circle(
        env: Env,
        organizer: Address,
        name: String,
        members: Vec<Address>,
        contribution: i128,
        start_time: u64,
        round_duration: u64,
    ) -> Result<u32, Error> {
        let _ = (env, organizer, name, members, contribution, start_time, round_duration);
        todo!("BUILD DAY step 2: organizer.require_auth(), validate, store Circle + Members, emit event")
    }

    /// Pay your share for the current round. If you're the last to pay, the pot
    /// goes straight to this round's recipient.
    /// Stellar win vs EVM: no separate `approve` tx. The member's one signature
    /// covers the USDC transfer inside this call.
    pub fn contribute(env: Env, circle_id: u32, member: Address) -> Result<(), Error> {
        let _ = (env, circle_id, member);
        todo!("BUILD DAY step 3: member.require_auth(), checks, token transfer in, maybe payout")
    }

    /// After a round's deadline anyone can close it.
    pub fn close_round(env: Env, circle_id: u32) -> Result<(), Error> {
        let _ = (env, circle_id);
        todo!("BUILD DAY step 4: check deadline passed, then payout")
    }

    // ---------- views (free to call, no signature) ----------

    pub fn circle_count(env: Env) -> u32 {
        let _ = env;
        todo!("BUILD DAY step 5")
    }

    pub fn get_circle(env: Env, circle_id: u32) -> Result<Circle, Error> {
        let _ = (env, circle_id);
        todo!("BUILD DAY step 5")
    }

    pub fn get_members(env: Env, circle_id: u32) -> Result<Vec<MemberView>, Error> {
        let _ = (env, circle_id);
        todo!("BUILD DAY step 5")
    }
}

mod test;
