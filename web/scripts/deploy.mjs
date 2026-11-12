// Put a fresh, empty AjoBook on Stellar testnet and print its contract ID.
//
//   npm run deploy           book kept in test XLM
//   npm run deploy -- USDC   book kept in test USDC
//
// The key that deploys is a throwaway: the contract has no owner or admin,
// so whoever deploys it has no special power over the book afterwards.
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { MONEY, NETWORK, createBook, explain, fundWithFriendbot, openBook, uploadContractCode } from "../src/chain.js";

const moneyKey = (process.argv[2] || "XLM").toUpperCase();
if (!MONEY[moneyKey]) {
  console.error(`Unknown money "${moneyKey}". Use XLM or USDC.`);
  process.exit(1);
}

const kp = Keypair.random();
const wallet = {
  publicKey: kp.publicKey(),
  signTransaction: async (xdr) => {
    const tx = TransactionBuilder.fromXDR(xdr, NETWORK.passphrase);
    tx.sign(kp);
    return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
  },
};

try {
  await fundWithFriendbot(wallet.publicKey);
  const wasmHash = await uploadContractCode(wallet);
  const contractId = await createBook(wallet, wasmHash, moneyKey);
  const count = await openBook(contractId).circleCount();
  console.log(`BOOK_ID=${contractId}`);
  console.log(`Kept in ${moneyKey}, ${count} circles. ${NETWORK.explorer}/contract/${contractId}`);
} catch (e) {
  console.error("Deploy stopped:", explain(e));
  console.error(e);
  process.exit(1);
}
