import { defineChain } from "viem";
import { arbitrumSepolia } from "viem/chains";

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
});

// Each network the app can open. Members pick one with the switch in the top bar.
//  - book / circles: contract addresses ("" = not deployed yet; the keeper gets a setup screen)
//  - money: "erc20" pays in a stablecoin (needs an approval first), "native" pays in the chain's coin
//  - legacy: the original Monad dues book (pays in MON, no Esusu circles)
export const NETWORKS = {
  arbitrum: {
    key: "arbitrum",
    label: "Arbitrum",
    chain: arbitrumSepolia,
    book: "",
    circles: "",
    money: { kind: "erc20", symbol: "USDC", decimals: 6, address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
    explorer: "https://arbitrum-sepolia.blockscout.com",
    gasFaucet: "https://www.alchemy.com/faucets/arbitrum-sepolia",
    moneyFaucet: "https://faucet.circle.com",
    legacy: false,
  },
  monad: {
    key: "monad",
    label: "Monad",
    chain: monadTestnet,
    book: "0xE64f39E74Caf57Dfe7b886cdBbAcC463af877723",
    circles: "",
    money: { kind: "native", symbol: "MON", decimals: 18 },
    explorer: "https://testnet.monadvision.com",
    gasFaucet: "https://faucet.monad.xyz",
    moneyFaucet: "https://faucet.monad.xyz",
    legacy: true,
  },
};

export const DEFAULT_NETWORK = "arbitrum";
