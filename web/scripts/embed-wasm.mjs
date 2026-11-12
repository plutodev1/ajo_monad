// Write the compiled contract into web/src/contract-wasm.js so the page can
// deploy it and read its interface without a separate download.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wasmPath = process.argv[2];
if (!wasmPath) {
  console.error("usage: node scripts/embed-wasm.mjs <path/to/ajo_circle.wasm>");
  process.exit(1);
}
const wasm = readFileSync(wasmPath);
const out = fileURLToPath(new URL("../src/contract-wasm.js", import.meta.url));
writeFileSync(
  out,
  "// The compiled AjoCircle Soroban contract (contract/contracts/ajo-circle), base64.\n" +
    "// Rebuild with contract/build.sh; do not edit by hand.\n" +
    `export const AJOCIRCLE_WASM_B64 =\n  "${wasm.toString("base64")}";\n`
);
console.log(`Embedded ${wasm.length} bytes into ${out}`);
