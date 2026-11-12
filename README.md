# 📗 AjoBook — the onchain Ajo book

**Live app:** https://plutodev1.github.io/ajo_monad/ · **Networks:** Stellar testnet (XLM or USDC), Arbitrum Sepolia (USDC) and Monad testnet (MON) · **Demo video:** _coming soon_

Pick the network with the **Arbitrum / Monad** switch in the top bar (or link straight to one with
`?net=monad` / `?net=arbitrum`). Arbitrum has the USDC dues book and Esusu circles; Monad keeps the
original dues book, including ChainConnect NG's July 2026 collection.

## New: AjoBook on Stellar

**Open it:** https://plutodev1.github.io/ajo_monad/stellar.html (or the **Stellar** button in the top bar).
Built at Boundless Build Day, Uyo, 12 Nov 2026.

Esusu circles as a Soroban smart contract ([`stellar/contracts/ajo-circle`](stellar/contracts/ajo-circle/src/lib.rs)):

- **Start a circle.** Name it, set the amount and how often (daily, weekly, monthly, or every 5 minutes
  for a live demo), and list the members by name in the order they collect.
- **Pay in.** Each member puts in their share with one signature. There is no separate "approve" step on Stellar.
- **Automatic payout.** The moment the last member pays, the contract sends the whole pot to the member
  whose turn it is. Nobody holds the money in between.
- **Late turns.** After the deadline anyone can close the turn: the recipient gets what came in and
  members who didn't pay are marked "missed" in the book.
- **No stuck money.** If a payout can't be delivered (say the member's wallet can't hold USDC yet), the
  circle carries on and the pot waits in the book until that member collects it.

**Try it (2 minutes):** install the [Freighter](https://www.freighter.app) wallet, switch it to **Test Net**,
open the link, click **Open my wallet**, then **Get free test XLM**. The first person to open a fresh
deployment sees a one-time **Set up the book** screen (two signatures) and gets a link to share.

**For developers**

```bash
cd stellar && cargo test            # 10 contract tests
./build.sh                          # rebuild the contract and re-embed it in the web app
cd ../web && npm ci && npm run e2e  # deploy a fresh book on testnet and run a full circle end to end
```

Fees are a fraction of a cent and payments settle in about five seconds, which is what makes small daily
or weekly contributions practical. Next on the roadmap: member deposits against default, onchain
reputation across circles, and naira on/off-ramps through Stellar anchors.

---

AjoBook has two books in one app:

- **📗 Dues book** — a keeper opens a page ("November dues"), members pay in USDC, and everyone reads the same ledger.
- **🔁 Esusu circles** — rotating savings. Everyone puts in the same amount each turn, and the whole pot goes to one member per turn, in an agreed order. The contract holds the money and pays out the moment the last person pays, so nobody has to trust a collector.

## The problem (mine, personally)

I run **ChainConnect NG**, a crypto community in Nigeria. Every month I collect dues and
event contributions, and every month the same circus repeats:

- "I sent it o! Check your alert." — and now I'm scrolling bank alerts at midnight
- A WhatsApp thread of blurry transfer screenshots as "receipts"
- A spreadsheet only I can see, so members just have to trust my bookkeeping
- New treasurer? The entire payment history lives in my head and my inbox

In Nigeria we call group contributions **Ajo** (or **Esusu**). Traditionally, the Ajo keeper
writes every contribution in a physical book that members can inspect, and in a rotating
Ajo the collector holds everyone's money until it's the next person's turn — which is
exactly where Ajo goes wrong when a collector disappears.

## The solution

AjoBook puts the Ajo book on Arbitrum and the money in USDC, so a naira-weak month doesn't
eat the pot:

- **Dues book.** The keeper opens a page, members sign their name and pay, and the ledger
  — who paid, how much, when — is public and permanent. Withdrawals to the treasury are
  written in the book too.
- **Esusu circles.** Anyone can start a circle: name it, set the amount and how often
  (daily, weekly, monthly), and list members in the order they collect. Each turn, members
  pay their share; when the last one pays, the pot goes straight to whoever's turn it is.
  If time runs out, anyone can close the turn: the recipient gets what came in, and
  members who didn't pay are marked "missed" for the whole circle to see.

---

## How to use the app (2 minutes)

### What you need

1. **A browser wallet.** Any EVM browser wallet works — [MetaMask](https://metamask.io),
   [Rabby](https://rabby.io), [OKX Wallet](https://web3.okx.com), Coinbase Wallet…
   If you have several installed, AjoBook lets you pick one. You can sign out any time
   from the top-right corner.
2. **Free test ETH for gas** on Arbitrum Sepolia — from any Arbitrum Sepolia faucet
   (e.g. the [Alchemy](https://www.alchemy.com/faucets/arbitrum-sepolia) or
   [QuickNode](https://faucet.quicknode.com/arbitrum/sepolia) faucet).
3. **Free test USDC** from [faucet.circle.com](https://faucet.circle.com) — choose
   *Arbitrum Sepolia* and paste your wallet address.

### As a member

1. Open **https://plutodev1.github.io/ajo_monad/**. You can read the whole book without
   connecting anything.
2. Click **"Open my wallet"** (top right). MetaMask pops up — approve the connection.
   The app adds and switches to the Arbitrum Sepolia network for you automatically;
   approve that too when MetaMask asks.
3. **Sign the book.** On the dashed line, write your name the way members know you —
   *"Ada from Enugu"* — and click **"Write it in the book"**. Confirm in MetaMask.
   You only do this once; your name sticks for every page.
4. **Pay your dues.** Click **"Pay my dues — $5.00"** (or on an open-amount page,
   enter what you're giving). The first time, your wallet asks you to *allow* AjoBook to
   take that much USDC, then to pay — two quick confirmations. A violet **PAID ✓** stamp lands
   next to your name, and everyone in the community can see it.
5. Use the tabs above the page to flip to other campaigns.

### As the keeper (admin)

If you're connected with the wallet that deployed the contract, a **Keeper's desk**
appears below the book. From there you can:

- **Open a new page** — name it ("August 2026 dues"), add a line of detail, set the
  dues amount (or leave 0 to accept any amount), and an optional deadline.
- **Close this page** — stops further payments on the current campaign.
- **Move it to the treasury** — withdraw collected USDC to any address. The withdrawal
  is recorded onchain like everything else.

### Esusu circles

1. Switch to **🔁 Esusu circles** at the top.
2. **Start a circle** (any wallet can): name it, set each person's share in USDC and how
   often, and paste members' wallet addresses — one per line, *in the order they collect*.
   "Add my address" drops yours in.
3. Each turn, members click **"Put in my $10.00"**. When the last member pays, the pot
   lands in the wallet of whoever's turn it is, automatically.
4. If a turn's time runs out, anyone can press **"Close this turn"**: the recipient gets
   what came in, and anyone who didn't pay is marked *missed*.

Members' names come from the dues book, so signing your name once covers both.

### Verify nothing is hidden

Every number in the app comes straight from the chain. Use the **"read the book's
contract ↗"** link at the bottom of the app to open the verified contract on Blockscout.

---

## Set it up for your own community

You'll need [Node.js](https://nodejs.org) 20+, [Foundry](https://getfoundry.sh), and git.

### 1. Get the code

```bash
git clone https://github.com/plutodev1/ajo_monad.git
cd ajo_monad
```

### 2. Test the contracts

```bash
cd contracts
forge test        # 30 tests (dues book + Esusu circles), all green
```

### 3. Deploy to Arbitrum Sepolia

Put your deployer key in Foundry's encrypted keystore (it asks for the key and a password;
nothing is saved in plain text), and give that wallet a little Arbitrum Sepolia ETH:

```bash
cast wallet import deployer --interactive
```

Deploy both contracts — the dues book and the Esusu circles — against Circle's test USDC,
and verify them on Blockscout in the same step:

```bash
COMMUNITY_NAME="ChainConnect NG" forge script script/Deploy.s.sol \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --account deployer --broadcast \
  --verify --verifier blockscout \
  --verifier-url https://arbitrum-sepolia.blockscout.com/api/
```

It prints the `AjoBook` and `AjoCircle` addresses. The wallet that deploys is the dues
book's keeper.

**Going to mainnet (Arbitrum One):** use `--rpc-url https://arb1.arbitrum.io/rpc` and
`--verifier-url https://arbitrum.blockscout.com/api/`. The script picks real USDC
(`0xaf88…5831`) automatically on chain 42161.

### 4. Point the app at your contracts

Edit `web/src/config.js` and fill in `book` and `circles` under the `arbitrum` network.
Or skip the command line: open the live app on Arbitrum while those are empty, connect the
keeper wallet, and press **Deploy the book** — it creates both contracts from your wallet and
shows the addresses to paste in.

### 5. Run the app

```bash
cd web
npm install
npm run dev       # opens on http://localhost:5173
```

### 6. Host it (free, GitHub Pages)

Push the repo to GitHub. The included workflow
(`.github/workflows/pages.yml`) builds and publishes the app automatically on every
push to `main` — your site appears at `https://<username>.github.io/ajo_monad/`.
If your repo has a different name, change `base` in `web/vite.config.js` to match.

---

## How it's built

```
contracts/             Foundry project
  src/AjoBook.sol      the dues book: campaigns, USDC payments, names, ledger views
  src/AjoCircle.sol    Esusu circles: ordered turns, auto-payout, missed-turn record
  src/SafeToken.sol    minimal safe ERC-20 transfers
  script/Deploy.s.sol  deploys both against USDC (Arbitrum Sepolia or One)
  test/                30 tests incl. fuzzing, with a 6-decimal mock USDC

web/                 Vite + viem single-page app (no framework)
  index.html         the book: page, ledger rows, keeper's desk
  src/main.js        wallet connect, chain switching, USDC approvals, both books via viem
  src/config.js      the networks (Arbitrum, Monad): chains, contract and token addresses
```

- **Chain:** Arbitrum Sepolia (chain id 421614) → Arbitrum One for mainnet
- **Money:** USDC (6 decimals) — Circle's test USDC on Sepolia, native USDC on Arbitrum One
- **Stack:** Solidity 0.8.24 + Foundry · viem · Vite · vanilla JS
- **Design:** styled after the physical exercise book used at real Ajo meetings —
  cream paper, ruled lines, red margin, and a violet ink **PAID ✓** stamp

## Why this is real

AjoBook started on Monad testnet (contract `0xE64f39E74Caf57Dfe7b886cdBbAcC463af877723`),
where the first campaign was ChainConnect NG's real July dues collection. It now lives on
Arbitrum with USDC, and adds Esusu circles for the rotating Ajo groups traders actually run. If it saves me one evening of receipt-chasing per
month, it has already paid for itself.
