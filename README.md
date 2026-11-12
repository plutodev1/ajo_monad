# 📗 AjoBook — Ajo / Esusu savings circles on Stellar

Built at **Boundless Build Day, Uyo — 12 November 2026**.

Millions of Nigerians save through Ajo (Esusu): a group puts in the same amount every week, and each
week the whole pot goes to one member, in turn. It runs on trust, one exercise book and one collector's
pocket. Records get lost, people argue over who paid, and sometimes the collector disappears.

AjoBook keeps the circle exactly as people know it, but the book is a Soroban smart contract on Stellar.
Every payment is written where everyone can read it, and the contract pays the pot out itself.
Nobody holds the money.

## How it works

1. **A host opens a circle**: its name, the host's own name, the contribution, and how often
   (daily, weekly, monthly, or every 5 minutes for a live demo).
2. **Members join by link or QR code** from their own wallets and write their own names in the book.
   They collect in the order they joined.
3. **The host starts the circle.** Each turn every member pays in with one signature.
4. **Automatic payout.** The moment the last member pays, the contract sends the whole pot to the
   member whose turn it is.

And for when things don't go to plan:

- **Deposits.** A circle can ask each member to lock a deposit of one contribution when joining. If a
  member misses a turn, their deposit pays their share, so the person collecting still gets the full
  pot. Unused deposits go back at the end.
- **Late turns.** After a turn's deadline anyone can close it. Members who did not pay are marked
  "missed" in the book for everyone to see.
- **Joining late.** While the host keeps the circle open, someone can join a circle that is already
  running. They go to the end of the order and pay a catch-up of one contribution for every turn
  already paid out, shared among the members who collected before they joined, so everyone ends square.
- **No stuck money.** Anything the contract could not deliver (for example to a wallet that can't
  hold USDC yet) waits in the book under that member's name until they collect it.
- **The book's history.** Every circle shows what has happened in it, each line linked to its
  transaction on Stellar.

## Why Stellar

- Fees are a fraction of a cent, so small daily or weekly contributions make sense.
- Payments settle in about five seconds.
- Paying in is a single signature: no separate "approve" step.
- USDC is a native asset, and Stellar's anchor network is the path to naira cash in and out.

## Try it

1. Install the [Freighter](https://www.freighter.app) wallet and switch it to **Test Net**.
2. Open the app, click **Open my wallet**, then **Get free test XLM**.
3. Host a circle, share the link, and have a friend join.

| Book | Contract on Stellar testnet |
| --- | --- |
| Test XLM (the default) | [`CCZ44HGE…Y6WPA`](https://stellar.expert/explorer/testnet/contract/CCZ44HGELOAE7WM6JE6LG6VA3KIYKKS6XFPZRYJDOWJWV42UPYRY6WPA) |
| Test USDC (add `?book=CCR7PIGHBTXL7KKAOSHOWOYQJNJ35KLEUTGST3IQYQSSGRIARU2TBVNE` to the link) | [`CCR7PIGH…TBVNE`](https://stellar.expert/explorer/testnet/contract/CCR7PIGHBTXL7KKAOSHOWOYQJNJ35KLEUTGST3IQYQSSGRIARU2TBVNE) |

Add `?book=new` to the link to set up a separate book for your own community (two signatures).

## What's in here

| Path | What |
| --- | --- |
| [`contract/contracts/ajo-circle`](contract/contracts/ajo-circle/src/lib.rs) | The Soroban contract (Rust) and its 19 tests |
| [`web/src/chain.js`](web/src/chain.js) | Everything the app does on the network |
| [`web/src/main.js`](web/src/main.js) | The page |
| [`web/scripts/e2e.mjs`](web/scripts/e2e.mjs) | Deploys a fresh book on testnet and runs a circle end to end |

```bash
cd contract && cargo test          # contract tests
./build.sh                         # rebuild the contract and re-embed it in the web app
cd ../web && npm ci
npm run dev                        # run the page locally
npm run e2e                        # full circle on Stellar testnet
npm run deploy                     # put a fresh, empty book on testnet (add "USDC" for a USDC book)
```

The contract has no owner or admin: whoever deploys a book has no special power over it, and a host can
only start their circle, open or close joining, and call it off before it starts.

## Roadmap

- Naira on and off ramps through Stellar anchors
- Passkey wallets, so members need no browser extension or seed phrase
- Sponsored fees, so members never need XLM
- Reputation that follows a member from one circle to the next
- A pilot with a real circle in Port Harcourt through ChainConnect NG

## Credits

Built by Favour Ekeleme (PlutoDev), ChainConnect NG. The exercise-book look follows an earlier
dues-ledger design of mine; the Soroban contract and this app were written at Boundless Build Day.
