// Local dev override — anvil
export const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const MONAD_TESTNET = {
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost:8545"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://testnet.monadvision.com" } },
};
export const EXPLORER = MONAD_TESTNET.blockExplorers.default.url;
