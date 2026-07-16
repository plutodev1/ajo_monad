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

AjoBook puts the Ajo book on the Monad blockchain. The **keeper** opens a "page" (a
campaign like *July 2026 Dues*), **members** sign their name and pay MON directly into
the contract, and **everyone** reads the same ledger: who paid, how much, when — live,
unfakeable, permanent. The keeper withdraws collected funds to the treasury, and that
is also written in the book.

---

## How to use the app (2 minutes)

### What you need

1. **A browser wallet.** Install [MetaMask](https://metamask.io) (Chrome/Firefox
   extension or mobile app) and create a wallet if you don't have one.
2. **Free test MON for gas.** AjoBook runs on Monad *testnet* — the tokens are free.
   Go to the [Monad faucet](https://faucet.monad.xyz), paste your wallet address
   (copy it from MetaMask: click your account name), and press *Get Tokens*.

### As a member

1. Open **https://plutodev1.github.io/ajobook/**. You can read the whole book without
   connecting anything.
2. Click **"Open my wallet"** (top right). MetaMask pops up — approve the connection.
   The app adds and switches to the Monad Testnet network for you automatically;
   approve that too when MetaMask asks.
3. **Sign the book.** On the dashed line, write your name the way members know you —
   *"Ada from Enugu"* — and click **"Write it in the book"**. Confirm in MetaMask.
   You only do this once; your name sticks for every page.
4. **Pay your dues.** Click **"Pay my dues — 0.1 MON"** (or on an open-amount page,
   enter what you're giving). Confirm in MetaMask. A violet **PAID ✓** stamp lands
   next to your name, and everyone in the community can see it.
5. Use the tabs above the page to flip to other campaigns.

### As the keeper (admin)

If you're connected with the wallet that deployed the contract, a **Keeper's desk**
appears below the book. From there you can:

- **Open a new page** — name it ("August 2026 dues"), add a line of detail, set the
  dues amount (or leave 0 to accept any amount), and an optional deadline.
- **Close this page** — stops further payments on the current campaign.
- **Move it to the treasury** — withdraw collected MON to any address. The withdrawal
  is recorded onchain like everything else.

### Verify nothing is hidden

Every number in the app comes straight from the chain. Check the raw ledger yourself on
[MonadVision](https://testnet.monadvision.com/address/0xE64f39E74Caf57Dfe7b886cdBbAcC463af877723) —
the contract source is verified, so you can read exactly what the code does.

---

## Set it up for your own community

You'll need [Node.js](https://nodejs.org) 20+, [Foundry](https://getfoundry.sh), and git.

### 1. Get the code

```bash
git clone https://github.com/plutodev1/ajobook.git
cd ajobook
```

### 2. Test the contract (optional but satisfying)

```bash
cd contracts
forge test        # 17 tests, all green
```

### 3. Deploy your own dues book

You need a wallet with a little testnet MON for gas (see the faucet above). Then:

```bash
forge create src/AjoBook.sol:AjoBook \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key <YOUR_PRIVATE_KEY> \
  --broadcast \
  --constructor-args "Your Community Name"
```

Copy the **"Deployed to"** address. The wallet that deploys is the keeper.

Verify the source (so members can read the code):

```bash
forge verify-contract <DEPLOYED_ADDRESS> src/AjoBook.sol:AjoBook \
  --chain-id 10143 \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org
```

### 4. Point the app at your contract

Edit `web/src/config.js` and replace `CONTRACT_ADDRESS` with your deployed address.

### 5. Run the app

```bash
cd web
npm install
npm run dev       # opens on http://localhost:5173
```

### 6. Host it (free, GitHub Pages)

Push the repo to GitHub. The included workflow
(`.github/workflows/pages.yml`) builds and publishes the app automatically on every
push to `main` — your site appears at `https://<username>.github.io/ajobook/`.
If your repo has a different name, change `base` in `web/vite.config.js` to match.

---

## How it's built

```
contracts/           Foundry project
  src/AjoBook.sol    the whole dues book: campaigns, payments, names, ledger views
  test/AjoBook.t.sol 17 tests incl. fuzzing

web/                 Vite + viem single-page app (no framework)
  index.html         the book: page, ledger rows, keeper's desk
  src/main.js        wallet connect, chain switching, reads + writes via viem
```

- **Chain:** Monad testnet (chain id 10143, RPC `https://testnet-rpc.monad.xyz`)
- **Stack:** Solidity 0.8.24 + Foundry · viem · Vite · vanilla JS
- **Design:** styled after the physical exercise book used at real Ajo meetings —
  cream paper, ruled lines, red margin, and a violet ink **PAID ✓** stamp

## Why this is real

It's July, and ChainConnect NG dues are actually due. The first campaign on the deployed
contract is our real July collection. If it saves me one evening of receipt-chasing per
month, it has already paid for itself.
