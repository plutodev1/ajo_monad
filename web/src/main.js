import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatEther,
  parseEther,
  getAddress,
} from "viem";
import { AJOBOOK_ABI } from "./abi.js";
import { CONTRACT_ADDRESS, MONAD_TESTNET, EXPLORER } from "./config.js";

const $ = (id) => document.getElementById(id);

const publicClient = createPublicClient({ chain: MONAD_TESTNET, transport: http() });

let walletClient = null;
let account = null;
let adminAddr = null;
let campaigns = [];
let ledgers = [];
let activePage = 0;
let justStamped = null; // "pageId:address" — animate this stamp once

const contract = { address: CONTRACT_ADDRESS, abi: AJOBOOK_ABI };

// ---------- helpers ----------

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const mon = (wei) => {
  const s = formatEther(wei);
  const n = Number(s);
  return `${n >= 1000 ? n.toLocaleString() : s.replace(/(\.\d{4})\d+$/, "$1")} MON`;
};
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
  walletClient = createWalletClient({ chain: MONAD_TESTNET, transport: custom(provider) });
  const [addr] = await walletClient.requestAddresses();
  account = getAddress(addr);
  activeProvider = provider;
  try {
    await walletClient.switchChain({ id: MONAD_TESTNET.id });
  } catch {
    await walletClient.addChain({ chain: MONAD_TESTNET });
    await walletClient.switchChain({ id: MONAD_TESTNET.id });
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
  const myName = account ? $("wallet-name").textContent : "";
  const needsSignature = account && (!myName || myName === "Unsigned member");

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
      action = `<p class="paid-note">You’re on this page — nothing more to pay. ✓</p>`;
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
  try {
    const [name, admin, all, balance] = await Promise.all([
      publicClient.readContract({ ...contract, functionName: "communityName" }),
      publicClient.readContract({ ...contract, functionName: "admin" }),
      publicClient.readContract({ ...contract, functionName: "getAllCampaigns" }),
      publicClient.getBalance({ address: CONTRACT_ADDRESS }),
    ]);
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
    $("contract-link").href = `${EXPLORER}/address/${CONTRACT_ADDRESS}`;

    if (account) {
      const myName = await publicClient.readContract({ ...contract, functionName: "memberName", args: [account] });
      $("wallet-name").textContent = myName || "Unsigned member";
    }

    renderTabs();
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
  $("pay-title").textContent = `${c.name}`;
  $("pay-sub").textContent = fixed
    ? `Dues on this page are ${mon(c.duesAmount)}, same for everyone.`
    : `This page takes any amount — write in what you’re giving.`;
  $("pay-amount-label").hidden = fixed;
  $("pay-amount").value = fixed ? formatEther(c.duesAmount) : "";
  $("pay-amount").required = !fixed;
  $("pay-dialog").showModal();
  $("pay-form").onsubmit = (e) => {
    e.preventDefault();
    const value = fixed ? c.duesAmount : parseEther($("pay-amount").value || "0");
    $("pay-dialog").close();
    sendTx("Paying your dues", () =>
      walletClient.writeContract({ ...contract, functionName: "payDues", args: [BigInt(id)], value, account })
    ).then((ok) => {
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
  const amount = parseEther(String(f.get("amount") || "0"));
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
      args: [getAddress(String(f.get("to"))), parseEther(String(f.get("amount")))],
      account,
    })
  );
};

refresh();
