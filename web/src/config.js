// AjoBook on Stellar: where the book lives.
//
// `circles` is the contract ID (C…) of the AjoCircle contract the page opens
// by default. A `?book=C…` link opens a different book, and `?book=new` shows
// the one-time setup screen to start another one.
// Deploy a fresh book with `npm run deploy` (see scripts/deploy.mjs).
export const STELLAR = {
  // Stellar testnet, kept in test XLM (deployed 12 Nov 2026)
  circles: "CCZ44HGELOAE7WM6JE6LG6VA3KIYKKS6XFPZRYJDOWJWV42UPYRY6WPA",
};

// The same contract kept in test USDC: add
// ?book=CCR7PIGHBTXL7KKAOSHOWOYQJNJ35KLEUTGST3IQYQSSGRIARU2TBVNE to the link.
