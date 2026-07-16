// Deployed AjoBook contract on Monad testnet (verified via Sourcify).
export const CONTRACT_ADDRESS = "0xE64f39E74Caf57Dfe7b886cdBbAcC463af877723";

export const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
};

export const EXPLORER = MONAD_TESTNET.blockExplorers.default.url;
