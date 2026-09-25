-- Rebuild the WASIp3 C runtime in vendor/wasip3-sysroot from source. Used by `xmake sysroot`.
--
--   1. compiler-rt builtins for wasm32 (wasi-libc links against them)
--   2. wasi-libc for wasm32-wasip3 with cooperative threads. rustc links wasip3
--      components with `--cooperative-threading`, which needs a libc built with the
--      libcall thread context ABI; that needs clang >= 23.
--   3. copy crt objects and libc.a into vendor/wasip3-sysroot and the nightly toolchain
--
-- Needs clang/llvm-ar/llvm-ranlib >= 23 with the WebAssembly backend, cmake and ninja.

import("lib.detect.find_program")

-- Builtins that need an OS, unwinding, trampolines, CPU detection or are Apple-only.
local SKIP = {
    emutls = true, enable_execute_stack = true, clear_cache = true, gcc_personality_v0 = true,
    os_version_check = true, trampoline_setup = true, cpu_model = true, eprintf = true,
    apple_versioning = true,
}

local function tool(llvm, name)
    local exe = path.join(llvm, "bin", name .. (is_host("windows") and ".exe" or ""))
    if not os.isfile(exe) then
        raise("%s not found; pass --llvm=<LLVM >= 23 install prefix>", exe)
    end
    return exe
end

function main(opt)
    local llvm = assert(opt.llvm, "--llvm is required")
    local llvm_src = assert(opt.llvm_src, "--llvm-src is required")
    local wasi_libc = assert(opt.wasi_libc, "--wasi-libc is required")
    local work = path.absolute(opt.workdir or path.join(os.projectdir(), "build", "wasip3-sysroot"))
    local clang = tool(llvm, "clang")
    local ar = tool(llvm, "llvm-ar")
    local ranlib = tool(llvm, "llvm-ranlib")
    for _, program in ipairs({"cmake", "ninja"}) do
        if not find_program(program) then
            raise("%s is required", program)
        end
    end

    -- 1. compiler-rt builtins: compile the target-independent sources.
    local objdir = path.join(work, "builtins", "obj")
    os.mkdir(objdir)
    local objects = {}
    for _, src in ipairs(os.files(path.join(llvm_src, "compiler-rt", "lib", "builtins", "*.c"))) do
        local name = path.basename(src)
        if not SKIP[name] and not name:startswith("atomic") then
            local obj = path.join(objdir, name .. ".o")
            -- Sources for other architectures (e.g. x87 long double) fail to compile; skip them.
            local compiled = try { function ()
                os.runv(clang, {"--target=wasm32-wasip1", "-O2", "-ffreestanding", "-fno-builtin", "-w", "-c", src, "-o", obj})
                return true
            end }
            if compiled then
                table.insert(objects, obj)
            end
        end
    end
    local builtins = path.join(work, "builtins", "libclang_rt.builtins-wasm32.a")
    os.tryrm(builtins)
    os.runv(ar, table.join({"crs", builtins}, objects))
    print("builtins: %d objects", #objects)

    -- 2. wasi-libc for wasm32-wasip3.
    local build = path.join(work, "wasi-libc-build")
    local sysroot = path.join(work, "sysroot")
    os.execv("cmake", {
        "-S", path.absolute(wasi_libc), "-B", build, "-G", "Ninja",
        "-DCMAKE_C_COMPILER=" .. clang,
        "-DCMAKE_AR=" .. ar,
        "-DCMAKE_RANLIB=" .. ranlib,
        "-DTARGET_TRIPLE=wasm32-wasip3",
        "-DBUILTINS_LIB=" .. builtins,
        "-DBUILD_TESTS=OFF",
        "-DBUILD_SHARED=OFF",
        "-DENABLE_COOP_THREADS=ON",
        "-DCMAKE_INSTALL_PREFIX=" .. sysroot,
    })
    os.execv("ninja", {"-C", build, "install"})

    -- 3. Update the vendored copy and install it into the toolchain.
    local runtime = import("files.runtime")
    local libdir = path.join(sysroot, "lib", "wasm32-wasip3")
    for _, name in ipairs({"crt1-command.o", "crt1-reactor.o", "libc.a"}) do
        os.cp(path.join(libdir, name), path.join(runtime.vendored_dir(), name))
    end
    runtime.install()
    cprint("${bright green}updated${clear} %s", runtime.vendored_dir())
end
