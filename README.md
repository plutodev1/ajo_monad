# 📗 AjoBook — the onchain dues book

**Live app:** https://plutodev1.github.io/ajobook/ · **Contract (Monad testnet):** [`0xE64f39E74Caf57Dfe7b886cdBbAcC463af877723`](https://testnet.monadvision.com/address/0xE64f39E74Caf57Dfe7b886cdBbAcC463af877723) (verified) · **Demo video:** _coming soon_

## The problem (mine, personally)

I run **ChainConnect NG**, a crypto community in Nigeria. Every month I collect dues and
event contributions, and every month the same circus repeats:

- "I sent it o! Check your alert." — and now I'm scrolling bank alerts at midnight
- A WhatsApp thread of blurry transfer screenshots as "receipts"
- A spreadsheet only I can see, so members just have to trust my bookkeeping
- New treasurer? The entire payment history lives in my head and my inbox

In Nigeria we call group contributions **Ajo**. Traditionally, the Ajo keeper writes every
contribution in a physical book that members can inspect. Somewhere between the paper
book and the WhatsApp group, we lost the "everyone can inspect it" part.

## The solution

AjoBook puts the Ajo book on the Monad blockchain:

- The **keeper (admin)** opens a "page" — a campaign like *July 2026 Dues* (fixed amount)
  or *Lagos Meetup Fund* (any amount), optionally with a deadline.
- **Members** connect a wallet, write their display name into the book once
  ("Ada from Enugu", not `0x1a2b…`), and pay MON directly into the contract.
- **Everyone** sees the same ledger: who paid, how much, when — live, unfakeable,
  and permanent. No screenshots. No "please resend your receipt."
- The keeper withdraws collected funds to the community treasury, and that withdrawal
  is also written in the book.

One contract, one page per campaign, zero arguments about who paid.

## How it works

```
contracts/           Foundry project
  src/AjoBook.sol    the whole dues book: campaigns, payments, names, ledger views
  test/AjoBook.t.sol 17 tests incl. fuzzing (forge test)

web/                 Vite + viem single-page app (no framework)
  index.html         the book: cover, campaign pages, ledger tables, keeper's desk
  src/main.js        wallet connect, chain switching, reads + writes via viem
```

- **Chain:** Monad testnet (chain id 10143)
- **Stack:** Solidity 0.8.24 + Foundry · viem · Vite · vanilla JS
- **Design:** styled after the physical Ajo ledger book — paper, ink, ruled lines, PAID stamps

## Run it yourself

```bash
# contracts
cd contracts && forge test

# frontend (against the deployed testnet contract)
cd web && npm install && npm run dev
```

To point at your own deployment: deploy `AjoBook.sol` with your community's name as the
constructor argument, then put the address in `web/src/config.js`.

```bash
forge create src/AjoBook.sol:AjoBook \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $PK --broadcast \
  --constructor-args "Your Community Name"
```

## Why this is real

This isn't a demo-ware idea — it's July, and ChainConnect NG dues are due. The first
campaign on the deployed contract is our actual July collection. If it saves me one
evening of receipt-chasing per month, it has already paid for itself.
