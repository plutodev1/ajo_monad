# Build Day plan: Thu 12 Nov, Teckcocoon Uyo, 9:00 AM – 6:00 PM

**What we ship:** AjoBook Esusu circles on Stellar testnet. Members join with a passkey,
pay their share in one tap, and the pot goes out automatically when the last person pays.

**The one rule:** a working demo of the core loop beats a half-finished fancy one. Every
block below ends with something that works. If a block runs over, cut the next stretch goal, not the core.

---

## Wednesday night checklist

- [ ] Laptop charged, charger and extension box packed, phone hotspot with data as backup
- [ ] `cargo test` and `stellar contract build` run fine **offline** (crates already cached)
- [ ] Testnet identity funded (`stellar keys address pluto`)
- [ ] Passkey verdict from Tuesday: **passkeys** or **Freighter**?
- [ ] Pre-event post is out (see bottom)
- [ ] Leave PH early. The event starts at 9

---

## Thursday, hour by hour

| Time | Block | Done when |
|---|---|---|
| 9:00–10:00 | Workshop / intros. Listen, tweet one photo, ask the Stellar folks one question about passkeys | You know the judging criteria and submission format |
| 10:00–10:30 | **Step 1–2:** constructor + `create_circle` (validate, store circle + member order) | Test: circle stored with members in order; duplicates rejected |
| 10:30–11:30 | **Step 3:** `contribute`: `require_auth`, checks, USDC transfer in, last payer triggers payout | Test: 3 members pay → recipient gets 3× contribution |
| 11:30–12:15 | **Step 4:** `close_round` + missed marks + next deadline | Test: deadline passes, 2 of 3 paid → partial pot, 1 missed |
| 12:15–12:45 | **Step 5:** views. Deploy to testnet. Invoke `create_circle` from the CLI | Contract ID on testnet, one circle created onchain |
| 12:45–1:15 | Lunch. Post a "contract live on testnet" update with a screenshot | |
| 1:15–3:30 | **Frontend:** one page. Connect (passkey or Freighter) → see circle → Pay my share → PAID stamp. Reuse the look from `web/` | Can pay from the browser and watch it update |
| 3:30–4:30 | **Stretch:** passkey onboarding if not done yet, "Start a circle" form, explorer links | Only if core is solid |
| 4:30–5:00 | Freeze code. Push to GitHub. Fill submission. Run the demo twice | Demo works twice in a row |
| 5:00–6:00 | Pitch + demo | |

**If stuck for more than 20 minutes on anything:** stop, ask a Stellar mentor in the room, or
drop to the fallback (Freighter instead of passkeys, XLM instead of USDC, CLI demo instead
of frontend). A CLI demo of a working contract still beats a broken frontend.

---

## 2-minute demo script

1. **(15s) The problem.** "I run ChainConnect NG. Every month: 'I sent it o, check your alert.'
   Ajo has worked in Nigeria for centuries, and it breaks in one place: the collector holds the money."
2. **(20s) The fix.** "AjoBook puts the Ajo on Stellar. Nobody holds the pot. The contract
   pays the next person the second the last member pays."
3. **(60s) Live.** Open the circle → member signs in with **fingerprint** (no seed phrase,
   no extension) → "Pay my share" → **one tap, no approve step** → last payer → pot lands in
   the recipient's wallet. Show it on the explorer.
4. **(15s) Why Stellar.** "Cents in fees on a ₦5,000 contribution. USDC so the naira
   doesn't eat the pot. Passkeys so my aunty can use it."
5. **(10s) Traction.** "It's already live on Arbitrum and Monad, and ChainConnect's July dues
   went through it. Today it got the chain it was meant for."

**Questions to expect:**
- *What if someone stops paying after they've collected?* → Missed marks are public and
  permanent. Next version: a deposit/collateral slashed on default.
- *Why not just use a bank app?* → The bank doesn't enforce the order or the payout. The collector still holds the money.
- *Naira in/out?* → Stellar anchors (SEP-24) turn naira into USDC. That's the next milestone.

---

## Content for the day

- **Before (Wed):** "Driving PH → Uyo tomorrow to rebuild Ajo on Stellar at Boundless
  Build Day. Fingerprint in, pay in one tap, nobody holds the money. Let's see if I can ship it in 9 hours."
- **During:** photo at 9am, testnet screenshot at lunch, short clip of the fingerprint → paid moment.
- **After (Fri):** recap thread: problem → what got built in one day → what Stellar made
  easy (no approve, passkeys) → what's next. Tag Stellar and Boundless.
