// End-to-end check of AjoBook on Stellar testnet, using the same code the
// web page uses (src/chain.js) but signing with throwaway test keys.
//
//   npm run e2e     deploy a fresh book in test XLM and run a circle through:
//                   members joining, a deposit, a late joiner and the history
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  MONEY,
  NETWORK,
  createBook,
  explain,
  fromUnits,
  fundWithFriendbot,
  joinCost,
  openBook,
  toUnits,
  uploadContractCode,
  walletMoney,
} from "../src/chain.js";

const walletFor = (kp) => ({
  publicKey: kp.publicKey(),
  signTransaction: async (xdr) => {
    const tx = TransactionBuilder.fromXDR(xdr, NETWORK.passphrase);
    tx.sign(kp);
    return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
  },
});

function check(what, ok) {
  console.log(`${ok ? "  ok " : "  FAIL"}  ${what}`);
  if (!ok) process.exitCode = 1;
}
const balance = async (w) => (await walletMoney(w.publicKey, MONEY.XLM)).balance;
const refused = async (fn, opts) => {
  try {
    await fn();
    return "";
  } catch (e) {
    return explain(e, opts);
  }
};

async function main() {
  const wallets = ["Ada", "Bola", "Chidi", "Dayo"].map(() => walletFor(Keypair.random()));
  console.log("Funding four test wallets…");
  await Promise.all(wallets.map((w) => fundWithFriendbot(w.publicKey)));
  const [ada, bola, chidi, dayo] = wallets;

  console.log("Storing the contract and creating the book…");
  const wasmHash = await uploadContractCode(ada);
  const contractId = await createBook(ada, wasmHash, "XLM");
  console.log(`  book: ${contractId}`);
  console.log(`  ${NETWORK.explorer}/contract/${contractId}`);

  const dues = toUnits("10");
  const book = (w) => openBook(contractId, w);
  const reader = openBook(contractId); // no wallet: read-only, like a visitor

  check("the book is kept in XLM", (await reader.token()) === MONEY.XLM.sac);
  check("a new book has no circles", (await reader.circles()).length === 0);

  // --- gathering: host opens, members write their own names ---
  const created = await book(ada).createCircle({ name: "E2E market women", hostName: "Ada", contribution: dues, roundDuration: 300, deposit: dues });
  check(`host opened a circle (id ${created.result}, tx ${created.hash.slice(0, 8)}…)`, Number(created.result) === 0 && created.hash.length === 64);
  const early = await refused(() => book(ada).start(0));
  check(`one member can’t start a circle ("${early}")`, /at least two/.test(early));
  await book(bola).join(0, "Bola");
  await book(chidi).join(0, "Chidi");
  let c = await reader.circle(0);
  check("Bola and Chidi joined with their own names and deposits", c.names.join() === "Ada,Bola,Chidi" && c.deposits.every((d) => d === dues) && !c.started && c.open);
  const notHost = await refused(() => book(bola).start(0));
  check(`only the host can start it (${notHost ? "refused" : "NOT refused"})`, notHost !== "");
  await book(ada).start(0);

  // --- turn 1: everyone pays, the pot goes to Ada ---
  const before = await balance(ada);
  await book(ada).contribute(0);
  await book(bola).contribute(0);
  c = await reader.circle(0);
  check("two members have paid, pot is 20 XLM", Number(c.paid_count) === 2 && c.pot === 2n * dues && c.paid[0] && c.paid[1] && !c.paid[2]);
  const twice = await refused(() => book(ada).contribute(0), { paying: true });
  check(`paying twice is refused ("${twice}")`, /already paid/.test(twice));
  await book(chidi).contribute(0);
  c = (await reader.circles())[0];
  const gain = (await balance(ada)) - before;
  check("the last payment paid the pot out and opened turn 2", Number(c.current_round) === 1 && c.pot === 0n && c.received[0] === 3n * dues);
  check(`Ada collected the pot (balance moved by ${fromUnits(gain)} XLM)`, gain > toUnits("19") && gain <= toUnits("20"));
  check("types read back as the page expects", typeof c.contribution === "bigint" && typeof c.round_ends_at === "bigint" && typeof c.members[0] === "string" && c.owed[0] === 0n && Number(c.missed[0]) === 0 && c.started === true);

  // --- a late joiner pays deposit + catch-up + this turn ---
  const cost = joinCost(c);
  check("joining now costs deposit 10 + catch-up 10 + this turn 10", cost.total === 3n * dues && cost.catchUp === dues);
  const dayoBefore = await balance(dayo);
  await book(dayo).join(0, "Dayo");
  c = await reader.circle(0);
  const spent = dayoBefore - (await balance(dayo));
  check(`Dayo joined mid-circle and paid ${fromUnits(spent)} XLM`, c.members.length === 4 && c.names[3] === "Dayo" && c.paid[3] && spent >= 3n * dues && spent < 3n * dues + toUnits("1"));
  check("Dayo’s catch-up is waiting for Ada", c.owed[0] === dues);
  await book(ada).claim(0);
  check("Ada collected the catch-up", (await reader.circle(0)).owed[0] === 0n);
  await book(ada).setOpen(0, false);
  const shut = await refused(() => book(walletFor(Keypair.random())).join(0, "Eve"), { paying: true });
  check(`the host closed the circle to new members (${shut ? "join refused" : "join NOT refused"})`, shut !== "");

  const tooSoon = await refused(() => book(ada).closeRound(0));
  check(`closing a turn early is refused ("${tooSoon}")`, /still open/.test(tooSoon));

  // --- the book's history ---
  const history = await reader.history();
  const kinds = history.map((h) => h.kind);
  console.log(`  history (newest first): ${kinds.join(", ")}`);
  check("history lists what happened, newest first", kinds.includes("circle_created") && kinds.includes("paid_out") && kinds.filter((k) => k === "joined").length === 3 && kinds[0] === "claimed");
  const paidOut = history.find((h) => h.kind === "paid_out");
  check("a history line carries circle, member, amount and transaction", paidOut && paidOut.circle === 0 && paidOut.member === ada.publicKey && paidOut.amount === 3n * dues && /^[0-9a-f]{64}$/.test(paidOut.hash) && paidOut.at > 1_700_000_000);

  console.log(process.exitCode ? "\nSomething is off — see FAIL above." : `\nAll good. Book: ${contractId}`);
}

main().catch((e) => {
  console.error("\nE2E stopped:", explain(e));
  console.error(e);
  process.exit(1);
});
