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

const publicClient = createPublicClient({
  chain: MONAD_TESTNET,
  transport: http(),
});

let walletClient = null;
let account = null;
let adminAddr = null;
let campaigns = [];

const contract = { address: CONTRACT_ADDRESS, abi: AJOBOOK_ABI };

// ---------- helpers ----------

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const mon = (wei) => {
  const s = formatEther(wei);
  const n = Number(s);
  return `${n >= 1000 ? n.toLocaleString() : s.replace(/(\.\d{4})\d+$/, "$1")} MON`;
};

function banner(msg, cls = "") {
  const el = $("banner");
  el.innerHTML = msg;
  el.className = `banner ${cls}`;
  el.hidden = false;
}

function txLink(hash) {
  return `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">view transaction ↗</a>`;
}

async function sendTx(label, fn) {
  try {
    banner(`${label}… confirm in your wallet.`);
    const hash = await fn();
    banner(`${label}: waiting for the chain to write it down… ${txLink(hash)}`);
    await publicClient.waitForTransactionReceipt({ hash });
    banner(`${label} ✓ recorded in the book. ${txLink(hash)}`, "ok");
    await refresh();
  } catch (e) {
    banner(`${label} failed: ${e.shortMessage || e.message}`, "err");
  }
}

// ---------- wallet ----------

async function connect() {
  if (!window.ethereum) {
    banner(
      `No wallet found. Install <a href="https://metamask.io" target="_blank" rel="noopener">MetaMask</a> and refresh this page.`,
      "err"
    );
    return;
  }
  walletClient = createWalletClient({ chain: MONAD_TESTNET, transport: custom(window.ethereum) });
  const [addr] = await walletClient.requestAddresses();
  account = getAddress(addr);

  try {
    await walletClient.switchChain({ id: MONAD_TESTNET.id });
  } catch {
    await walletClient.addChain({ chain: MONAD_TESTNET });
    await walletClient.switchChain({ id: MONAD_TESTNET.id });
  }

  $("connect-btn").hidden = true;
  $("wallet-info").hidden = false;
  $("network-pill").hidden = false;
  $("wallet-addr").textContent = short(account);
  $("member-card").hidden = false;
  await refresh();
}

// ---------- rendering ----------

function campaignCard(c, id, ledger) {
  const open = !c.closed && (c.deadline === 0n || BigInt(Math.floor(Date.now() / 1000)) <= c.deadline);
  const badge = open
    ? `<span class="badge open">Open</span>`
    : `<span class="badge closed">${c.closed ? "Closed" : "Deadline passed"}</span>`;
  const duesLine =
    c.duesAmount > 0n ? `Dues: <b>${mon(c.duesAmount)}</b>` : `Any amount welcome`;
  const deadlineLine =
    c.deadline > 0n
      ? `<br/>Deadline: ${new Date(Number(c.deadline) * 1000).toLocaleDateString()}`
      : "";

  const rows = ledger
    .map(
      (p) => `<tr>
        <td class="who">${p.name ? `<b>${escapeHtml(p.name)}</b>` : ""}<code>${short(p.member)}</code></td>
        <td class="amt">${mon(p.amount)}</td>
        <td><span class="paid-stamp">PAID ✓</span></td>
      </tr>`
    )
    .join("");

  const isAdmin = account && adminAddr && account === adminAddr;

  return `<article class="campaign">
    <div class="campaign-head">
      <div>
        <h4>${escapeHtml(c.name)} ${badge}</h4>
        <p class="details">${escapeHtml(c.details)}</p>
      </div>
      <div class="campaign-meta">
        ${duesLine}${deadlineLine}<br/>
        Collected: <b>${mon(c.totalCollected)}</b> from ${c.payerCount} member${c.payerCount === 1 ? "" : "s"}
      </div>
    </div>
    <div class="campaign-actions">
      ${open ? `<button class="btn btn-stamp" data-pay="${id}">Pay dues</button>` : ""}
      ${isAdmin && !c.closed ? `<button class="btn" data-close="${id}">Close page</button>` : ""}
    </div>
    <div class="ledger">
      <table>
        <caption>Ledger — page ${id + 1}</caption>
        ${
          ledger.length
            ? `<thead><tr><th>Member</th><th class="amt">Paid</th><th></th></tr></thead><tbody>${rows}</tbody>`
            : ""
        }
      </table>
      ${ledger.length ? "" : `<p class="none">No entries yet. Be the first name on this page.</p>`}
    </div>
  </article>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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

    $("community-name").textContent = name;
    $("book-balance").textContent = mon(balance);
    $("contract-link").href = `${EXPLORER}/address/${CONTRACT_ADDRESS}`;

    const ledgers = await Promise.all(
      all.map((_, i) => publicClient.readContract({ ...contract, functionName: "getLedger", args: [BigInt(i)] }))
    );

    const totalCollected = all.reduce((s, c) => s + c.totalCollected, 0n);
    const totalPayers = all.reduce((s, c) => s + BigInt(c.payerCount), 0n);
    $("cover-stats").innerHTML = `
      <div class="stat"><b>${all.length}</b><span>pages opened</span></div>
      <div class="stat"><b>${mon(totalCollected)}</b><span>collected, verifiably</span></div>
      <div class="stat"><b>${totalPayers}</b><span>entries in the book</span></div>`;

    const wrap = $("campaigns");
    if (!all.length) {
      wrap.innerHTML = `<p class="empty">The book is empty — the keeper hasn’t opened a page yet.</p>`;
    } else {
      wrap.innerHTML = all.map((c, i) => campaignCard(c, i, ledgers[i])).join("");
    }

    if (account) {
      const myName = await publicClient.readContract({
        ...contract,
        functionName: "memberName",
        args: [account],
      });
      $("wallet-name").textContent = myName || "Unnamed member";
      if (myName) $("name-input").value = myName;
    }

    const isAdmin = account && account === adminAddr;
    $("admin-card").hidden = !isAdmin;
    $("new-campaign-btn").hidden = !isAdmin;

    wireCampaignButtons();
  } catch (e) {
    $("campaigns-empty") &&
      ($("campaigns").innerHTML = `<p class="empty">Could not reach the Monad testnet ledger (${e.shortMessage || "network error"}). Refresh to retry.</p>`);
  }
}

// ---------- actions ----------

function wireCampaignButtons() {
  document.querySelectorAll("[data-pay]").forEach((btn) => {
    btn.onclick = () => openPayDialog(Number(btn.dataset.pay));
  });
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => {
      const id = BigInt(btn.dataset.close);
      sendTx("Closing page", () =>
        walletClient.writeContract({ ...contract, functionName: "closeCampaign", args: [id], account })
      );
    };
  });
}

function openPayDialog(id) {
  if (!account) return connect();
  const c = campaigns[id];
  $("pay-title").textContent = `Pay dues — ${c.name}`;
  const fixed = c.duesAmount > 0n;
  $("pay-sub").textContent = fixed
    ? `This page has fixed dues of ${mon(c.duesAmount)}.`
    : "This page accepts any amount.";
  $("pay-amount-label").hidden = fixed;
  $("pay-amount").value = fixed ? formatEther(c.duesAmount) : "";
  $("pay-amount").required = !fixed;
  $("pay-dialog").showModal();
  $("pay-form").onsubmit = (e) => {
    e.preventDefault();
    const value = fixed ? c.duesAmount : parseEther($("pay-amount").value || "0");
    $("pay-dialog").close();
    sendTx("Paying dues", () =>
      walletClient.writeContract({ ...contract, functionName: "payDues", args: [BigInt(id)], value, account })
    );
  };
}

// ---------- wire up ----------

$("connect-btn").onclick = () => connect().catch((e) => banner(e.shortMessage || e.message, "err"));
$("pay-cancel").onclick = () => $("pay-dialog").close();

$("name-btn").onclick = () => {
  const name = $("name-input").value.trim();
  if (!name) return banner("Type a name first.", "err");
  if (!walletClient) return connect();
  sendTx("Writing your name", () =>
    walletClient.writeContract({ ...contract, functionName: "setMyName", args: [name], account })
  );
};

$("new-campaign-btn").onclick = () => $("create-form").scrollIntoView({ behavior: "smooth" });

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
  ).then(() => e.target.reset());
};

$("withdraw-form").onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  sendTx("Withdrawing to treasury", () =>
    walletClient.writeContract({
      ...contract,
      functionName: "withdraw",
      args: [getAddress(String(f.get("to"))), parseEther(String(f.get("amount")))],
      account,
    })
  );
};

refresh();
