#!/usr/bin/env sh
# Build the component and serve a directory with wasmtime.
#   ./serve.sh [DIR] [ADDR]      e.g. ./serve.sh ~/Files 0.0.0.0:8080
# Extra configuration is passed through environment variables, e.g.
#   SF_ACCOUNTS=alice:secret ./serve.sh
set -e
DIR="${1:-./data}"
ADDR="${2:-127.0.0.1:8080}"
mkdir -p "$DIR"
cargo build --release
set -- serve -Scli -Sp3 -Wcomponent-model-async --addr "$ADDR" --dir "$DIR::/"
for v in SF_TITLE SF_ACCOUNTS SF_ACCESS SF_SECRET SF_MAX_UPLOAD; do
  eval "val=\${$v-}"
  [ -n "$val" ] && set -- "$@" --env "$v=$val"
done
exec wasmtime "$@" target/wasm32-wasip2/release/satellite_files.wasm
