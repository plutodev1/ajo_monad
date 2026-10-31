import { arbitrumSepolia } from "viem/chains";

// Which network the app talks to. For mainnet, switch to `arbitrum` from
// "viem/chains", set USDC_ADDRESS to 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
// and EXPLORER to https://arbitrum.blockscout.com.
export const CHAIN = arbitrumSepolia;

// Fill these in with the addresses printed by `forge script script/Deploy.s.sol`.
export const AJOBOOK_ADDRESS = "";
export const AJOCIRCLE_ADDRESS = "";

// Circle's official test USDC on Arbitrum Sepolia (free from https://faucet.circle.com).
export const USDC_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
export const USDC_DECIMALS = 6;

export const EXPLORER = "https://arbitrum-sepolia.blockscout.com";
