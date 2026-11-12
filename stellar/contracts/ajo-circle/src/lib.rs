//! AjoBook on Stellar: rotating savings (Ajo / Esusu) circles.
//!
//! A host opens a circle and shares the link. Members join from their own
//! wallets and write their own names in the book. When the host starts the
//! circle, every member pays the same contribution each turn and the whole
//! pot goes to one member per turn, in the order they joined. Nobody holds
//! the money in between: the moment the last member pays, the contract pays
//! out.
//!
//! - Late turns: after a turn's deadline anyone can close it. The recipient
//!   gets what came in and members who did not pay are marked "missed".
//! - Deposits: a circle can ask every member to lock a deposit when joining.
//!   If a member misses a turn, their deposit pays their share so the
//!   recipient still gets the full pot. Unused deposits go back at the end.
//! - Joining late: while the host keeps the circle open, new members can
//!   join a running circle. They go to the end of the order and pay a
//!   catch-up of one contribution for every turn already paid out, which is
//!   shared among the members who collected before they joined, so everyone
//!   ends the circle square.
//! - No stuck money: anything the contract could not deliver, plus catch-up
//!   shares and returned deposits, waits in the book under the member's name
//!   until they `claim` it.
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
    NotStarted = 5,
    RoundOverdue = 6,
    RoundStillOpen = 7,
    BadAmount = 9,
    ZeroDuration = 10,
    BadName = 11,
    NothingToClaim = 12,
    PayoutFailed = 13,
    ClosedToNewMembers = 14,
    AlreadyAMember = 15,
    AlreadyStarted = 16,
    CircleFull = 17,
    NeedTwoMembers = 18,
    HostCannotLeave = 19,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    Count,
    Circle(u32),
}

/// One page of the book. The per-member lists (`names`, `paid`, `missed`,
/// `received`, `owed`, `deposits`) line up with `members`, which is also the
/// payout order: members[0] collects in turn 0, members[1] in turn 1, ...
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Circle {
    pub id: u32,
    pub name: String,
    /// The host: opened the circle, starts it, and decides whether new
    /// members may still join. The host never holds anyone's money.
    pub organizer: Address,
    /// What each member pays each turn, in the token's smallest unit.
    pub contribution: i128,
    /// What each member locks when joining (0 = this circle has no deposit).
    pub deposit: i128,
    /// May new members still join?
    pub open: bool,
    pub started: bool,
    /// The host called the circle off before it started.
    pub cancelled: bool,
    pub finished: bool,
    /// When the host started the circle (unix seconds, 0 = not yet).
    pub start_time: u64,
    /// Deadline of the current turn (unix seconds).
    pub round_ends_at: u64,
    /// Seconds each turn lasts.
    pub round_duration: u64,
    /// Whose turn it is: an index into `members`.
    pub current_round: u32,
    /// Members who have paid in the current turn.
    pub paid_count: u32,
    /// Collected so far in the current turn.
    pub pot: i128,
    pub members: Vec<Address>,
    pub names: Vec<String>,
    /// Has each member paid in the current turn?
    pub paid: Vec<bool>,
    /// Turns each member failed to pay (whether or not a deposit covered it).
    pub missed: Vec<u32>,
    /// What each member's turn brought in.
    pub received: Vec<i128>,
    /// Money waiting in the book for each member to `claim`.
    pub owed: Vec<i128>,
    /// What is left of each member's deposit.
    pub deposits: Vec<i128>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleCreated {
    #[topic]
    pub id: u32,
    #[topic]
    pub member: Address,
    pub name: String,
    pub contribution: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Joined {
    #[topic]
    pub id: u32,
    #[topic]
    pub member: Address,
    pub name: String,
    /// Everything the member paid to join: deposit, catch-up, this turn.
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Left {
    #[topic]
    pub id: u32,
    #[topic]
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Started {
    #[topic]
    pub id: u32,
    pub members: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Cancelled {
    #[topic]
    pub id: u32,
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
    pub member: Address,
    pub round: u32,
    pub amount: i128,
    /// Members who did not pay this turn.
    pub defaulters: u32,
    /// Of those, how many had their share paid from their deposit.
    pub covered: u32,
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

    // ---------- gathering members ----------

    /// Open a circle. The host is its first member (and collects first).
    /// - `host_name`: the host's name, the way the circle knows them.
    /// - `contribution`: what each member pays each turn.
    /// - `round_duration`: seconds per turn, e.g. 604800 for a weekly Ajo.
    /// - `deposit`: what each member locks when joining (0 = no deposit).
    pub fn create_circle(
        env: Env,
        host: Address,
        name: String,
        host_name: String,
        contribution: i128,
        round_duration: u64,
        deposit: i128,
    ) -> Result<u32, Error> {
        host.require_auth();
        Self::check_name(&name)?;
        Self::check_name(&host_name)?;
        if contribution <= 0 || deposit < 0 {
            return Err(Error::BadAmount);
        }
        if round_duration == 0 {
            return Err(Error::ZeroDuration);
        }

        let id: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let mut c = Circle {
            id,
            name: name.clone(),
            organizer: host.clone(),
            contribution,
            deposit,
            open: true,
            started: false,
            cancelled: false,
            finished: false,
            start_time: 0,
            round_ends_at: 0,
            round_duration,
            current_round: 0,
            paid_count: 0,
            pot: 0,
            members: Vec::new(&env),
            names: Vec::new(&env),
            paid: Vec::new(&env),
            missed: Vec::new(&env),
            received: Vec::new(&env),
            owed: Vec::new(&env),
            deposits: Vec::new(&env),
        };
        Self::add_member(&mut c, &host, &host_name);
        if deposit > 0 {
            Self::money(&env).transfer(&host, &env.current_contract_address(), &deposit);
        }
        Self::save(&env, &c);
        env.storage().instance().set(&DataKey::Count, &(id + 1));
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        CircleCreated {
            id,
            member: host,
            name,
            contribution,
        }
        .publish(&env);
        Ok(id)
    }

    /// Join a circle and write your name in the book.
    ///
    /// Before the circle starts this costs only the deposit (if any). In a
    /// running circle the new member goes to the end of the order and pays,
    /// in one go: the deposit, their share of the current turn, and a
    /// catch-up of one contribution for every turn already paid out. The
    /// catch-up is shared among the members who have already collected, so
    /// nobody gains or loses by someone joining late.
    pub fn join(env: Env, id: u32, member: Address, name: String) -> Result<(), Error> {
        member.require_auth();
        Self::check_name(&name)?;

        let mut c = Self::load(&env, id)?;
        if c.finished {
            return Err(Error::CircleFinished);
        }
        if !c.open {
            return Err(Error::ClosedToNewMembers);
        }
        if c.members.contains(&member) {
            return Err(Error::AlreadyAMember);
        }
        if c.members.len() >= MAX_MEMBERS {
            return Err(Error::CircleFull);
        }

        let mut amount = c.deposit;
        if c.started {
            if env.ledger().timestamp() > c.round_ends_at {
                // The current turn must be closed before the order changes.
                return Err(Error::RoundOverdue);
            }
            // Catch-up: one contribution per finished turn, shared equally
            // among the members who collected in those turns.
            let done = c.current_round;
            for i in 0..done {
                c.owed.set(i, c.owed.get_unchecked(i) + c.contribution);
            }
            amount += c.contribution * done as i128;
            // ...and their share of the turn that is running now.
            amount += c.contribution;
            c.pot += c.contribution;
            c.paid_count += 1;
        }
        Self::add_member(&mut c, &member, &name);
        if c.started {
            c.paid.set(c.members.len() - 1, true);
        }

        if amount > 0 {
            Self::money(&env).transfer(&member, &env.current_contract_address(), &amount);
        }
        Self::save(&env, &c);
        Joined {
            id,
            member,
            name,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Change your mind before the circle starts: your deposit comes back.
    pub fn leave(env: Env, id: u32, member: Address) -> Result<(), Error> {
        member.require_auth();
        let mut c = Self::load(&env, id)?;
        if c.finished {
            return Err(Error::CircleFinished);
        }
        if c.started {
            return Err(Error::AlreadyStarted);
        }
        if member == c.organizer {
            return Err(Error::HostCannotLeave);
        }
        let i = c.members.first_index_of(&member).ok_or(Error::NotAMember)?;
        let refund = c.deposits.get_unchecked(i);
        c.members.remove(i);
        c.names.remove(i);
        c.paid.remove(i);
        c.missed.remove(i);
        c.received.remove(i);
        c.owed.remove(i);
        c.deposits.remove(i);
        Self::save(&env, &c);
        if refund > 0 {
            Self::money(&env).transfer(&env.current_contract_address(), &member, &refund);
        }
        Left { id, member }.publish(&env);
        Ok(())
    }

    /// Host only, before the circle starts: call it off. Every deposit is
    /// set aside for its member to collect.
    pub fn cancel(env: Env, id: u32) -> Result<(), Error> {
        let mut c = Self::load(&env, id)?;
        c.organizer.require_auth();
        if c.finished {
            return Err(Error::CircleFinished);
        }
        if c.started {
            return Err(Error::AlreadyStarted);
        }
        c.cancelled = true;
        c.open = false;
        c.finished = true;
        Self::release_deposits(&mut c);
        Self::save(&env, &c);
        Cancelled { id }.publish(&env);
        Ok(())
    }

    /// Host only: begin turn 1. Needs at least two members.
    pub fn start(env: Env, id: u32) -> Result<(), Error> {
        let mut c = Self::load(&env, id)?;
        c.organizer.require_auth();
        if c.finished {
            return Err(Error::CircleFinished);
        }
        if c.started {
            return Err(Error::AlreadyStarted);
        }
        if c.members.len() < 2 {
            return Err(Error::NeedTwoMembers);
        }
        let now = env.ledger().timestamp();
        c.started = true;
        c.start_time = now;
        c.round_ends_at = now.saturating_add(c.round_duration);
        Self::save(&env, &c);
        Started {
            id,
            members: c.members.len(),
        }
        .publish(&env);
        Ok(())
    }

    /// Host only: let new members join, or stop them.
    pub fn set_open(env: Env, id: u32, open: bool) -> Result<(), Error> {
        let mut c = Self::load(&env, id)?;
        c.organizer.require_auth();
        if c.finished {
            return Err(Error::CircleFinished);
        }
        c.open = open;
        Self::save(&env, &c);
        Ok(())
    }

    // ---------- each turn ----------

    /// Pay your contribution for the current turn. If you are the last one
    /// to pay, the pot goes straight to this turn's recipient.
    pub fn contribute(env: Env, id: u32, member: Address) -> Result<(), Error> {
        member.require_auth();

        let mut c = Self::load(&env, id)?;
        if c.finished {
            return Err(Error::CircleFinished);
        }
        if !c.started {
            return Err(Error::NotStarted);
        }
        let index = c.members.first_index_of(&member).ok_or(Error::NotAMember)?;
        if env.ledger().timestamp() > c.round_ends_at {
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

    /// After a turn's deadline anyone can close it. Members who did not pay
    /// are marked; where they have a deposit it pays their share. The
    /// recipient gets everything that came in.
    pub fn close_round(env: Env, id: u32) -> Result<(), Error> {
        let mut c = Self::load(&env, id)?;
        if c.finished {
            return Err(Error::CircleFinished);
        }
        if !c.started {
            return Err(Error::NotStarted);
        }
        if env.ledger().timestamp() <= c.round_ends_at {
            return Err(Error::RoundStillOpen);
        }
        Self::payout(&env, &mut c);
        Self::save(&env, &c);
        Ok(())
    }

    /// Collect money waiting in the book under your name: an undelivered
    /// payout, catch-up from late joiners, or a returned deposit.
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

    fn check_name(name: &String) -> Result<(), Error> {
        if name.len() == 0 || name.len() > MAX_NAME_LEN {
            return Err(Error::BadName);
        }
        Ok(())
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

    /// Write a new member at the end of the book, with their deposit.
    fn add_member(c: &mut Circle, member: &Address, name: &String) {
        c.members.push_back(member.clone());
        c.names.push_back(name.clone());
        c.paid.push_back(false);
        c.missed.push_back(0);
        c.received.push_back(0);
        c.owed.push_back(0);
        c.deposits.push_back(c.deposit);
    }

    /// Set every remaining deposit aside for its member to collect.
    fn release_deposits(c: &mut Circle) {
        for i in 0..c.members.len() {
            let left = c.deposits.get_unchecked(i);
            if left > 0 {
                c.owed.set(i, c.owed.get_unchecked(i) + left);
                c.deposits.set(i, 0);
            }
        }
    }

    /// Close the current turn: pay the pot to whoever's turn it is, mark
    /// anyone who did not pay, and open the next turn.
    fn payout(env: &Env, c: &mut Circle) {
        let round = c.current_round;
        let n = c.members.len();
        let recipient = c.members.get_unchecked(round);

        let mut defaulters = 0u32;
        let mut covered = 0u32;
        for i in 0..n {
            if !c.paid.get_unchecked(i) {
                c.missed.set(i, c.missed.get_unchecked(i) + 1);
                defaulters += 1;
                // A deposit pays the share of a member who did not.
                let left = c.deposits.get_unchecked(i);
                if left >= c.contribution {
                    c.deposits.set(i, left - c.contribution);
                    c.pot += c.contribution;
                    covered += 1;
                }
            }
            c.paid.set(i, false);
        }

        let amount = c.pot;
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
            // else's money: if the payout cannot be delivered, the turn
            // still closes and the pot waits in the book for that member.
            let sent =
                Self::money(env).try_transfer(&env.current_contract_address(), &recipient, &amount);
            if !matches!(sent, Ok(Ok(()))) {
                c.owed.set(round, c.owed.get_unchecked(round) + amount);
            }
        }
        PaidOut {
            id: c.id,
            member: recipient,
            round,
            amount,
            defaulters,
            covered,
        }
        .publish(env);

        if c.current_round == n {
            c.finished = true;
            c.open = false;
            Self::release_deposits(c);
            CircleFinished { id: c.id }.publish(env);
        }
    }
}

#[cfg(test)]
mod test;
