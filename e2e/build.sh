#!/bin/sh
# Builds the e2e app: a debug build with the `e2e` feature (WebdriverIO's embedded driver)
# and the e2e config overlay, into its own target dir so dev builds don't recompile.
# Quiet unless it fails; the full output is in src-tauri/target/e2e/build.log.
cd "$(dirname "$0")/.." || exit 1
target="$PWD/src-tauri/target/e2e"
mkdir -p "$target"
if ! VITE_E2E=1 CARGO_TARGET_DIR="$target" npx tauri build --debug --no-bundle \
  --features e2e --config src-tauri/tauri.e2e.conf.json >"$target/build.log" 2>&1; then
  tail -30 "$target/build.log"
  echo "e2e: the build failed; the full log is src-tauri/target/e2e/build.log"
  exit 1
fi
