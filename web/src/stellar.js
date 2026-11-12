// AjoBook on Stellar: the Esusu circles page.
// All network work lives in stellar-chain.js; this file is the page.
import * as freighterModule from "@stellar/freighter-api";
import qrcode from "qrcode-generator";
import { STELLAR } from "./stellar-config.js";
import {
  MONEY,
  NETWORK,
  allowWalletToHold,
  createBook,
  explain,
  fromUnits,
  fundWithFriendbot,
  isContractAddress,
  joinCost,
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
let active = Number(new URLSearchParams(location.search).get("circle")) || 0;
let history = null; // the book's recent history, newest first (null = not loaded)
let joinNameDraft = ""; // what a visitor has typed in the "join" line, kept across refreshes
let busy = false;

function pickBook() {
  const fromLink = new URLSearchParams(location.search).get("book");
  if (fromLink === "new") return ""; // ?book=new: show the setup screen to start another book
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
// Round down to 2 decimals for the small balance in the top bar.
const amountShort = (units) => amount(BigInt(units) - (BigInt(units) % 10n ** BigInt(money.decimals - 2)));
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const inviteLink = (id) => {
  const q = new URLSearchParams();
  if (contractId !== STELLAR.circles) q.set("book", contractId);
  q.set("circle", String(id));
  return `${location.origin}${location.pathname}?${q}`;
};
const qrSvg = (text) => {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
};
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
  $("wallet-balance").textContent = holdings?.exists ? amountShort(holdings.balance) : "";

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
    $("sheet").innerHTML = `<p class="sheet-loading">Couldn’t open the book — ${escapeHtml(explain(e).replace(/ Try again\.$/, ""))} <button class="btn" id="retry-btn">Try again</button></p>`;
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
  // The history is a nice-to-have: load it after the page, and never let it break the book.
  book
    .history()
    .then((h) => {
      history = h;
      renderHistory();
    })
    .catch((e) => console.warn("history unavailable", e));
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
      <p class="empty-invite">${wallet ? "Host one below — you’ll get a link to share with your members." : "Open your wallet to host a circle."}</p>
      ${`<div class="blank-rule"></div>`.repeat(4)}`;
    return;
  }

  const c = circles[active];
  const id = Number(c.id);
  const n = c.members.length;
  const round = Number(c.current_round);
  const running = c.started && !c.finished;
  const gathering = !c.started && !c.finished;
  const overdue = running && nowSec() > c.round_ends_at;
  const myIndex = wallet ? c.members.indexOf(wallet.publicKey) : -1;
  const isMember = myIndex >= 0;
  const isHost = Boolean(wallet) && wallet.publicKey === c.organizer;
  const iPaid = isMember && c.paid[myIndex];
  const myOwed = isMember ? c.owed[myIndex] : 0n;
  const cost = joinCost(c);

  const terms = [
    `Each member puts in <b>${amount(c.contribution)}</b> ${freqWord(c.round_duration)}`,
    gathering ? `<b>${n}</b> ${n === 1 ? "member" : "members"} so far` : `pot of <b>${amount(c.contribution * BigInt(n))}</b> per turn`,
    c.deposit > 0n ? `deposit of <b>${amount(c.deposit)}</b> each` : "",
    c.cancelled
      ? `the host called this circle off`
      : c.finished
        ? `every turn has been paid`
        : gathering
          ? `waiting for the host to start`
          : `turn ${round + 1} of ${n} · ${overdue ? "<b>time is up</b>" : `closes <b>${whenWords(c.round_ends_at)}</b>`}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const rows = c.members
    .map((addr, i) => {
      const you = wallet && addr === wallet.publicKey;
      let status = "";
      if (c.owed[i] > 0n) status = `<span class="stamp stamp-wait">${amount(c.owed[i])} waiting</span>`;
      else if (c.started && i < round) status = `<span class="stamp">Collected ${amount(c.received[i])}</span>`;
      else if (running && i === round) status = `<span class="stamp stamp-turn">Their turn</span>`;
      const paidMark = running && c.paid[i] ? `<span class="stamp">Paid ✓</span>` : "";
      const missed = c.missed[i] > 0 ? `<span class="missed">missed ${c.missed[i]}</span>` : "";
      const depositUsed = c.deposit > 0n && c.started && !c.finished && c.deposits[i] < c.deposit ? `<span class="tag">deposit used</span>` : "";
      const host = addr === c.organizer ? `<span class="tag">host</span>` : "";
      return `<li class="entry">
        <span class="no">${i + 1}</span>
        <span class="who">
          <b>${escapeHtml(c.names[i] || "Member")}</b>
          <code title="${addr}">${short(addr)}</code>
          ${you ? `<span class="you-mark">— you</span>` : ""} ${host} ${missed} ${depositUsed}
        </span>
        <span class="leader" aria-hidden="true"></span>
        <span class="amt">${paidMark}</span>
        ${status}
      </li>`;
    })
    .join("");

  // What this visitor can do on this page, most important first.
  const actions = [];
  let joinForm = "";
  if (myOwed > 0n) actions.push(`<button class="btn btn-ink" data-claim>Collect my ${amount(myOwed)}</button>`);
  if (overdue) actions.push(`<button class="btn btn-red" data-close-round>Close this turn and pay out what came in</button>`);
  if (!c.finished) {
    if (!wallet) {
      actions.push(`<button class="btn btn-ink" data-connect>Open my wallet${c.open ? " to join" : ""}</button>`);
    } else if (isMember) {
      if (running && !overdue && !iPaid) actions.push(`<button class="btn btn-ink" data-contribute>Put in my ${amount(c.contribution)}</button>`);
      else if (running && iPaid) actions.push(`<p class="paid-note">You’ve paid this turn ✓ — the pot goes out the moment the last person pays.</p>`);
      else if (gathering && !isHost) actions.push(`<p class="paid-note">You’re in ✓ — the host starts the circle when everyone has joined.</p>`);
    } else if (c.open && !overdue) {
      const parts = [
        cost.deposit > 0n ? `${amount(cost.deposit)} deposit` : "",
        cost.catchUp > 0n ? `${amount(cost.catchUp)} catch-up for the ${round === 1 ? "turn" : `${round} turns`} already paid out` : "",
        cost.thisTurn > 0n ? `${amount(cost.thisTurn)} for this turn` : "",
      ].filter(Boolean);
      joinForm = `
        <form class="join-line" data-join>
          <input name="name" required maxlength="40" placeholder="Write your name" aria-label="Your name" value="${escapeHtml(joinNameDraft)}" />
          <button class="btn btn-ink" type="submit">${cost.total > 0n ? `Join — ${amount(cost.total)}` : "Join the circle"}</button>
        </form>
        <p class="cost-note">${
          parts.length
            ? `Joining ${c.started ? "now " : ""}costs ${parts.join(" + ")}.${c.started ? " You’ll collect last." : ""}${cost.deposit > 0n ? " Your deposit comes back at the end if you never miss a turn." : ""}`
            : "Joining is free. You pay in once the host starts the circle."
        }</p>`;
    } else if (!c.open) {
      actions.push(`<p class="paid-note">The host has closed this circle to new members.</p>`);
    }
  }

  const hostTools = [];
  if (isHost && !c.finished) {
    if (gathering) {
      hostTools.push(
        n >= 2
          ? `<button class="btn btn-ink" data-start>Start the circle with ${n} members</button>`
          : `<button class="btn" disabled>Start the circle (needs 2 members)</button>`
      );
      hostTools.push(`<button class="btn btn-red" data-cancel>Call it off</button>`);
    }
    hostTools.push(
      c.open ? `<button class="btn" data-set-open="false">Stop new members joining</button>` : `<button class="btn" data-set-open="true">Let new members join</button>`
    );
  }
  if (gathering && isMember && !isHost) hostTools.push(`<button class="btn" data-leave>Leave the circle</button>`);

  const link = inviteLink(id);
  const invite =
    c.open && !c.finished
      ? `<div class="invite">${qrSvg(link)}
          <div class="invite-text"><b>${gathering ? "Invite your members" : "New members can still join"}</b>
            Scan the code or open the link, then write your name in the book.
            <code>${escapeHtml(link)}</code>
            <button class="btn" type="button" data-copy>Copy the link</button></div>
        </div>`
      : "";

  sheet.innerHTML = `
    <header class="sheet-head">
      <div class="sheet-title-row">
        <span class="sheet-kicker">Circle ${active + 1}</span>
        <h2 class="sheet-title">${escapeHtml(c.name)}</h2>
        ${c.cancelled ? `<span class="stamp stamp-small stamp-red">Called off</span>` : c.finished ? `<span class="stamp stamp-small">Completed</span>` : ""}
      </div>
      <p class="sheet-terms">${terms}</p>
      <p class="sheet-details">Turns go in the order below. Nobody holds the money: the contract pays the person whose turn it is as soon as everyone has paid.</p>
    </header>
    <ol class="entries">${rows}</ol>
    ${joinForm}
    ${
      c.started
        ? `<div class="sum">
      <span class="sum-label">${c.finished ? "circle complete" : "in the pot this turn"}</span>
      <b>${amount(c.finished ? 0n : c.pot)}</b>
    </div>`
        : ""
    }
    <div class="page-actions">${actions.join("")}</div>
    ${hostTools.length ? `<div class="host-tools">${hostTools.join("")}</div>` : ""}
    ${invite}
    <div id="history"></div>`;

  const on = (selector, fn) => sheet.querySelector(selector)?.addEventListener("click", fn);
  on("[data-connect]", () => connect());
  on("[data-contribute]", () => {
    if (holdings && holdings.exists && holdings.canHold && holdings.balance < c.contribution) {
      return note(`This wallet holds ${amount(holdings.balance)}, and the contribution is ${amount(c.contribution)}. Top it up first.`, "err");
    }
    const lastToPay = Number(c.paid_count) === n - 1;
    act("Putting in your share", () => book.contribute(id), { paying: true }).then((ok) => {
      if (ok && lastToPay) note(`Everyone has paid — the pot of ${amount(c.pot + c.contribution)} went straight to ${escapeHtml(c.names[round] || "the member whose turn it is")}. ${txLink(ok.hash)}`, "ok");
    });
  });
  on("[data-close-round]", () => (wallet ? act("Closing this turn", () => book.closeRound(id)) : connect()));
  on("[data-claim]", () => act("Collecting your money", () => book.claim(id)));
  on("[data-start]", () => act("Starting the circle", () => book.start(id)));
  on("[data-cancel]", () => act("Calling the circle off", () => book.cancel(id)));
  on("[data-leave]", () => act("Leaving the circle", () => book.leave(id)));
  on("[data-set-open]", (e) => {
    const open = e.currentTarget.dataset.setOpen === "true";
    act(open ? "Opening the circle to new members" : "Closing the circle to new members", () => book.setOpen(id, open));
  });
  on("[data-copy]", async (e) => {
    try {
      await navigator.clipboard.writeText(link);
      e.currentTarget.textContent = "Copied ✓";
    } catch {
      note(`Copy this link: <code>${escapeHtml(link)}</code>`);
    }
  });
  const join = sheet.querySelector("[data-join]");
  if (join) {
    join.elements.name.addEventListener("input", (e) => (joinNameDraft = e.target.value));
    join.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = join.elements.name.value.trim();
      if (!name) return note("Write your name first, the way the circle knows you.", "err");
      if (holdings && holdings.exists && holdings.canHold && holdings.balance < cost.total) {
        return note(`This wallet holds ${amount(holdings.balance)}, and joining costs ${amount(cost.total)}. Top it up first.`, "err");
      }
      act("Writing your name in the book", () => book.join(id, name), { paying: true }).then((ok) => {
        if (ok) joinNameDraft = "";
      });
    });
  }
  renderHistory();
}

// ---------- the book's history, under the page ----------

const HISTORY_LINES = {
  circle_created: (h, who) => `${who} opened the circle`,
  joined: (h, who) => `${who} joined${h.amount > 0n ? ` and paid ${amount(h.amount)}` : ""}`,
  left: (h, who) => `${who} left the circle`,
  started: (h) => `The host started the circle with ${h.members} members`,
  cancelled: () => `The host called the circle off`,
  contributed: (h, who) => `${who} put in ${amount(h.amount)} for turn ${Number(h.round) + 1}`,
  paid_out: (h, who) =>
    `Turn ${Number(h.round) + 1}: the pot of ${amount(h.amount)} went to ${who}` +
    (h.defaulters > 0 ? ` · ${h.defaulters} missed${h.covered > 0 ? `, ${h.covered} covered by deposit` : ""}` : ""),
  claimed: (h, who) => `${who} collected ${amount(h.amount)}`,
  circle_finished: () => `Every turn has been paid. The circle is complete`,
};

function renderHistory() {
  const el = $("history");
  const c = circles[active];
  if (!el || !c || !history) return;
  const lines = history.filter((h) => h.circle === Number(c.id) && HISTORY_LINES[h.kind]).slice(0, 40);
  if (!lines.length) {
    el.innerHTML = "";
    return;
  }
  const nameOf = (addr) => {
    const i = addr ? c.members.indexOf(addr) : -1;
    return `<b>${escapeHtml(i >= 0 ? c.names[i] : addr ? short(addr) : "Someone")}</b>`;
  };
  el.innerHTML = `<h3 class="history-title">What has happened in this circle</h3>
    <ul class="history">${lines
      .map(
        (h) => `<li><span>${HISTORY_LINES[h.kind](h, nameOf(h.member))}</span>
          <span>${h.at ? whenWords(h.at) : ""} <a href="${NETWORK.explorer}/tx/${h.hash}" target="_blank" rel="noopener" title="See it on Stellar">↗</a></span></li>`
      )
      .join("")}</ul>`;
}

// ---------- hosting a circle ----------

$("circle-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!wallet) return connect();
  const f = new FormData(e.target);
  let contribution;
  try {
    contribution = toUnits(f.get("amount"), money.decimals);
    if (contribution <= 0n) throw new Error("The contribution has to be more than zero.");
  } catch (err) {
    return note(escapeHtml(err.message), "err");
  }
  const name = String(f.get("name")).trim();
  const hostName = String(f.get("hostName")).trim();
  if (!name || !hostName) return note("Name the circle and write your own name.", "err");
  const deposit = f.get("deposit") ? contribution : 0n;
  if (holdings && holdings.exists && holdings.canHold && holdings.balance < deposit) {
    return note(`This wallet holds ${amount(holdings.balance)}, and your deposit is ${amount(deposit)}. Top it up first.`, "err");
  }
  const ok = await act("Opening the circle", () => book.createCircle({ name, hostName, contribution, roundDuration: Number(f.get("frequency")), deposit }), { paying: true });
  if (ok) {
    e.target.reset();
    active = circles.length - 1;
    renderTabs();
    renderSheet();
    note("Your circle is open. Share the link or QR code below so members can join, then start it.", "ok");
    $("sheet").scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
      window.history.replaceState(null, "", `?book=${id}`);
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
