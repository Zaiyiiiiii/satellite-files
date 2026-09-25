# Prebuilt WASIp3 C runtime

rustup ships no C runtime for rustc's tier-3 `wasm32-wasip3` target, and building
one needs clang >= 23. These files make the default (WASIp3) build work with just
a nightly Rust toolchain:

| File | Source |
|---|---|
| `crt1-command.o`, `crt1-reactor.o`, `libc.a` | [wasi-libc](https://github.com/WebAssembly/wasi-libc) `06513b9ae0c1b14ca3010924939c007ed27628a1`, built for `wasm32-wasip3` with `ENABLE_COOP_THREADS=ON` by clang 23.1.3 |
| `libunwind.a` | copied from Rust's `wasm32-wasip2` target (a stub; Satellite builds with `panic=abort`) |

`xmake` copies them into
`<nightly sysroot>/lib/rustlib/wasm32-wasip3/lib/self-contained`, where rustc
looks for them, before building (see `xmake/modules/satellite/runtime.lua`).

To rebuild them from source, run `xmake sysroot` (needs clang >= 23, cmake and ninja).
