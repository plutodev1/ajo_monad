// Everything AjoBook does on the Stellar network, with no page code in it,
// so the same functions run in the browser (signed by a wallet) and in the
// end-to-end test script (signed by throwaway test keys).
import {
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  contract,
  hash,
  rpc,
} from "@stellar/stellar-sdk";
import { AJOCIRCLE_WASM_B64 } from "./stellar-wasm.js";

export const NETWORK = {
  name: "Stellar Testnet",
  passphrase: Networks.TESTNET,
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  explorer: "https://stellar.expert/explorer/testnet",
};

// Circle's test USDC on Stellar testnet (free from faucet.circle.com).
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

/** The kinds of money a book can be kept in. Stellar assets have 7 decimals. */
export const MONEY = {
  XLM: { key: "XLM", symbol: "XLM", decimals: 7, asset: Asset.native(), sac: Asset.native().contractId(NETWORK.passphrase) },
  USDC: { key: "USDC", symbol: "USDC", decimals: 7, asset: USDC, sac: USDC.contractId(NETWORK.passphrase) },
};
export const moneyBySac = (sac) =>
  Object.values(MONEY).find((m) => m.sac === sac) || { key: "?", symbol: "tokens", decimals: 7, asset: null, sac };

export const isAccountAddress = (s) => StrKey.isValidEd25519PublicKey(s);
export const isContractAddress = (s) => StrKey.isValidContract(s);

const wasmBytes = () => Uint8Array.from(atob(AJOCIRCLE_WASM_B64), (ch) => ch.charCodeAt(0));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const server = () => new rpc.Server(NETWORK.rpcUrl);

// ---------- errors people can read ----------

const CONTRACT_ERRORS = {
  1: "That circle isn’t in the book.",
  2: "This circle has finished — every turn has been paid.",
  3: "This wallet isn’t a member of this circle.",
  4: "You’ve already paid this turn.",
  5: "This circle hasn’t started yet.",
  6: "Time is up for this turn. Close the turn to pay out what came in.",
  7: "This turn is still open — it can only be closed after its deadline.",
  8: "Check the member list: at least 2 and at most 30 members, each wallet only once, one name each.",
  9: "The contribution has to be more than zero.",
  10: "Choose how often the circle pays.",
  11: "Names can’t be blank, and must be 64 characters or fewer.",
  12: "There’s nothing waiting to be collected.",
  13: "The payout still can’t be delivered — check the wallet can hold this money, then try again.",
};
// The token contract has its own numbering; these come up when paying in.
const TOKEN_ERRORS_WHEN_PAYING = {
  10: "There isn’t enough money in this wallet for the contribution.",
  13: "This wallet can’t hold this money yet. Add it to the wallet first.",
};

/** Turn whatever the network or wallet threw into one plain sentence. */
export function explain(e, { paying = false } = {}) {
  const raw = String(e?.message || e?.error?.message || e?.error || e || "");
  const code = Number((raw.match(/Error\(Contract, #(\d+)\)/) || [])[1]);
  if (code) {
    if (paying && code >= 7 && TOKEN_ERRORS_WHEN_PAYING[code]) return TOKEN_ERRORS_WHEN_PAYING[code];
    if (CONTRACT_ERRORS[code]) return CONTRACT_ERRORS[code];
  }
  if (/resulting balance is not within the allowed range|insufficient balance|underfunded/i.test(raw))
    return "There isn’t enough money in this wallet.";
  if (/trustline/i.test(raw)) return "This wallet can’t hold this money yet. Add it to the wallet first.";
  if (/Account not found|account entry is missing/i.test(raw))
    return "This wallet hasn’t been activated on Stellar testnet yet. Get free test XLM first.";
  if (/User declined|rejected|denied|cancel/i.test(raw)) return "You closed the wallet without signing.";
  if (/Failed to fetch|NetworkError|ENOTFOUND|ECONNREFUSED|timeout/i.test(raw)) return "The network didn’t answer. Try again.";
  return raw.length > 220 ? raw.slice(0, 220) + "…" : raw || "Something went wrong.";
}

// ---------- signing and sending ordinary transactions ----------

async function signWith(wallet, tx) {
  const signed = await wallet.signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK.passphrase,
    address: wallet.publicKey,
  });
  if (signed?.error) throw new Error(signed.error.message || String(signed.error));
  const xdr = signed?.signedTxXdr || signed;
  return TransactionBuilder.fromXDR(xdr, NETWORK.passphrase);
}

/** Send a signed transaction and wait until the ledger has taken it. */
async function sendAndWait(tx) {
  const s = server();
  const sent = await s.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "DUPLICATE" || sent.status === "TRY_AGAIN_LATER") {
    const why = sent.errorResult?.result?.()?.switch?.()?.name || sent.status;
    throw new Error(`The network refused the transaction (${why}).`);
  }
  for (let i = 0; i < 40; i++) {
    const got = await s.getTransaction(sent.hash);
    if (got.status === "SUCCESS") return { hash: sent.hash, response: got };
    if (got.status === "FAILED") throw new Error("The transaction failed on the network.");
    await sleep(1000);
  }
  throw new Error("The network is taking too long to confirm. Check the explorer before trying again.");
}

async function buildTx(publicKey, operation) {
  const account = await server().getAccount(publicKey);
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(operation)
    .setTimeout(300)
    .build();
}

// ---------- one-time setup: put the contract on the network ----------

/** Step 1: store the contract code on the network. Returns its hash (hex). */
export async function uploadContractCode(wallet) {
  const wasm = wasmBytes();
  const tx = await buildTx(wallet.publicKey, Operation.uploadContractWasm({ wasm }));
  const prepared = await server().prepareTransaction(tx);
  await sendAndWait(await signWith(wallet, prepared));
  return toHex(hash(wasm));
}

/** Step 2: create this community's book, kept in the given money. Returns the contract ID. */
export async function createBook(wallet, wasmHash, moneyKey) {
  const money = MONEY[moneyKey];
  if (!money) throw new Error("Unknown money: " + moneyKey);
  const tx = await contract.Client.deploy(
    { token: money.sac },
    {
      wasmHash,
      format: "hex",
      networkPassphrase: NETWORK.passphrase,
      rpcUrl: NETWORK.rpcUrl,
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
    }
  );
  const sent = await tx.signAndSend();
  return sent.result.options.contractId;
}

// ---------- the book ----------

/**
 * Open a book. `wallet` is { publicKey, signTransaction } or null to read only.
 * Returns plain functions; amounts are bigint in the money's smallest unit.
 */
export function openBook(contractId, wallet = null) {
  const client = new contract.Client(contract.Spec.fromWasm(wasmBytes()), {
    contractId,
    networkPassphrase: NETWORK.passphrase,
    rpcUrl: NETWORK.rpcUrl,
    ...(wallet ? { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction } : {}),
  });

  const unwrap = (r) => (r && typeof r.isErr === "function" ? r.unwrap() : r);
  const read = async (method, args) => unwrap((await client[method](args)).result);
  const write = async (method, args) => {
    if (!wallet) throw new Error("Open your wallet first.");
    const tx = await client[method](args);
    const sent = await tx.signAndSend();
    return { hash: sent.sendTransactionResponse?.hash || sent.getTransactionResponse?.txHash || "", result: unwrap(sent.result) };
  };

  return {
    contractId,
    token: () => read("token", undefined),
    circleCount: () => read("circle_count", undefined),
    circle: (id) => read("get_circle", { id }),
    circles: () => read("get_circles", { start: 0, limit: 200 }),
    /** members: [{ address, name }] in payout order. Returns { hash, result: newCircleId }. */
    createCircle: ({ name, members, contribution, startTime = 0n, roundDuration }) =>
      write("create_circle", {
        organizer: wallet?.publicKey,
        name,
        members: members.map((m) => m.address),
        names: members.map((m) => m.name),
        contribution: BigInt(contribution),
        start_time: BigInt(startTime),
        round_duration: BigInt(roundDuration),
      }),
    contribute: (id) => write("contribute", { id, member: wallet?.publicKey }),
    closeRound: (id) => write("close_round", { id }),
    claim: (id, member) => write("claim", { id, member: member || wallet?.publicKey }),
  };
}

// ---------- wallets and money ----------

/** What the wallet holds. `exists` is false until the account has been funded once. */
export async function walletMoney(publicKey, money) {
  const res = await fetch(`${NETWORK.horizonUrl}/accounts/${publicKey}`);
  if (res.status === 404) return { exists: false, balance: 0n, canHold: false };
  if (!res.ok) throw new Error("The network didn’t answer.");
  const account = await res.json();
  const line = (account.balances || []).find((b) =>
    money.asset?.isNative()
      ? b.asset_type === "native"
      : b.asset_code === money.asset?.getCode() && b.asset_issuer === money.asset?.getIssuer()
  );
  return { exists: true, balance: line ? toUnits(line.balance, money.decimals) : 0n, canHold: Boolean(line) };
}

/** Free test XLM, which also activates a brand-new testnet wallet. */
export async function fundWithFriendbot(publicKey) {
  const res = await fetch(`${NETWORK.friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok && res.status !== 400) throw new Error("The test faucet didn’t answer. Try again in a moment.");
}

/** Let the wallet hold a non-XLM money such as USDC (a Stellar "trustline"). */
export async function allowWalletToHold(wallet, money) {
  if (!money.asset || money.asset.isNative()) return;
  const tx = await buildTx(wallet.publicKey, Operation.changeTrust({ asset: money.asset }));
  return sendAndWait(await signWith(wallet, tx));
}

// ---------- amounts ----------

/** "12.5" -> 125000000n */
export function toUnits(text, decimals = 7) {
  const s = String(text ?? "").trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error("That isn’t an amount.");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** 125000000n -> "12.50" (at least 2 decimals, more only when needed) */
export function fromUnits(units, decimals = 7) {
  const u = BigInt(units);
  const neg = u < 0n;
  const abs = neg ? -u : u;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
