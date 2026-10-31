import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  parseUnits,
  getAddress,
  isAddress,
} from "viem";
import { AJOBOOK_ABI, AJOCIRCLE_ABI, ERC20_ABI } from "./abi.js";
import { AJOBOOK_BYTECODE, AJOCIRCLE_BYTECODE } from "./bytecode.js";
import { CHAIN, AJOBOOK_ADDRESS, AJOCIRCLE_ADDRESS, USDC_ADDRESS, USDC_DECIMALS, EXPLORER } from "./config.js";

const $ = (id) => document.getElementById(id);

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

let walletClient = null;
let account = null;
let myName = "";
let adminAddr = null;
let campaigns = [];
let ledgers = [];
let activePage = 0;
let justStamped = null; // "pageId:address" — animate this stamp once

const contract = { address: AJOBOOK_ADDRESS, abi: AJOBOOK_ABI };
const circleContract = { address: AJOCIRCLE_ADDRESS, abi: AJOCIRCLE_ABI };
const usdcContract = { address: USDC_ADDRESS, abi: ERC20_ABI };
let view = "book"; // "book" | "circles"

// ---------- helpers ----------

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (units) => {
  const n = Number(formatUnits(units, USDC_DECIMALS));
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const mon = usd; // kept so older call sites read the same
const toUnits = (s) => parseUnits(String(s || "0"), USDC_DECIMALS);

// Dues are paid in USDC, so the wallet first allows the contract to take
// exactly this amount. Skipped when an earlier approval still covers it.
async function ensureAllowance(spender, amount) {
  const current = await publicClient.readContract({ ...usdcContract, functionName: "allowance", args: [account, spender] });
  if (current >= amount) return true;
  const bal = await publicClient.readContract({ ...usdcContract, functionName: "balanceOf", args: [account] });
  if (bal < amount) {
    note(`You need ${usd(amount)} USDC in this wallet but have ${usd(bal)}. Test USDC is free at
      <a href="https://faucet.circle.com" target="_blank" rel="noopener">faucet.circle.com</a> (pick Arbitrum Sepolia).`, "err");
    return false;
  }
  return sendTx(`Allowing AjoBook to take ${usd(amount)} USDC`, () =>
    walletClient.writeContract({ ...usdcContract, functionName: "approve", args: [spender, amount], account })
  );
}
const dateWords = (ts) =>
  new Date(Number(ts) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function note(msg, cls = "") {
  const el = $("note");
  el.innerHTML = msg;
  el.className = `note ${cls}`;
  el.hidden = false;
}

const txLink = (hash) => `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">see it on the chain ↗</a>`;

async function sendTx(label, fn) {
  try {
    note(`${label}… your wallet will ask you to sign.`);
    const hash = await fn();
    note(`${label} — waiting for the chain to write it down… ${txLink(hash)}`);
    await publicClient.waitForTransactionReceipt({ hash });
    note(`It’s in the book. ${txLink(hash)}`, "ok");
    await refresh();
    return true;
  } catch (e) {
    note(`That didn’t go through: ${e.shortMessage || e.message}`, "err");
    return false;
  }
}

const isOpen = (c) => !c.closed && (c.deadline === 0n || BigInt(Math.floor(Date.now() / 1000)) <= c.deadline);

// ---------- wallet ----------
// Wallets announce themselves via EIP-6963, so MetaMask, Rabby, OKX, Coinbase
// and friends all show up without any wallet-kit library.

const discovered = new Map(); // rdns -> { info, provider }
let activeProvider = null;

window.addEventListener("eip6963:announceProvider", (e) => {
  discovered.set(e.detail.info.rdns, e.detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

async function connect() {
  const wallets = [...discovered.values()];
  if (wallets.length === 0 && window.ethereum) {
    return connectWith(window.ethereum); // older wallets that don't announce
  }
  if (wallets.length === 0) {
    note(
      `You’ll need a wallet to sign the book. Install
       <a href="https://metamask.io" target="_blank" rel="noopener">MetaMask</a>,
       <a href="https://rabby.io" target="_blank" rel="noopener">Rabby</a> or
       <a href="https://web3.okx.com" target="_blank" rel="noopener">OKX Wallet</a>, then come back.`,
      "err"
    );
    return;
  }
  if (wallets.length === 1) {
    return connectWith(wallets[0].provider);
  }
  // several wallets installed — let the member choose
  $("wallet-list").innerHTML = wallets
    .map(
      (w, i) => `<button type="button" class="wallet-option" data-wallet="${i}">
        <img src="${w.info.icon}" alt="" width="26" height="26" />
        <span>${escapeHtml(w.info.name)}</span>
      </button>`
    )
    .join("");
  $("wallet-list")
    .querySelectorAll("[data-wallet]")
    .forEach((b) => {
      b.onclick = () => {
        $("wallet-dialog").close();
        connectWith(wallets[Number(b.dataset.wallet)].provider).catch((e) =>
          note(e.shortMessage || e.message, "err")
        );
      };
    });
  $("wallet-dialog").showModal();
}

async function connectWith(provider) {
  walletClient = createWalletClient({ chain: CHAIN, transport: custom(provider) });
  const [addr] = await walletClient.requestAddresses();
  account = getAddress(addr);
  activeProvider = provider;
  try {
    await walletClient.switchChain({ id: CHAIN.id });
  } catch {
    await walletClient.addChain({ chain: CHAIN });
    await walletClient.switchChain({ id: CHAIN.id });
  }
  if (provider.on) {
    provider.on("accountsChanged", (accounts) => {
      if (!accounts || accounts.length === 0) return signOut();
      account = getAddress(accounts[0]);
      refresh();
    });
  }
  $("connect-btn").hidden = true;
  $("wallet-info").hidden = false;
  $("wallet-addr").textContent = short(account);
  await refresh();
}

function signOut() {
  // politely ask the wallet to forget us; not all wallets support it
  activeProvider
    ?.request?.({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] })
    .catch(() => {});
  account = null;
  myName = "";
  walletClient = null;
  activeProvider = null;
  $("connect-btn").hidden = false;
  $("wallet-info").hidden = true;
  $("wallet-name").textContent = "";
  $("wallet-addr").textContent = "";
  note("Signed out. The book stays open for reading.", "ok");
  refresh();
}

// ---------- rendering ----------

function renderTabs() {
  const nav = $("page-tabs");
  if (campaigns.length <= 1) {
    nav.innerHTML = "";
    return;
  }
  nav.innerHTML = campaigns
    .map(
      (c, i) => `<button class="page-tab" role="tab" aria-selected="${i === activePage}" data-tab="${i}">
        ${escapeHtml(c.name)}${!isOpen(c) ? `<span class="tab-closed">· closed</span>` : ""}
      </button>`
    )
    .join("");
  nav.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      activePage = Number(b.dataset.tab);
      renderTabs();
      renderSheet();
      renderKeeper();
    };
  });
}

function renderDash() {
  const dash = $("member-dash");
  if (!account) {
    dash.hidden = true;
    dash.innerHTML = "";
    return;
  }

  let total = 0n;
  let paidPages = 0;
  campaigns.forEach((c, i) => {
    const mine = (ledgers[i] || []).find((p) => getAddress(p.member) === account);
    if (mine) {
      total += mine.amount;
      paidPages++;
    }
  });
  const awaiting = campaigns.filter(
    (c, i) => isOpen(c) && !(ledgers[i] || []).some((p) => getAddress(p.member) === account)
  ).length;

  dash.hidden = false;
  dash.innerHTML = `
    <div class="dash-who">
      <span class="stamp stamp-small">Member</span>
      <div class="dash-name-view" id="dash-name-view">
        <b class="dash-name">${myName ? escapeHtml(myName) : "Unsigned member"}</b>
        <button class="dash-edit-btn" id="dash-edit" type="button">✏️ ${myName ? "edit name" : "write your name"}</button>
      </div>
      <form class="dash-edit-row" id="dash-edit-row" hidden>
        <input id="dash-name-input" maxlength="40" value="${escapeHtml(myName || "")}"
          placeholder="Your name, as members know you" aria-label="Your display name" />
        <button class="btn btn-ink" type="submit">Save it</button>
        <button class="btn" type="button" id="dash-edit-cancel">Cancel</button>
      </form>
      <code>${short(account)}</code>
    </div>
    <div class="dash-stats">
      <div class="dash-stat"><b>${mon(total)}</b><span>you've contributed</span></div>
      <div class="dash-stat"><b>${paidPages} of ${campaigns.length}</b><span>pages stamped</span></div>
      <div class="dash-stat ${awaiting ? "dash-due" : ""}"><b>${awaiting}</b><span>page${awaiting === 1 ? "" : "s"} awaiting you</span></div>
    </div>`;

  $("dash-edit").onclick = () => {
    $("dash-name-view").hidden = true;
    $("dash-edit-row").hidden = false;
    $("dash-name-input").focus();
  };
  $("dash-edit-cancel").onclick = () => {
    $("dash-edit-row").hidden = true;
    $("dash-name-view").hidden = false;
  };
  $("dash-edit-row").onsubmit = (e) => {
    e.preventDefault();
    const name = $("dash-name-input").value.trim();
    if (!name) return note("Write a name first — the book needs it.", "err");
    sendTx("Rewriting your name", () =>
      walletClient.writeContract({ ...contract, functionName: "setMyName", args: [name], account })
    );
  };
}

function renderSheet() {
  const sheet = $("sheet");

  if (!campaigns.length) {
    sheet.innerHTML = `
      <header class="sheet-head">
        <span class="sheet-kicker">This book</span>
        <h2 class="sheet-title">A fresh dues book</h2>
      </header>
      <p class="empty-invite">The keeper hasn’t opened a page yet. When they do, it appears right here.</p>
      ${`<div class="blank-rule"></div>`.repeat(5)}`;
    return;
  }

  const id = activePage;
  const c = campaigns[id];
  const ledger = ledgers[id] || [];
  const open = isOpen(c);
  const fixed = c.duesAmount > 0n;

  const terms = [
    fixed ? `Everyone pays <b>${mon(c.duesAmount)}</b>` : `Give what you can`,
    c.deadline > 0n ? `collecting until <b>${dateWords(c.deadline)}</b>` : null,
    `${c.payerCount} name${c.payerCount === 1 ? "" : "s"} on this page`,
  ]
    .filter(Boolean)
    .join(" · ");

  const rows = ledger
    .map((p, i) => {
      const you = account && getAddress(p.member) === account;
      const stampCls = justStamped === `${id}:${p.member.toLowerCase()}` ? "stamp stamp-in" : "stamp";
      return `<li class="entry">
        <span class="no">${i + 1}</span>
        <span class="who">
          <b>${p.name ? escapeHtml(p.name) : "Unsigned member"}</b>
          <code>${short(p.member)}</code>
          ${you ? `<span class="you-mark">— you</span>` : ""}
        </span>
        <span class="leader" aria-hidden="true"></span>
        <span class="amt">${mon(p.amount)}</span>
        <span class="${stampCls}">Paid ✓</span>
      </li>`;
    })
    .join("");

  const iPaid = account && ledger.some((p) => getAddress(p.member) === account);
  const needsSignature = account && !myName;

  const signLine =
    account && needsSignature
      ? `<div class="sign-line">
          <input id="name-input" type="text" maxlength="40"
            placeholder="Sign your name the way members know you — “Ada from Enugu”"
            aria-label="Your name, as members know you" />
          <button id="name-btn" class="btn">Write it in the book</button>
        </div>`
      : "";

  let action = "";
  if (open) {
    if (!account) {
      action = `<button class="btn btn-ink" data-connect>Open my wallet to sign this page</button>`;
    } else if (fixed && iPaid) {
      action = `<p class="paid-note">Your dues are stamped ✓</p>
        <button class="btn" data-pay="${id}">Feeling generous? Add another ${mon(c.duesAmount)} 💚</button>`;
    } else {
      const label = fixed ? `Pay my dues — ${mon(c.duesAmount)}` : iPaid ? `Add a little more` : `Put something on this page`;
      action = `<button class="btn btn-ink" data-pay="${id}">${label}</button>`;
    }
  }

  const blanks = Math.max(0, 4 - ledger.length);

  sheet.innerHTML = `
    <header class="sheet-head">
      <div class="sheet-title-row">
        <span class="sheet-kicker">Page ${id + 1}</span>
        <h2 class="sheet-title">${escapeHtml(c.name)}</h2>
        ${!open ? `<span class="stamp stamp-red stamp-small">${c.closed ? "Page closed" : "Past the deadline"}</span>` : ""}
      </div>
      <p class="sheet-terms">${terms}</p>
      ${c.details ? `<p class="sheet-details">${escapeHtml(c.details)}</p>` : ""}
    </header>
    <ol class="entries">${rows}</ol>
    ${ledger.length ? "" : `<p class="empty-invite">No one’s signed this page yet — be the first.</p>`}
    ${signLine}
    ${`<div class="blank-rule"></div>`.repeat(blanks)}
    <div class="sum">
      <span class="sum-label">collected on this page</span>
      <b>${mon(c.totalCollected)}</b>
    </div>
    <div class="page-actions">${action}</div>`;

  justStamped = null;

  // wire the sheet's controls
  sheet.querySelector("[data-connect]")?.addEventListener("click", () => connect().catch((e) => note(e.shortMessage || e.message, "err")));
  sheet.querySelector("[data-pay]")?.addEventListener("click", () => openPayDialog(id));
  const nameBtn = sheet.querySelector("#name-btn");
  if (nameBtn) {
    nameBtn.onclick = () => {
      const name = sheet.querySelector("#name-input").value.trim();
      if (!name) return note("Write your name first — the book needs it.", "err");
      sendTx("Writing your name", () =>
        walletClient.writeContract({ ...contract, functionName: "setMyName", args: [name], account })
      );
    };
  }
}

function renderKeeper() {
  const isAdmin = account && adminAddr && account === adminAddr;
  $("keeper").hidden = !isAdmin;
  if (!isAdmin || !campaigns.length) return;
  const c = campaigns[activePage];
  $("keeper-page-summary").textContent =
    `“${c.name}” has ${c.payerCount} name${c.payerCount === 1 ? "" : "s"} and holds ${mon(c.totalCollected)} so far.` +
    (c.closed ? " This page is closed." : "");
  const closeBtn = $("close-page-btn");
  closeBtn.hidden = c.closed;
  closeBtn.onclick = () => {
    if (!confirm(`Close “${c.name}”? No one can pay into a closed page.`)) return;
    sendTx("Closing the page", () =>
      walletClient.writeContract({ ...contract, functionName: "closeCampaign", args: [BigInt(activePage)], account })
    );
  };
}

async function refresh() {
  if (!AJOBOOK_ADDRESS) return renderSetup();
  renderModeSwitch();
  if (view === "circles") return refreshCircles();
  try {
    const [name, admin, all, balance] = await Promise.all([
      publicClient.readContract({ ...contract, functionName: "communityName" }),
      publicClient.readContract({ ...contract, functionName: "admin" }),
      publicClient.readContract({ ...contract, functionName: "getAllCampaigns" }),
      publicClient.readContract({ ...contract, functionName: "balance" }),
    ]);
    if (view !== "book") return; // switched to circles while loading
    adminAddr = getAddress(admin);
    campaigns = all;
    ledgers = await Promise.all(
      all.map((_, i) => publicClient.readContract({ ...contract, functionName: "getLedger", args: [BigInt(i)] }))
    );

    if (activePage >= all.length) activePage = 0;
    // first visit: open the first page still collecting
    if (!refresh.ranOnce) {
      const firstOpen = all.findIndex(isOpen);
      if (firstOpen >= 0) activePage = firstOpen;
      refresh.ranOnce = true;
    }

    $("community-line").textContent = `the dues book of ${name}`;
    $("book-balance").textContent = mon(balance);
    $("contract-link").href = `${EXPLORER}/address/${AJOBOOK_ADDRESS}`;

    if (account) {
      myName = await publicClient.readContract({ ...contract, functionName: "memberName", args: [account] });
      if (view !== "book") return;
      $("wallet-name").textContent = myName || "Unsigned member";
    }

    renderTabs();
    renderDash();
    renderSheet();
    renderKeeper();
  } catch (e) {
    $("sheet").innerHTML = `<p class="sheet-loading">Couldn’t open the book — ${escapeHtml(e.shortMessage || "the network didn’t answer")}. Refresh to try again.</p>`;
  }
}

// ---------- pay flow ----------

function openPayDialog(id) {
  if (!account) return connect();
  const c = campaigns[id];
  const fixed = c.duesAmount > 0n;
  const topUp = fixed && (ledgers[id] || []).some((p) => getAddress(p.member) === account);
  $("pay-title").textContent = `${c.name}`;
  $("pay-sub").textContent = topUp
    ? `Your dues are already stamped — this adds another ${mon(c.duesAmount)} on top. Every extra stamp grows the pot.`
    : fixed
      ? `Dues on this page are ${mon(c.duesAmount)}, same for everyone. Already paid? You can always stamp again to give extra.`
      : `This page takes any amount — write in what you’re giving.`;
  $("pay-amount-label").hidden = fixed;
  $("pay-amount").value = fixed ? formatUnits(c.duesAmount, USDC_DECIMALS) : "";
  $("pay-amount").required = !fixed;
  $("pay-dialog").showModal();
  $("pay-form").onsubmit = (e) => {
    e.preventDefault();
    const value = fixed ? c.duesAmount : toUnits($("pay-amount").value);
    if (value === 0n) return note("Write an amount first.", "err");
    $("pay-dialog").close();
    ensureAllowance(AJOBOOK_ADDRESS, value)
      .then((allowed) =>
        allowed &&
        sendTx("Paying your dues", () =>
          walletClient.writeContract({ ...contract, functionName: "payDues", args: [BigInt(id), value], account })
        )
      )
      .then((ok) => {
      if (ok) justStamped = `${id}:${account.toLowerCase()}`;
      renderSheet();
    });
  };
}

// ---------- static wiring ----------

$("connect-btn").onclick = () => connect().catch((e) => note(e.shortMessage || e.message, "err"));
$("signout-btn").onclick = signOut;
$("wallet-cancel").onclick = () => $("wallet-dialog").close();
$("pay-cancel").onclick = () => $("pay-dialog").close();

$("create-form").onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const amount = toUnits(f.get("amount"));
  const dl = f.get("deadline")
    ? BigInt(Math.floor(new Date(`${f.get("deadline")}T23:59:59`).getTime() / 1000))
    : 0n;
  sendTx("Opening a new page", () =>
    walletClient.writeContract({
      ...contract,
      functionName: "createCampaign",
      args: [f.get("name"), f.get("details") || "", amount, dl],
      account,
    })
  ).then((ok) => ok && e.target.reset());
};

$("withdraw-form").onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  sendTx("Moving money to the treasury", () =>
    walletClient.writeContract({
      ...contract,
      functionName: "withdraw",
      args: [getAddress(String(f.get("to"))), toUnits(f.get("amount"))],
      account,
    })
  );
};

// ---------- Esusu circles (rotating savings) ----------

let circles = [];
let circleMembers = [];
let activeCircle = 0;

const FREQUENCIES = { 86400: "daily", 604800: "weekly", 2592000: "monthly" };
const freqWord = (secs) => FREQUENCIES[Number(secs)] || `every ${Math.round(Number(secs) / 86400)} days`;
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const roundEnd = (c) => c.startTime + (BigInt(c.currentRound) + 1n) * BigInt(c.roundDuration);

function renderModeSwitch() {
  const el = $("mode-switch");
  el.hidden = false;
  el.querySelectorAll("[data-view]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.view === view));
    b.onclick = () => {
      if (view === b.dataset.view) return;
      view = b.dataset.view;
      $("page-tabs").innerHTML = "";
      $("member-dash").hidden = true;
      $("keeper").hidden = true;
      $("circle-desk").hidden = true;
      $("sheet").innerHTML = `<p class="sheet-loading">Opening…</p>`;
      refresh();
    };
  });
}

async function refreshCircles() {
  if (!AJOCIRCLE_ADDRESS) {
    $("sheet").innerHTML = `<p class="sheet-loading">Esusu circles aren’t deployed yet. Set AJOCIRCLE_ADDRESS in web/src/config.js.</p>`;
    return;
  }
  try {
    circles = await publicClient.readContract({ ...circleContract, functionName: "getAllCircles" });
    if (activeCircle >= circles.length) activeCircle = 0;
    circleMembers = await Promise.all(
      circles.map((_, i) => publicClient.readContract({ ...circleContract, functionName: "getMembers", args: [BigInt(i)] }))
    );
    // display names come from the dues book, so a member signs once for both
    const addrs = [...new Set(circleMembers.flat().map((m) => getAddress(m.member)))];
    const names = await Promise.all(
      addrs.map((a) => publicClient.readContract({ ...contract, functionName: "memberName", args: [a] }).catch(() => ""))
    );
    const nameOf = Object.fromEntries(addrs.map((a, i) => [a, names[i]]));
    if (view !== "circles") return; // switched back while loading
    $("member-dash").hidden = true;
    $("keeper").hidden = true;
    $("community-line").textContent = "Esusu circles — everyone takes a turn";
    $("contract-link").href = `${EXPLORER}/address/${AJOCIRCLE_ADDRESS}`;
    renderCircleTabs();
    renderCircleSheet(nameOf);
    $("circle-desk").hidden = !account;
  } catch (e) {
    $("sheet").innerHTML = `<p class="sheet-loading">Couldn’t open the circles — ${escapeHtml(e.shortMessage || "the network didn’t answer")}. Refresh to try again.</p>`;
  }
}

function renderCircleTabs() {
  const nav = $("page-tabs");
  if (circles.length <= 1) {
    nav.innerHTML = "";
    return;
  }
  nav.innerHTML = circles
    .map(
      (c, i) => `<button class="page-tab" role="tab" aria-selected="${i === activeCircle}" data-circle="${i}">
        ${escapeHtml(c.name)}${c.finished ? `<span class="tab-closed">· done</span>` : ""}
      </button>`
    )
    .join("");
  nav.querySelectorAll("[data-circle]").forEach((b) => {
    b.onclick = () => {
      activeCircle = Number(b.dataset.circle);
      refreshCircles();
    };
  });
}

function renderCircleSheet(nameOf) {
  const sheet = $("sheet");
  if (!circles.length) {
    sheet.innerHTML = `
      <header class="sheet-head">
        <span class="sheet-kicker">Esusu</span>
        <h2 class="sheet-title">No circles yet</h2>
      </header>
      <p class="empty-invite">${account ? "Start one below — list your members in the order they collect." : "Open your wallet to start a circle."}</p>
      ${`<div class="blank-rule"></div>`.repeat(4)}`;
    return;
  }

  const id = activeCircle;
  const c = circles[id];
  const members = circleMembers[id] || [];
  const n = members.length;
  const round = Number(c.currentRound);
  const started = nowSec() >= c.startTime;
  const overdue = !c.finished && nowSec() > roundEnd(c);
  const me = account && members.find((m) => getAddress(m.member) === account);

  const terms = [
    `Each member puts in <b>${usd(c.contribution)}</b> ${freqWord(c.roundDuration)}`,
    `pot of <b>${usd(c.contribution * BigInt(n))}</b> per turn`,
    c.finished
      ? `every turn has been paid`
      : !started
        ? `starts <b>${dateWords(c.startTime)}</b>`
        : `turn ${round + 1} of ${n} · ${overdue ? "<b>time is up</b>" : `closes <b>${dateWords(roundEnd(c))}</b>`}`,
  ].join(" · ");

  const rows = members
    .map((m, i) => {
      const addr = getAddress(m.member);
      const name = nameOf[addr];
      const you = account && addr === account;
      let status = "";
      if (i < round) status = `<span class="stamp">Collected ${usd(m.received)}</span>`;
      else if (i === round && !c.finished) status = `<span class="stamp stamp-turn">Their turn</span>`;
      const paidMark = !c.finished && m.paidThisRound ? `<span class="stamp">Paid ✓</span>` : "";
      const missed = m.missed > 0 ? `<span class="missed">missed ${m.missed}</span>` : "";
      return `<li class="entry">
        <span class="no">${i + 1}</span>
        <span class="who">
          <b>${name ? escapeHtml(name) : "Unsigned member"}</b>
          <code>${short(addr)}</code>
          ${you ? `<span class="you-mark">— you</span>` : ""} ${missed}
        </span>
        <span class="leader" aria-hidden="true"></span>
        <span class="amt">${paidMark}</span>
        ${status}
      </li>`;
    })
    .join("");

  let action = "";
  if (!c.finished) {
    if (overdue) {
      action = `<button class="btn btn-red" data-close-round>Close this turn and pay out what came in</button>`;
    } else if (!account) {
      action = `<button class="btn btn-ink" data-connect>Open my wallet</button>`;
    } else if (me && !me.paidThisRound && started) {
      action = `<button class="btn btn-ink" data-contribute>Put in my ${usd(c.contribution)}</button>`;
    } else if (me && me.paidThisRound) {
      action = `<p class="paid-note">You’ve paid this turn ✓ — the pot goes out the moment the last person pays.</p>`;
    }
  }

  const potNow = c.contribution * BigInt(members.filter((m) => m.paidThisRound).length);
  sheet.innerHTML = `
    <header class="sheet-head">
      <div class="sheet-title-row">
        <span class="sheet-kicker">Circle ${id + 1}</span>
        <h2 class="sheet-title">${escapeHtml(c.name)}</h2>
        ${c.finished ? `<span class="stamp stamp-small">Completed</span>` : ""}
      </div>
      <p class="sheet-terms">${terms}</p>
      <p class="sheet-details">Turns go in the order below. Nobody holds the money: the contract pays the person whose turn it is as soon as everyone has paid.</p>
    </header>
    <ol class="entries">${rows}</ol>
    <div class="sum">
      <span class="sum-label">${c.finished ? "circle complete" : "in the pot this turn"}</span>
      <b>${usd(c.finished ? 0n : potNow)}</b>
    </div>
    <div class="page-actions">${action}</div>`;

  sheet.querySelector("[data-connect]")?.addEventListener("click", () => connect().catch((e) => note(e.shortMessage || e.message, "err")));
  sheet.querySelector("[data-contribute]")?.addEventListener("click", async () => {
    if (!(await ensureAllowance(AJOCIRCLE_ADDRESS, c.contribution))) return;
    await sendTx("Putting in your share", () =>
      walletClient.writeContract({ ...circleContract, functionName: "contribute", args: [BigInt(id)], account })
    );
  });
  sheet.querySelector("[data-close-round]")?.addEventListener("click", () => {
    if (!account) return connect();
    sendTx("Closing this turn", () =>
      walletClient.writeContract({ ...circleContract, functionName: "closeRound", args: [BigInt(id)], account })
    );
  });
}

$("circle-form").onsubmit = (e) => {
  e.preventDefault();
  if (!account) return connect();
  const f = new FormData(e.target);
  const lines = String(f.get("members"))
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = lines.find((a) => !isAddress(a));
  if (bad) return note(`“${escapeHtml(bad)}” isn’t a wallet address. One 0x… address per line.`, "err");
  const members = lines.map((a) => getAddress(a));
  if (new Set(members).size !== members.length) return note("The same address is on the list twice.", "err");
  if (members.length < 2) return note("A circle needs at least two members.", "err");
  const start = f.get("start") ? BigInt(Math.floor(new Date(`${f.get("start")}T00:00:00`).getTime() / 1000)) : 0n;
  sendTx("Starting the circle", () =>
    walletClient.writeContract({
      ...circleContract,
      functionName: "createCircle",
      args: [f.get("name"), members, toUnits(f.get("amount")), start, Number(f.get("frequency"))],
      account,
    })
  ).then((ok) => {
    if (ok) {
      e.target.reset();
      activeCircle = circles.length - 1;
      refresh();
    }
  });
};
$("circle-add-me").onclick = () => {
  if (!account) return connect();
  const box = $("circle-form").elements.members;
  if (!box.value.includes(account)) box.value = (box.value.trim() ? box.value.trim() + "\n" : "") + account;
};

// ---------- one-time setup: deploy the book from the keeper's wallet ----------

function renderSetup() {
  $("community-line").textContent = `setting up on ${CHAIN.name}`;
  $("sheet").innerHTML = `
    <header class="sheet-head">
      <span class="sheet-kicker">New book</span>
      <h2 class="sheet-title">Set up AjoBook on ${escapeHtml(CHAIN.name)}</h2>
      <p class="sheet-details">One-time step for the keeper. Your wallet creates two contracts — the dues book and the Esusu circles —
        and becomes the book’s keeper. You need a little ${escapeHtml(CHAIN.name)} ETH for gas.</p>
    </header>
    <div class="sign-line">
      <input id="setup-name" type="text" maxlength="60" value="ChainConnect NG" aria-label="Community name" />
      <button id="setup-btn" class="btn btn-ink">${account ? "Deploy the book" : "Open my wallet"}</button>
    </div>
    <div id="setup-out"></div>`;
  $("setup-btn").onclick = async () => {
    if (!account) return connect().catch((e) => note(e.shortMessage || e.message, "err"));
    const name = $("setup-name").value.trim();
    if (!name) return note("Write the community name first.", "err");
    const eth = await publicClient.getBalance({ address: account });
    if (eth === 0n) {
      return note(`This wallet has no ${escapeHtml(CHAIN.name)} ETH for gas yet. Get some free from the
        <a href="https://www.alchemy.com/faucets/arbitrum-sepolia" target="_blank" rel="noopener">Alchemy faucet</a>, then try again.`, "err");
    }
    const deploy = async (label, abi, bytecode, args) => {
      note(`${label}… your wallet will ask you to sign.`);
      const hash = await walletClient.deployContract({ abi, bytecode, args, account });
      note(`${label} — waiting for the chain… ${txLink(hash)}`);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      return r.contractAddress;
    };
    try {
      const book = await deploy("Creating the dues book", AJOBOOK_ABI, AJOBOOK_BYTECODE, [name, USDC_ADDRESS]);
      const circ = await deploy("Creating the Esusu circles", AJOCIRCLE_ABI, AJOCIRCLE_BYTECODE, [USDC_ADDRESS]);
      note("Both contracts are live. Copy the two addresses below and send them over.", "ok");
      $("setup-out").innerHTML = `
        <p class="sheet-terms"><b>AjoBook</b> <code>${book}</code></p>
        <p class="sheet-terms"><b>AjoCircle</b> <code>${circ}</code></p>
        <p class="sheet-details">Once these are in the app’s settings, everyone who opens this link sees the new book.</p>`;
    } catch (e) {
      note(`That didn’t go through: ${e.shortMessage || e.message}`, "err");
    }
  };
}

refresh();
