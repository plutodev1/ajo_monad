# AjoBook on Stellar

Esusu circles (rotating Ajo) rebuilt for Stellar, with **passkey wallets**: members join
with Face ID or a fingerprint instead of a seed phrase.

> **Status: prep skeleton.** Types, errors and function signatures are in place and the
> project compiles. The contract logic is written live at **Boundless Build Day, Uyo
> (Thu 12 Nov 2026)**. The hour-by-hour plan and pitch notes are in [BUILD_DAY.md](BUILD_DAY.md).

```
stellar/
├── Cargo.toml                      workspace + release profile (64KB wasm limit)
├── contracts/ajo_circle/src/lib.rs contract skeleton: every body is todo!()
├── contracts/ajo_circle/src/test.rs test harness: fake USDC + funded members
└── BUILD_DAY.md                    Thursday plan, demo script, pitch
```

---

## Before Thursday: setup (Mon–Tue, ~1 hour)

Do this on the laptop you'll bring. Venue Wi-Fi will be slow, so download everything at home.

```bash
# 1. Rust + the wasm target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none

# 2. Stellar CLI (takes a while to compile, so start it and go eat)
cargo install --locked stellar-cli
stellar --version

# 3. A testnet identity, funded by friendbot
stellar keys generate pluto --network testnet --fund
stellar keys address pluto

# 4. Check the skeleton compiles and pull every crate now, while you're on good internet
cd stellar
cargo test          # "0 passed" is correct: tests get written on the day
stellar contract build
```

Also install **Freighter** (browser wallet) and switch it to Testnet. It's the fallback
if passkeys fight us.

### Tuesday homework: try passkeys before we bet on them

Clone and run one of these on testnet and get one passkey wallet created end-to-end:

- **`@boundlessfi/identity-sdk`**: Boundless's own passkey SDK, built on Smart Account Kit.
  The organisers built this, so using it on their Build Day is a very strong signal.
- **`smart-account-kit`**: the current Stellar smart-wallet SDK (OpenZeppelin smart accounts).

If one of them creates a wallet in under an hour, passkeys are the plan. If not, we build
with Freighter and passkeys become one slide in the pitch. Tell me on Wednesday which way it went.

---

## Solidity → Soroban cheat sheet (for our contract)

| In `AjoCircle.sol` | On Stellar |
|---|---|
| `msg.sender` | No such thing. Pass the address in and call `member.require_auth()` |
| `token.approve` + `transferFrom` (2 txs) | `token::Client::new(&env, &usdc).transfer(&member, &contract, &amt)`. **One signature, no approve.** That's a pitch point |
| `mapping(...)` | `env.storage().persistent().set(&DataKey::Paid(id, round, m), &true)` |
| contract-wide vars (`token`) | `env.storage().instance()` |
| `block.timestamp` | `env.ledger().timestamp()` |
| `revert NotAMember()` | `return Err(Error::NotAMember)` (or `panic_with_error!`) |
| `emit PaidOut(...)` | `env.events().publish((symbol_short!("paid_out"), id), (recipient, amount))` |
| `address(this)` | `env.current_contract_address()` |
| `uint256` money | `i128` (Stellar's token standard uses i128) |
| storage lives forever | Storage has a TTL: call `extend_ttl` on circle data when it's written |
| USDC has 6 decimals | USDC on Stellar has **7** decimals: 5 USDC = `50_000_000` |

Handy CLI commands:

```bash
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/ajo_circle.wasm \
  --source pluto --network testnet -- --token <TOKEN_CONTRACT_ID>
stellar contract invoke --id <AJO_ID> --source pluto --network testnet -- circle_count
stellar contract bindings typescript --contract-id <AJO_ID> --network testnet --output-dir ../web-stellar/ajo
```

**Which token to use for the demo:** testnet USDC from faucet.circle.com (pick Stellar) is
the real story. If trustlines or the faucet slow us down, use the native XLM token contract
(`stellar contract id asset --asset native --network testnet`). The contract doesn't care
which token it's given.
