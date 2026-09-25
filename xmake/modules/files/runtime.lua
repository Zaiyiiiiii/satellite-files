-- The prebuilt WASIp3 C runtime in vendor/wasip3-sysroot and where rustc looks for it.

-- Files rustc's wasm32-wasip3 target links from its `self-contained` directory.
FILES = {"crt1-command.o", "crt1-reactor.o", "libc.a", "libunwind.a"}

function vendored_dir()
    return path.join(os.projectdir(), "vendor", "wasip3-sysroot")
end

-- `<nightly sysroot>/lib/rustlib/wasm32-wasip3/lib/self-contained`
function toolchain_dir(toolchain)
    local sysroot = os.iorunv("rustc", {"+" .. toolchain, "--print", "sysroot"}):trim()
    return path.join(sysroot, "lib", "rustlib", "wasm32-wasip3", "lib", "self-contained")
end

local function same_file(a, b)
    return os.isfile(a) and os.isfile(b) and io.readfile(a, {encoding = "binary"}) == io.readfile(b, {encoding = "binary"})
end

-- Make sure the nightly toolchain with rust-src exists and holds the vendored runtime.
function install(toolchain)
    toolchain = toolchain or "nightly"
    local ok = try { function () os.iorunv("rustc", {"+" .. toolchain, "--version"}); return true end }
    if not ok then
        os.execv("rustup", {"toolchain", "install", toolchain, "--profile", "minimal", "--component", "rust-src"})
    end
    local sysroot = os.iorunv("rustc", {"+" .. toolchain, "--print", "sysroot"}):trim()
    if not os.isdir(path.join(sysroot, "lib", "rustlib", "src", "rust", "library")) then
        os.execv("rustup", {"component", "add", "rust-src", "--toolchain", toolchain})
    end
    local dest = toolchain_dir(toolchain)
    os.mkdir(dest)
    for _, name in ipairs(FILES) do
        local src = path.join(vendored_dir(), name)
        local dst = path.join(dest, name)
        if not same_file(src, dst) then
            os.cp(src, dst)
            print("installed %s into %s", name, dest)
        end
    end
end
