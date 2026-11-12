#!/bin/sh
# Build the AjoCircle contract and embed it in the web app.
# Needs: Rust with the Soroban target (rustup target add wasm32v1-none) and Node.
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32v1-none -p ajo-circle
node ../web/scripts/embed-wasm.mjs target/wasm32v1-none/release/ajo_circle.wasm
