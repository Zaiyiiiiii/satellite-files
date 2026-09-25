-- Satellite Files build with xmake.
--
--   xmake                 build the WASIp3 component
--   xmake package         build dist/files.satellite for planet
--   xmake run             build and serve on http://127.0.0.1:8080
--   xmake e2e             run the end-to-end tests (needs curl and tar)
--   xmake sysroot ...     rebuild the WASIp3 C runtime in vendor/wasip3-sysroot (clang >= 23)
--   xmake f --addr=0.0.0.0:8080 --data=/srv/files --title="My Files" --accounts=alice:secret
--
-- The WASIp3 build uses rustc's tier-3 wasm32-wasip3 target: nightly Rust with
-- rust-src (installed automatically through rustup) plus the prebuilt C runtime in
-- vendor/wasip3-sysroot. Its cooperative-threads ABI needs wasmtime's
-- `-Wcomponent-model-threading=y`, which `xmake run` passes.

set_project("satellite-files")
set_version("0.1.0")

option("addr")
    set_default("127.0.0.1:8080")
    set_showmenu(true)
    set_description("Address for `xmake run` to listen on")
option_end()

option("data")
    set_default("data")
    set_showmenu(true)
    set_description("Directory `xmake run` serves")
option_end()

option("title")
    set_default("")
    set_showmenu(true)
    set_description("Site name shown in the UI (SATELLITE_TITLE, default: Satellite)")
option_end()

option("accounts")
    set_default("")
    set_showmenu(true)
    set_description("Accounts as user:password,user:password (SATELLITE_ACCOUNTS, default: none, everyone may read and write)")
option_end()

option("access")
    set_default("")
    set_showmenu(true)
    set_description("Access rules, e.g. \"/:*=r,@acct=rwmd\" (SATELLITE_ACCESS)")
option_end()

add_moduledirs("xmake/modules")

target("satellite")
    set_kind("phony")
    set_default(true)

    on_build(function (target)
        local build = import("satellite.wasi").settings()
        os.cd(os.projectdir())
        import("satellite.runtime").install()
        os.execv("cargo", build.cargo)
        cprint("${bright green}built${clear} %s", build.wasm)
    end)

    on_run(function (target)
        local build = import("satellite.wasi").settings()
        os.cd(os.projectdir())
        local addr = get_config("addr")
        local data = path.absolute(get_config("data"))
        os.mkdir(data)
        local args = {"serve", "-Scli", "-Sp3"}
        table.join2(args, build.wasmtime_flags)
        table.join2(args, {"--addr", addr})
        -- Options that are set become environment variables; the others fall
        -- back to the component's own defaults.
        for _, kv in ipairs({{"title", "SATELLITE_TITLE"}, {"accounts", "SATELLITE_ACCOUNTS"}, {"access", "SATELLITE_ACCESS"}}) do
            local value = get_config(kv[1])
            if value ~= nil and value ~= "" then
                table.join2(args, {"--env", kv[2] .. "=" .. value})
            end
        end
        for _, name in ipairs({"SATELLITE_SECRET", "SATELLITE_MAX_UPLOAD", "SATELLITE_DEBUG"}) do
            local value = os.getenv(name)
            if value ~= nil and value ~= "" then
                table.join2(args, {"--env", name .. "=" .. value})
            end
        end
        table.join2(args, {"--dir", data .. "::/mnt/data", build.wasm})
        cprint("${bright}Satellite Files${clear} on http://%s (serving %s)", addr, data)
        os.execv("wasmtime", args)
    end)

    -- `xmake package`: dist/files.satellite for planet —
    -- manifest.yaml at the root, the component under payload/server/.
    on_package(function (target)
        import("utils.archive")
        os.cd(os.projectdir())
        local build = import("satellite.wasi").settings()
        if not os.isfile(build.wasm) then
            raise("component not built at %s -- run `xmake` first", build.wasm)
        end

        local stagedir = path.join(os.tmpdir(), "satellite-files-stage")
        os.tryrm(stagedir)
        os.mkdir(path.join(stagedir, "payload", "server"))
        os.cp("manifest.yaml", path.join(stagedir, "manifest.yaml"))
        os.cp(build.wasm, path.join(stagedir, "payload", "server", "satellite.wasm"))

        -- xmake's archive picks the format from the extension (7z for
        -- anything unknown) and resolves a relative output against `curdir`:
        -- write an absolute *.zip, then rename. The inputs are an explicit
        -- list because older xmake (2.8) mishandles a single directory input
        -- for zip.
        os.mkdir("dist")
        local outfile = path.absolute("dist/files.satellite")
        local zipfile = outfile .. ".zip"
        os.tryrm(zipfile)
        archive.archive(zipfile, {"manifest.yaml", "payload/server/satellite.wasm"}, {curdir = stagedir})
        os.tryrm(outfile)
        os.mv(zipfile, outfile)
        os.rmdir(stagedir)
        cprint("${bright green}packaged${clear} %s", outfile)
    end)

    on_clean(function (target)
        os.cd(os.projectdir())
        os.execv("cargo", {"clean"})
        os.tryrm("dist")
    end)

task("e2e")
    set_category("action")
    on_run(function ()
        import("core.base.option")
        import("core.project.config")
        config.load()
        os.cd(os.projectdir())
        os.execv(os.programfile(), {"build", "satellite"})
        local build = import("satellite.wasi").settings()
        import("satellite.e2e")(build.wasm, build.wasmtime_flags, {
            keep = option.get("keep"),
            port = tonumber(option.get("port")),
        })
    end)
    set_menu {
        usage = "xmake e2e [options]",
        description = "Build, then run the end-to-end tests against the component",
        options = {
            {nil, "keep", "k", nil, "Keep the temporary directory with the test data."},
            {nil, "port", "kv", "18080", "Port for the test server."},
        }
    }

task("sysroot")
    set_category("plugin")
    on_run(function ()
        import("core.base.option")
        import("satellite.sysroot")({
            llvm = option.get("llvm"),
            llvm_src = option.get("llvm-src"),
            wasi_libc = option.get("wasi-libc"),
            workdir = option.get("workdir"),
        })
    end)
    set_menu {
        usage = "xmake sysroot --llvm=<prefix> --llvm-src=<llvm-project> --wasi-libc=<wasi-libc>",
        description = "Rebuild the WASIp3 C runtime in vendor/wasip3-sysroot from source (needs clang >= 23)",
        options = {
            {nil, "llvm", "kv", nil, "LLVM >= 23 install prefix with clang, llvm-ar and llvm-ranlib."},
            {nil, "llvm-src", "kv", nil, "llvm-project checkout (for compiler-rt builtins)."},
            {nil, "wasi-libc", "kv", nil, "wasi-libc checkout."},
            {nil, "workdir", "kv", nil, "Build directory (default: build/wasip3-sysroot)."},
        }
    }
