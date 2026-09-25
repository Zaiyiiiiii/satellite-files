-- Build settings for the selected WASI version (`xmake f --wasi=p3|p2`).
function settings()
    if get_config("wasi") == "p2" then
        return {
            cargo = {"build", "--target", "wasm32-wasip2", "--release"},
            wasm = "target/wasm32-wasip2/release/satellite.wasm",
            wasmtime_flags = {},
        }
    end
    return {
        cargo = {"+nightly", "build", "-Zbuild-std=std,panic_abort", "--target", "wasm32-wasip3", "--release"},
        wasm = "target/wasm32-wasip3/release/satellite.wasm",
        wasmtime_flags = {"-Wcomponent-model-threading=y"},
    }
end
