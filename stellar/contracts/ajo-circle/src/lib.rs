//! AjoBook on Stellar: rotating savings (Ajo / Esusu) circles.
//!
//! A circle is a fixed, ordered list of members and a fixed contribution.
//! Every round each member pays once, and the whole pot goes to the member
//! whose turn it is, in the order agreed when the circle was opened. Nobody
//! holds the money in between: the moment the last member pays, the contract
//! pays out. If a round's time runs out with people still owing, anyone can
//! close the round: the recipient gets what was collected and the members who
//! did not pay are marked "missed" in the book for everyone to see.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
    String, Vec,
};

/// Most members one circle can have.
pub const MAX_MEMBERS: u32 = 30;
/// Longest circle name / member name, in bytes.
pub const MAX_NAME_LEN: u32 = 64;

// Storage lifetime: every write keeps the book alive for about 90 more days.
const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;

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
    BadName = 11,
    NothingToClaim = 12,
    PayoutFailed = 13,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    Count,
    Circle(u32),
}

/// One page of the book. The four per-member lists (`names`, `paid`,
/// `missed`, `received`) line up with `members`, which is also the payout
/// order: members[0] collects in round 0, members[1] in round 1, and so on.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Circle {
    pub id: u32,
    pub name: String,
    pub organizer: Address,
    /// What each member pays each round, in the token's smallest unit.
    pub contribution: i128,
    /// When round 0 opens (unix seconds).
    pub start_time: u64,
    /// Deadline of the current round (unix seconds).
    pub round_ends_at: u64,
    /// Seconds each round lasts.
    pub round_duration: u64,
    /// Whose turn it is: an index into `members`.
    pub current_round: u32,
    /// Members who have paid in the current round.
    pub paid_count: u32,
    /// Collected so far in the current round.
    pub pot: i128,
    pub finished: bool,
    pub members: Vec<Address>,
    pub names: Vec<String>,
    /// Has each member paid in the current round?
    pub paid: Vec<bool>,
    /// Rounds each member failed to pay.
    pub missed: Vec<u32>,
    /// What each member's turn brought in.
    pub received: Vec<i128>,
    /// Payouts the contract could not deliver (for example the member's
    /// wallet was not ready to hold the token). The money stays here, in
    /// the member's name, until they `claim` it.
    pub owed: Vec<i128>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleCreated {
    #[topic]
    pub id: u32,
    #[topic]
    pub organizer: Address,
    pub name: String,
    pub contribution: i128,
    pub members: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contributed {
    #[topic]
    pub id: u32,
    #[topic]
    pub member: Address,
    pub round: u32,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaidOut {
    #[topic]
    pub id: u32,
    #[topic]
    pub recipient: Address,
    pub round: u32,
    pub amount: i128,
    pub defaulters: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutHeld {
    #[topic]
    pub id: u32,
    #[topic]
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claimed {
    #[topic]
    pub id: u32,
    #[topic]
    pub member: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleFinished {
    #[topic]
    pub id: u32,
}

#[contract]
pub struct AjoCircle;

#[contractimpl]
impl AjoCircle {
    /// `token` is the money every circle in this book is paid in
    /// (the Stellar Asset Contract of USDC, XLM, ...).
    pub fn __constructor(env: Env, token: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Count, &0u32);
    }

    // ---------- opening a circle ----------

    /// Open a circle.
    /// - `members`: payout order. members[0] collects first.
    /// - `names`: one name per member, the way the circle knows them.
    /// - `contribution`: what each member pays each round.
    /// - `start_time`: when round 0 opens (0 = now).
    /// - `round_duration`: seconds per round, e.g. 604800 for a weekly Ajo.
    pub fn create_circle(
        env: Env,
        organizer: Address,
        name: String,
        members: Vec<Address>,
        names: Vec<String>,
        contribution: i128,
        start_time: u64,
        round_duration: u64,
    ) -> Result<u32, Error> {
        organizer.require_auth();

        if name.len() == 0 || name.len() > MAX_NAME_LEN {
            return Err(Error::BadName);
        }
        if contribution <= 0 {
            return Err(Error::ZeroAmount);
        }
        if round_duration == 0 {
            return Err(Error::ZeroDuration);
        }
        let n = members.len();
        if n < 2 || n > MAX_MEMBERS || names.len() != n {
            return Err(Error::BadMembers);
        }
        for i in 0..n {
            let member_name = names.get_unchecked(i);
            if member_name.len() == 0 || member_name.len() > MAX_NAME_LEN {
                return Err(Error::BadName);
            }
            // Nobody can be in the same circle twice.
            let m = members.get_unchecked(i);
            for j in 0..i {
                if members.get_unchecked(j) == m {
                    return Err(Error::BadMembers);
                }
            }
        }

        let now = env.ledger().timestamp();
        let start = if start_time == 0 { now } else { start_time };
        let round_ends_at = start.checked_add(round_duration).ok_or(Error::ZeroDuration)?;

        let id: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let mut paid = Vec::new(&env);
        let mut missed = Vec::new(&env);
        let mut received = Vec::new(&env);
        let mut owed = Vec::new(&env);
        for _ in 0..n {
            paid.push_back(false);
            missed.push_back(0u32);
            received.push_back(0i128);
            owed.push_back(0i128);
        }

        let circle = Circle {
            id,
            name: name.clone(),
            organizer: organizer.clone(),
            contribution,
            start_time: start,
            round_ends_at,
            round_duration,
            current_round: 0,
            paid_count: 0,
            pot: 0,
            finished: false,
            members,
            names,
            paid,
            missed,
            received,
            owed,
        };
        Self::save(&env, &circle);
        env.storage().instance().set(&DataKey::Count, &(id + 1));
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        CircleCreated {
            id,
            organizer,
            name,
            contribution,
            members: n,
        }
        .publish(&env);
        Ok(id)
    }

    // ---------- each round ----------

    /// Pay your contribution for the current round. If you are the last one
    /// to pay, the pot goes straight to this round's recipient.
    pub fn contribute(env: Env, id: u32, member: Address) -> Result<(), Error> {
        member.require_auth();

        let mut c = Self::load(&env, id)?;
        if c.finished {
            return Err(Error::CircleFinished);
        }
        let index = c.members.first_index_of(&member).ok_or(Error::NotAMember)?;
        let now = env.ledger().timestamp();
        if now < c.start_time {
            return Err(Error::RoundNotOpen);
        }
        if now > c.round_ends_at {
            return Err(Error::RoundOverdue);
        }
        if c.paid.get_unchecked(index) {
            return Err(Error::AlreadyPaidThisRound);
        }

        c.paid.set(index, true);
        c.paid_count += 1;
        c.pot += c.contribution;

        Self::money(&env).transfer(&member, &env.current_contract_address(), &c.contribution);
        Contributed {
            id,
            member,
            round: c.current_round,
            amount: c.contribution,
        }
        .publish(&env);

        if c.paid_count == c.members.len() {
            Self::payout(&env, &mut c);
        }
        Self::save(&env, &c);
        Ok(())
    }

    /// After a round's deadline anyone can close it: the recipient gets
    /// whatever was collected and the members who did not pay are marked.
    pub fn close_round(env: Env, id: u32) -> Result<(), Error> {
        let mut c = Self::load(&env, id)?;
        if c.finished {
            return Err(Error::CircleFinished);
        }
        if env.ledger().timestamp() <= c.round_ends_at {
            return Err(Error::RoundStillOpen);
        }
        Self::payout(&env, &mut c);
        Self::save(&env, &c);
        Ok(())
    }

    /// Collect a payout the contract could not deliver on your turn.
    /// Anyone can trigger it; the money only ever goes to the member.
    pub fn claim(env: Env, id: u32, member: Address) -> Result<(), Error> {
        let mut c = Self::load(&env, id)?;
        let index = c.members.first_index_of(&member).ok_or(Error::NotAMember)?;
        let amount = c.owed.get_unchecked(index);
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }
        c.owed.set(index, 0);
        Self::save(&env, &c);
        let sent = Self::money(&env).try_transfer(&env.current_contract_address(), &member, &amount);
        if !matches!(sent, Ok(Ok(()))) {
            return Err(Error::PayoutFailed);
        }
        Claimed { id, member, amount }.publish(&env);
        Ok(())
    }

    // ---------- reading the book ----------

    /// The token every circle in this book is paid in.
    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    pub fn circle_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    pub fn get_circle(env: Env, id: u32) -> Result<Circle, Error> {
        Self::load(&env, id)
    }

    /// Up to `limit` circles starting at `start`, oldest first.
    pub fn get_circles(env: Env, start: u32, limit: u32) -> Vec<Circle> {
        let count = Self::circle_count(env.clone());
        let end = start.saturating_add(limit).min(count);
        let mut out = Vec::new(&env);
        for id in start..end {
            if let Ok(c) = Self::load(&env, id) {
                out.push_back(c);
            }
        }
        out
    }
}

// ---------- internals ----------

impl AjoCircle {
    fn money(env: &Env) -> token::Client<'_> {
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(env, &token)
    }

    fn load(env: &Env, id: u32) -> Result<Circle, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Circle(id))
            .ok_or(Error::CircleNotFound)
    }

    fn save(env: &Env, c: &Circle) {
        let key = DataKey::Circle(c.id);
        env.storage().persistent().set(&key, c);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Close the current round: pay the pot to whoever's turn it is, mark
    /// anyone who did not pay, and open the next round.
    fn payout(env: &Env, c: &mut Circle) {
        let round = c.current_round;
        let n = c.members.len();
        let recipient = c.members.get_unchecked(round);
        let amount = c.pot;

        let mut defaulters = 0u32;
        for i in 0..n {
            if !c.paid.get_unchecked(i) {
                c.missed.set(i, c.missed.get_unchecked(i) + 1);
                defaulters += 1;
            }
            c.paid.set(i, false);
        }

        c.received.set(round, amount);
        c.pot = 0;
        c.paid_count = 0;
        c.current_round = round + 1;

        // The next turn keeps the agreed calendar when things run on time.
        // If this turn was closed late, the next member still gets a full
        // window to be paid, so a late close can never skip someone's turn.
        let now = env.ledger().timestamp();
        let mut next = c.round_ends_at.saturating_add(c.round_duration);
        if next <= now {
            next = now.saturating_add(c.round_duration);
        }
        c.round_ends_at = next;

        if amount > 0 {
            // One member's wallet not being ready must never lock everyone
            // else's money: if the payout cannot be delivered, the round
            // still closes and the pot waits in the book for that member.
            let sent =
                Self::money(env).try_transfer(&env.current_contract_address(), &recipient, &amount);
            if !matches!(sent, Ok(Ok(()))) {
                c.owed.set(round, amount);
                PayoutHeld {
                    id: c.id,
                    recipient: recipient.clone(),
                    amount,
                }
                .publish(env);
            }
        }
        PaidOut {
            id: c.id,
            recipient,
            round,
            amount,
            defaulters,
        }
        .publish(env);

        if c.current_round == n {
            c.finished = true;
            CircleFinished { id: c.id }.publish(env);
        }
    }
}

#[cfg(test)]
mod test;
