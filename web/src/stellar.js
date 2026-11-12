// AjoBook on Stellar: the Esusu circles page.
// All network work lives in stellar-chain.js; this file is the page.
import * as freighterModule from "@stellar/freighter-api";
import { STELLAR } from "./stellar-config.js";
import {
  MONEY,
  NETWORK,
  allowWalletToHold,
  createBook,
  explain,
  fromUnits,
  fundWithFriendbot,
  isAccountAddress,
  isContractAddress,
  moneyBySac,
  openBook,
  toUnits,
  uploadContractCode,
  walletMoney,
} from "./stellar-chain.js";

const freighter = freighterModule.default?.requestAccess ? freighterModule.default : freighterModule;

const $ = (id) => document.getElementById(id);
const STORE_KEY = "ajobook.stellar.book";

// ---------- state ----------

let contractId = pickBook();
let wallet = null; // { publicKey, signTransaction }
let book = null; // the contract, opened with the current wallet (or read-only)
let money = MONEY.XLM;
let holdings = null; // what the connected wallet holds: { exists, balance, canHold }
let circles = [];
let active = 0;
let busy = false;

function pickBook() {
  const fromLink = new URLSearchParams(location.search).get("book");
  if (fromLink && isContractAddress(fromLink)) return fromLink;
  if (STELLAR.circles && isContractAddress(STELLAR.circles)) return STELLAR.circles;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && isContractAddress(saved)) return saved;
  } catch {}
  return "";
}

// ---------- small helpers ----------

const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const amount = (units) => (money.symbol === "USDC" ? `$${fromUnits(units, money.decimals)}` : `${fromUnits(units, money.decimals)} ${money.symbol}`);
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const FREQUENCIES = { 300: "every 5 minutes", 86400: "daily", 604800: "weekly", 2592000: "monthly" };
const freqWord = (secs) => {
  const s = Number(secs);
  if (FREQUENCIES[s]) return FREQUENCIES[s];
  return s < 86400 ? `every ${Math.max(1, Math.round(s / 60))} minutes` : `every ${Math.round(s / 86400)} days`;
};
const whenWords = (ts) => {
  const d = new Date(Number(ts) * 1000);
  const soon = Math.abs(d.getTime() - Date.now()) < 24 * 3600 * 1000;
  return soon
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const txLink = (hash) => (hash ? `<a href="${NETWORK.explorer}/tx/${hash}" target="_blank" rel="noopener">see it on Stellar ↗</a>` : "");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function note(msg, cls = "") {
  const el = $("note");
  el.hidden = !msg;
  el.className = `note ${cls}`.trim();
  el.innerHTML = msg || "";
}

/** Run one signed action: say what's happening, wait, say how it went, refresh. */
async function act(label, fn, { paying = false } = {}) {
  if (busy) return false;
  busy = true;
  note(`${label}… your wallet will ask you to sign.`);
  try {
    const out = await fn();
    note(`${label} — done. ${txLink(out?.hash)}`, "ok");
    busy = false;
    await refresh();
    return out || true;
  } catch (e) {
    console.error(e);
    note(`That didn’t go through: ${escapeHtml(explain(e, { paying }))}`, "err");
    busy = false;
    return false;
  }
}

// ---------- wallet ----------

async function connect({ quiet = false } = {}) {
  try {
    const installed = await freighter.isConnected();
    if (!installed?.isConnected) {
      if (!quiet)
        note(`AjoBook on Stellar signs with the Freighter wallet. <a href="https://www.freighter.app" target="_blank" rel="noopener">Install Freighter ↗</a>, switch it to <b>Test Net</b>, then come back.`, "err");
      return false;
    }
    let address = "";
    if (quiet) {
      const allowed = await freighter.isAllowed();
      if (!allowed?.isAllowed) return false;
      address = (await freighter.getAddress())?.address || "";
    } else {
      const access = await freighter.requestAccess();
      if (access?.error) throw new Error(access.error.message || String(access.error));
      address = access?.address || "";
    }
    if (!address) return false;
    const network = await freighter.getNetwork();
    if (network?.networkPassphrase && network.networkPassphrase !== NETWORK.passphrase) {
      note(`Your wallet is on <b>${escapeHtml(network.network || "another network")}</b>. In Freighter, switch the network to <b>Test Net</b>, then open your wallet again.`, "err");
      return false;
    }
    wallet = { publicKey: address, signTransaction: freighter.signTransaction };
    book = contractId ? openBook(contractId, wallet) : null;
    if (!quiet) note("");
    await refresh();
    return true;
  } catch (e) {
    console.error(e);
    if (!quiet) note(`Couldn’t open the wallet: ${escapeHtml(explain(e))}`, "err");
    return false;
  }
}

function signOut() {
  wallet = null;
  holdings = null;
  book = contractId ? openBook(contractId, null) : null;
  note("");
  refresh();
}

function renderWallet() {
  $("connect-btn").hidden = Boolean(wallet);
  $("wallet-info").hidden = !wallet;
  if (!wallet) {
    $("wallet-help").hidden = true;
    return;
  }
  $("wallet-addr").textContent = short(wallet.publicKey);
  $("wallet-addr").title = wallet.publicKey;
  $("wallet-balance").textContent = holdings?.exists ? amount(holdings.balance) : "";

  // Anything standing between this wallet and paying in.
  const help = $("wallet-help");
  if (holdings && !holdings.exists) {
    help.hidden = false;
    help.innerHTML = `<div class="help-row"><p><b>This wallet is brand new on Stellar testnet.</b> Get free test XLM to switch it on.</p>
      <button class="btn btn-ink" id="friendbot-btn">Get free test XLM</button></div>`;
    $("friendbot-btn").onclick = async () => {
      note("Asking the test faucet…");
      try {
        await fundWithFriendbot(wallet.publicKey);
        note("Your wallet has test XLM now.", "ok");
        await refresh();
      } catch (e) {
        note(escapeHtml(explain(e)), "err");
      }
    };
  } else if (holdings && !holdings.canHold) {
    help.hidden = false;
    help.innerHTML = `<div class="help-row"><p><b>This wallet can’t hold ${escapeHtml(money.symbol)} yet.</b> Add it once, then get free test ${escapeHtml(money.symbol)} from
      <a href="https://faucet.circle.com" target="_blank" rel="noopener">faucet.circle.com ↗</a> (choose Stellar Testnet).</p>
      <button class="btn btn-ink" id="trust-btn">Add ${escapeHtml(money.symbol)} to my wallet</button></div>`;
    $("trust-btn").onclick = () => act(`Adding ${money.symbol} to your wallet`, () => allowWalletToHold(wallet, money));
  } else {
    help.hidden = true;
  }
}

// ---------- loading the book ----------

async function refresh() {
  if (!contractId) {
    if (wallet) holdings = await walletMoney(wallet.publicKey, MONEY.XLM).catch(() => null);
    renderWallet();
    if (!document.getElementById("setup-btn") || document.getElementById("setup-btn").textContent !== (wallet ? "Set up the book" : "Open my wallet")) renderSetup();
    return;
  }
  renderWallet();
  if (!book) book = openBook(contractId, wallet);
  try {
    const [token, list] = await Promise.all([book.token(), book.circles()]);
    money = moneyBySac(token);
    circles = list;
    if (active >= circles.length) active = Math.max(0, circles.length - 1);
    if (wallet) holdings = await walletMoney(wallet.publicKey, money).catch(() => null);
  } catch (e) {
    console.error(e);
    $("sheet").innerHTML = `<p class="sheet-loading">Couldn’t open the book — ${escapeHtml(explain(e))} <button class="btn" id="retry-btn">Try again</button></p>`;
    $("retry-btn").onclick = refresh;
    return;
  }
  document.querySelectorAll(".cur").forEach((s) => (s.textContent = money.symbol));
  $("chain-line").textContent = `Kept on Stellar and paid in ${money.symbol}`;
  $("contract-link").hidden = false;
  $("contract-link").href = `${NETWORK.explorer}/contract/${contractId}`;
  renderWallet();
  renderTabs();
  renderSheet();
  $("circle-desk").hidden = !wallet;
}

function renderTabs() {
  const nav = $("page-tabs");
  if (circles.length <= 1) {
    nav.innerHTML = "";
    return;
  }
  nav.innerHTML = circles
    .map(
      (c, i) => `<button class="page-tab" role="tab" aria-selected="${i === active}" data-circle="${i}">
        ${escapeHtml(c.name)}${c.finished ? `<span class="tab-closed">· done</span>` : ""}
      </button>`
    )
    .join("");
  nav.querySelectorAll("[data-circle]").forEach((b) => {
    b.onclick = () => {
      active = Number(b.dataset.circle);
      renderTabs();
      renderSheet();
    };
  });
}

// ---------- one circle = one page of the book ----------

function renderSheet() {
  const sheet = $("sheet");
  if (!circles.length) {
    sheet.innerHTML = `
      <header class="sheet-head">
        <span class="sheet-kicker">Esusu</span>
        <h2 class="sheet-title">No circles yet</h2>
      </header>
      <p class="empty-invite">${wallet ? "Start one below — list your members in the order they collect." : "Open your wallet to start a circle."}</p>
      ${`<div class="blank-rule"></div>`.repeat(4)}`;
    return;
  }

  const c = circles[active];
  const n = c.members.length;
  const round = Number(c.current_round);
  const started = nowSec() >= c.start_time;
  const overdue = !c.finished && nowSec() > c.round_ends_at;
  const myIndex = wallet ? c.members.indexOf(wallet.publicKey) : -1;
  const iPaid = myIndex >= 0 && c.paid[myIndex];
  const myOwed = myIndex >= 0 ? c.owed[myIndex] : 0n;

  const terms = [
    `Each member puts in <b>${amount(c.contribution)}</b> ${freqWord(c.round_duration)}`,
    `pot of <b>${amount(c.contribution * BigInt(n))}</b> per turn`,
    c.finished
      ? `every turn has been paid`
      : !started
        ? `starts <b>${whenWords(c.start_time)}</b>`
        : `turn ${round + 1} of ${n} · ${overdue ? "<b>time is up</b>" : `closes <b>${whenWords(c.round_ends_at)}</b>`}`,
  ].join(" · ");

  const rows = c.members
    .map((addr, i) => {
      const you = wallet && addr === wallet.publicKey;
      let status = "";
      if (c.owed[i] > 0n) status = `<span class="stamp stamp-wait">${amount(c.owed[i])} waiting</span>`;
      else if (i < round) status = `<span class="stamp">Collected ${amount(c.received[i])}</span>`;
      else if (i === round && !c.finished) status = `<span class="stamp stamp-turn">Their turn</span>`;
      const paidMark = !c.finished && c.paid[i] ? `<span class="stamp">Paid ✓</span>` : "";
      const missed = c.missed[i] > 0 ? `<span class="missed">missed ${c.missed[i]}</span>` : "";
      return `<li class="entry">
        <span class="no">${i + 1}</span>
        <span class="who">
          <b>${escapeHtml(c.names[i] || "Member")}</b>
          <code title="${addr}">${short(addr)}</code>
          ${you ? `<span class="you-mark">— you</span>` : ""} ${missed}
        </span>
        <span class="leader" aria-hidden="true"></span>
        <span class="amt">${paidMark}</span>
        ${status}
      </li>`;
    })
    .join("");

  const actions = [];
  if (myOwed > 0n) actions.push(`<button class="btn btn-ink" data-claim>Collect my ${amount(myOwed)}</button>`);
  if (!c.finished) {
    if (overdue) {
      actions.push(`<button class="btn btn-red" data-close-round>Close this turn and pay out what came in</button>`);
    } else if (!wallet) {
      actions.push(`<button class="btn btn-ink" data-connect>Open my wallet</button>`);
    } else if (myIndex >= 0 && !iPaid && started) {
      actions.push(`<button class="btn btn-ink" data-contribute>Put in my ${amount(c.contribution)}</button>`);
    } else if (iPaid) {
      actions.push(`<p class="paid-note">You’ve paid this turn ✓ — the pot goes out the moment the last person pays.</p>`);
    } else if (myIndex < 0) {
      actions.push(`<p class="paid-note">This wallet isn’t in this circle, so it can read the page but not pay in.</p>`);
    }
  }

  sheet.innerHTML = `
    <header class="sheet-head">
      <div class="sheet-title-row">
        <span class="sheet-kicker">Circle ${active + 1}</span>
        <h2 class="sheet-title">${escapeHtml(c.name)}</h2>
        ${c.finished ? `<span class="stamp stamp-small">Completed</span>` : ""}
      </div>
      <p class="sheet-terms">${terms}</p>
      <p class="sheet-details">Turns go in the order below. Nobody holds the money: the contract pays the person whose turn it is as soon as everyone has paid.</p>
    </header>
    <ol class="entries">${rows}</ol>
    <div class="sum">
      <span class="sum-label">${c.finished ? "circle complete" : "in the pot this turn"}</span>
      <b>${amount(c.finished ? 0n : c.pot)}</b>
    </div>
    <div class="page-actions">${actions.join("")}</div>`;

  const id = Number(c.id);
  sheet.querySelector("[data-connect]")?.addEventListener("click", () => connect());
  sheet.querySelector("[data-contribute]")?.addEventListener("click", () => {
    if (holdings && holdings.exists && holdings.canHold && holdings.balance < c.contribution) {
      return note(`This wallet holds ${amount(holdings.balance)}, and the contribution is ${amount(c.contribution)}. Top it up first.`, "err");
    }
    const lastToPay = Number(c.paid_count) === n - 1;
    act("Putting in your share", () => book.contribute(id), { paying: true }).then((ok) => {
      if (ok && lastToPay) note(`Everyone has paid — the pot of ${amount(c.contribution * BigInt(n))} went straight to ${escapeHtml(c.names[round] || "the member whose turn it is")}. ${txLink(ok.hash)}`, "ok");
    });
  });
  sheet.querySelector("[data-close-round]")?.addEventListener("click", () => {
    if (!wallet) return connect();
    act("Closing this turn", () => book.closeRound(id));
  });
  sheet.querySelector("[data-claim]")?.addEventListener("click", () => act("Collecting your payout", () => book.claim(id)));
}

// ---------- starting a circle ----------

/** "Ada, GABC…" per line -> [{ name, address }]; throws a sentence the organiser can act on. */
function parseMembers(text) {
  const members = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const address = (line.match(/G[A-Z2-7]{55}/) || [])[0];
    if (!address || !isAccountAddress(address)) throw new Error(`“${line.slice(0, 40)}” has no Stellar address in it. Write the name, then the G… address.`);
    const name = line.replace(address, "").replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, "");
    if (!name || name === "Your name") throw new Error(`Write a name next to ${short(address)}, the way the circle knows them.`);
    if (name.length > 60) throw new Error(`“${name.slice(0, 20)}…” is too long for a name.`);
    members.push({ name, address });
  }
  if (members.length < 2) throw new Error("A circle needs at least two members.");
  if (members.length > 30) throw new Error("A circle can have at most 30 members.");
  if (new Set(members.map((m) => m.address)).size !== members.length) throw new Error("The same address is on the list twice.");
  return members;
}

$("circle-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!wallet) return connect();
  const f = new FormData(e.target);
  let members, contribution;
  try {
    members = parseMembers(f.get("members"));
    contribution = toUnits(f.get("amount"), money.decimals);
    if (contribution <= 0n) throw new Error("The contribution has to be more than zero.");
  } catch (err) {
    return note(escapeHtml(err.message), "err");
  }
  const startTime = f.get("start") ? BigInt(Math.floor(new Date(`${f.get("start")}T00:00:00`).getTime() / 1000)) : 0n;
  const ok = await act("Starting the circle", () =>
    book.createCircle({ name: String(f.get("name")).trim(), members, contribution, startTime, roundDuration: Number(f.get("frequency")) })
  );
  if (ok) {
    e.target.reset();
    active = circles.length - 1;
    renderTabs();
    renderSheet();
  }
};

$("circle-add-me").onclick = () => {
  if (!wallet) return connect();
  const box = $("circle-form").elements.members;
  if (box.value.includes(wallet.publicKey)) return;
  // Put "Your name, G…" on a new line with the name selected, ready to type over.
  const before = box.value.trim() ? box.value.trim() + "\n" : "";
  const placeholder = "Your name";
  box.value = `${before}${placeholder}, ${wallet.publicKey}`;
  box.focus();
  box.setSelectionRange(before.length, before.length + placeholder.length);
};

// ---------- one-time setup: the keeper puts the book on Stellar ----------

function renderSetup() {
  $("circle-desk").hidden = true;
  $("page-tabs").innerHTML = "";
  $("sheet").innerHTML = `
    <header class="sheet-head">
      <span class="sheet-kicker">New book</span>
      <h2 class="sheet-title">Set up AjoBook on Stellar</h2>
      <p class="sheet-details">One-time step for the keeper. Your wallet puts the book’s contract on ${escapeHtml(NETWORK.name)}; it will ask you to sign twice.
        After that, anyone with the link can read the book and start circles.</p>
    </header>
    <div class="setup-choice" role="radiogroup" aria-label="What money is this book kept in?">
      <label><input type="radio" name="setup-money" value="XLM" checked />
        <span><b>Test XLM</b><small>Easiest for a live demo: every test wallet gets it free in one click.</small></span></label>
      <label><input type="radio" name="setup-money" value="USDC" />
        <span><b>Test USDC</b><small>The real-world choice. Each member adds USDC to their wallet and tops up from faucet.circle.com first.</small></span></label>
    </div>
    <div class="page-actions">
      <button id="setup-btn" class="btn btn-ink">${wallet ? "Set up the book" : "Open my wallet"}</button>
    </div>
    <div id="setup-out"></div>`;
  $("setup-btn").onclick = async () => {
    if (!wallet) return connect();
    if (busy) return;
    if (holdings === null) holdings = await walletMoney(wallet.publicKey, MONEY.XLM).catch(() => null);
    if (holdings && !holdings.exists) {
      renderWallet();
      return note("This wallet needs test XLM before it can set up the book. Use the button above.", "err");
    }
    const moneyKey = document.querySelector("[name=setup-money]:checked").value;
    busy = true;
    try {
      note("Step 1 of 2: storing the contract on Stellar… your wallet will ask you to sign.");
      const wasmHash = await uploadContractCode(wallet);
      note("Step 2 of 2: creating your book… sign once more.");
      const id = await createBook(wallet, wasmHash, moneyKey);
      try {
        localStorage.setItem(STORE_KEY, id);
      } catch {}
      contractId = id;
      book = openBook(contractId, wallet);
      const link = `${location.origin}${location.pathname}?book=${id}`;
      history.replaceState(null, "", `?book=${id}`);
      busy = false;
      await refresh();
      note(`The book is live on Stellar. Share this link so everyone opens the same book: <a href="${link}">${link}</a><br />Book ID: <code class="book-id">${id}</code>`, "ok");
    } catch (e) {
      console.error(e);
      busy = false;
      note(`That didn’t go through: ${escapeHtml(explain(e))}`, "err");
    }
  };
}

// ---------- go ----------

$("connect-btn").onclick = () => connect();
$("signout-btn").onclick = signOut;

// Keep the page fresh so a stamp lands on every screen when someone pays.
setInterval(() => {
  if (!busy && contractId && document.visibilityState === "visible" && !document.querySelector("dialog[open]")) {
    const typing = document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
    if (!typing) refresh();
  }
}, 8000);

refresh().then(() => connect({ quiet: true }));
