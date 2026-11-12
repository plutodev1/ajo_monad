// End-to-end check of AjoBook on Stellar testnet, using the same code the
// web page uses (src/stellar-chain.js) but signing with throwaway test keys.
//
//   npm run e2e            deploy a fresh book in test XLM and run a full circle
//
// It prints the new book's contract ID, so it doubles as a deploy script.
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  MONEY,
  NETWORK,
  createBook,
  explain,
  fromUnits,
  fundWithFriendbot,
  openBook,
  toUnits,
  uploadContractCode,
  walletMoney,
} from "../src/stellar-chain.js";

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

async function main() {
  const names = ["Ada", "Bola", "Chidi"];
  const wallets = names.map(() => walletFor(Keypair.random()));
  console.log("Funding three test wallets…");
  await Promise.all(wallets.map((w) => fundWithFriendbot(w.publicKey)));
  const [ada, bola, chidi] = wallets;

  console.log("Storing the contract and creating the book…");
  const wasmHash = await uploadContractCode(ada);
  const contractId = await createBook(ada, wasmHash, "XLM");
  console.log(`  book: ${contractId}`);
  console.log(`  ${NETWORK.explorer}/contract/${contractId}`);

  const dues = toUnits("10");
  const adaBook = openBook(contractId, ada);
  const reader = openBook(contractId); // no wallet: read-only, like a visitor

  check("the book is kept in XLM", (await reader.token()) === MONEY.XLM.sac);
  check("a new book has no circles", (await reader.circles()).length === 0);

  const created = await adaBook.createCircle({
    name: "E2E market women",
    members: wallets.map((w, i) => ({ name: names[i], address: w.publicKey })),
    contribution: dues,
    roundDuration: 300,
  });
  check(`circle opened (id ${created.result}, tx ${created.hash.slice(0, 8)}…)`, Number(created.result) === 0 && created.hash.length === 64);

  const before = await balance(ada);
  await adaBook.contribute(0);
  await openBook(contractId, bola).contribute(0);
  let c = await reader.circle(0);
  check("two members have paid, pot is 20 XLM", Number(c.paid_count) === 2 && c.pot === 2n * dues && c.paid[0] && c.paid[1] && !c.paid[2]);

  let twice = "";
  try {
    await adaBook.contribute(0);
  } catch (e) {
    twice = explain(e, { paying: true });
  }
  check(`paying twice is refused ("${twice}")`, /already paid/.test(twice));

  await openBook(contractId, chidi).contribute(0);
  c = (await reader.circles())[0];
  const after = await balance(ada);
  check("the last payment paid the pot out and opened turn 2", Number(c.current_round) === 1 && c.pot === 0n && c.received[0] === 3n * dues);
  check("types read back as the page expects", typeof c.contribution === "bigint" && typeof c.round_ends_at === "bigint" && typeof c.members[0] === "string" && c.names[1] === "Bola" && c.owed[0] === 0n && Number(c.missed[0]) === 0);
  // Ada paid 10 in and collected 30: up about 20 XLM, less a little in fees.
  const gain = after - before;
  check(`Ada collected the pot (balance moved by ${fromUnits(gain)} XLM)`, gain > toUnits("19") && gain <= toUnits("20"));

  let early = "";
  try {
    await adaBook.closeRound(0);
  } catch (e) {
    early = explain(e);
  }
  check(`closing a turn early is refused ("${early}")`, /still open/.test(early));

  console.log(process.exitCode ? "\nSomething is off — see FAIL above." : `\nAll good. Open the book: https://plutodev1.github.io/ajo_monad/stellar.html?book=${contractId}`);
}

main().catch((e) => {
  console.error("\nE2E stopped:", explain(e));
  console.error(e);
  process.exit(1);
});
