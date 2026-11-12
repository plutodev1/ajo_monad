// AjoBook on Stellar: where the book lives.
//
// `circles` is the contract ID (C…) of the deployed AjoCircle contract that
// the page opens by default. A `?book=C…` link opens a different book, and
// `?book=new` shows the one-time setup screen to start another one.
// Deploy a fresh book with `npm run deploy:stellar` (see scripts/deploy.mjs).
export const STELLAR = {
  // Stellar testnet, kept in test XLM (deployed 12 Nov 2026)
  circles: "CCQW4QKWXNV7Q2PQJAYUQUXKJGQCYNA2XUN67HDZTZYBJ4WZHURMSGSO",
};

// The same contract, kept in test USDC:
// https://plutodev1.github.io/ajo_monad/stellar.html?book=CAZUKYSUKKIRWKDDAANZK4IXHYBDA56HNNJUOXBBXC5NRI3FSL5CHAAA
