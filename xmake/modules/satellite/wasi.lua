-- Build settings for the WASIp3 component (rustc's tier-3 wasm32-wasip3 target).
function settings()
    return {
        cargo = {"+nightly", "build", "-Zbuild-std=std,panic_abort", "--target", "wasm32-wasip3", "--release"},
        wasm = "target/wasm32-wasip3/release/satellite.wasm",
        wasmtime_flags = {"-Wcomponent-model-threading=y"},
    }
end
