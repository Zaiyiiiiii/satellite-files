-- End-to-end test: runs the component under `wasmtime serve` with a temporary data
-- directory and drives it with curl. Used by `xmake e2e`.
--
-- Needs `wasmtime`, `curl` and `tar` on PATH (Windows 10+ ships curl and tar).

import("core.base.process")

local B, TMP, DATA, JAR
local passed = 0
local server

local function log_tail()
    local log = path.join(TMP, "serve.log")
    if os.isfile(log) then
        local lines = io.readfile(log):split("\n")
        return table.concat(lines, "\n", math.max(1, #lines - 30))
    end
    return ""
end

local function fail(message)
    raise("FAIL: %s\n--- server log ---\n%s", message, log_tail())
end

local function ok(message)
    passed = passed + 1
    cprint("${green}ok${clear} - %s", message)
end

local function check(cond, message)
    if not cond then
        fail(message)
    end
end

-- `web(method, path, ...)` returns the status code; the body is saved for `body()`.
-- Requests from the UI carry `X-Requested-With`; pass `{raw = true}` first to omit it,
-- and `{anon = true}` to send no session cookie.
local function web(method, url_path, ...)
    local extra = {...}
    local opt = {}
    if type(extra[1]) == "table" then
        opt = table.remove(extra, 1)
    end
    local args = {"-s", "-o", path.join(TMP, "body"), "-w", "%{http_code}", "-X", method}
    if not opt.raw then
        table.join2(args, {"-H", "X-Requested-With: e2e"})
    end
    if not opt.anon then
        table.join2(args, {"-b", JAR, "-c", JAR})
    end
    table.join2(args, extra)
    table.insert(args, B .. url_path)
    return (os.iorunv("curl", args)):trim()
end

local function body()
    return io.readfile(path.join(TMP, "body"), {encoding = "binary"}) or ""
end

local function body_has(text)
    check(body():find(text, 1, true), "response body lacks '" .. text .. "'")
end

local function headers(url_path, ...)
    local args = {"-s", "-o", os.nuldev(), "-D", "-", "-b", JAR}
    table.join2(args, {...})
    table.insert(args, B .. url_path)
    return (os.iorunv("curl", args)):lower()
end

local function write_file(file, data)
    os.mkdir(path.directory(file))
    io.writefile(file, data, {encoding = "binary"})
end

-- Deterministic pseudo-random bytes, so the payload doesn't compress to nothing.
local function payload(size, seed)
    local parts = {}
    local x = seed
    local chunk = {}
    for i = 1, 4096 do
        x = (x * 1103515245 + 12345) % 2147483648
        chunk[i] = string.char(x % 256)
    end
    chunk = table.concat(chunk)
    for i = 1, math.ceil(size / #chunk) do
        parts[i] = chunk .. tostring(i)
    end
    return table.concat(parts):sub(1, size)
end

local function start_server(wasm, flags, port)
    local args = {"serve", "-Scli", "-Sp3"}
    table.join2(args, flags)
    table.join2(args, {
        "--addr", "127.0.0.1:" .. port,
        "--env", "SATELLITE_TITLE=E2E Files",
        "--env", "SATELLITE_ACCOUNTS=alice:secret,bob:hunter2",
        "--env", "SATELLITE_ACCESS=/:*=r,@acct=rw,alice=rwmd;/inbox:*=w,alice=rwmd;/private:alice=rwmd",
        "--env", "SATELLITE_MAX_UPLOAD=8",
        "--dir", DATA .. "::/mnt/data",
        wasm,
    })
    local logfile = path.join(TMP, "serve.log")
    server = process.openv("wasmtime", args, {outpath = logfile, errpath = logfile})
    for _ = 1, 240 do
        local up = try { function () return os.iorunv("curl", {"-s", "-o", os.nuldev(), "-w", "%{http_code}", B .. "/"}) == "200" end }
        if up then
            return
        end
        os.sleep(500)
    end
    fail("server did not start")
end

local function run_checks()
    -- --- web UI and static assets ----------------------------------------------------
    check(web("GET", "/") == "200", "GET /"); body_has("<title>E2E Files</title>"); body_has("/.sf/app.js")
    check(web("GET", "/.sf/app.js") == "200", "app.js")
    check(web("GET", "/.sf/app.css") == "200", "app.css")
    local etag = headers("/.sf/app.js"):match("etag: (%S+)")
    check(etag ~= nil, "assets carry an etag")
    check(web("GET", "/.sf/app.js", "-H", "If-None-Match: " .. etag) == "304", "asset revalidation")
    ok("web UI and static assets")

    -- --- anonymous access and sign-in -----------------------------------------------------
    write_file(path.join(DATA, "hello.txt"), "hello world\n")
    check(web("GET", "/?ls", {anon = true}) == "200", "anonymous listing")
    body_has('"name":"hello.txt"'); body_has('"read":true'); body_has('"write":false')
    local small = path.join(TMP, "small.txt")
    write_file(small, "small\n")
    check(web("PUT", "/x.txt", {anon = true}, "--data-binary", "@" .. small) == "401", "anonymous upload must be refused")
    check(web("POST", "/.sf/login", {raw = true}, "-d", '{"user":"alice","pass":"secret"}') == "403", "mutations need X-Requested-With")
    check(web("POST", "/.sf/login", "-d", '{"user":"alice","pass":"wrong"}') == "401", "wrong password")
    check(web("POST", "/.sf/login", "-d", '{"user":"alice","pass":"secret"}') == "200", "sign in")
    check(web("GET", "/.sf/me") == "200", "me"); body_has('"user":"alice"')
    check(web("GET", "/.sf/me", {anon = true}, "-b", "sf_session=616c696365.9999999999.00") == "200", "forged session")
    body_has('"user":null')
    ok("anonymous access, sign-in and forged sessions")

    -- --- upload and download ------------------------------------------------------------
    local big = path.join(TMP, "big.bin")
    local data = payload(3 * 1024 * 1024 + 123, 7)
    write_file(big, data)
    check(web("PUT", "/docs/deep/big.bin", "--data-binary", "@" .. big) == "201", "upload into new folders")
    check(io.readfile(path.join(DATA, "docs", "deep", "big.bin"), {encoding = "binary"}) == data, "uploaded bytes on disk")
    check(web("GET", "/docs/deep/big.bin") == "200", "download"); check(body() == data, "downloaded bytes")
    check(web("GET", "/docs/deep/big.bin", "-H", "Range: bytes=100-199") == "206", "range request")
    check(body() == data:sub(101, 200), "range bytes")
    check(web("GET", "/docs/deep/big.bin", "-H", "Range: bytes=-10") == "206", "suffix range"); check(body() == data:sub(-10), "suffix range bytes")
    check(web("GET", "/docs/deep/big.bin", "-H", "Range: bytes=99999999-") == "416", "unsatisfiable range")
    local h = headers("/docs/deep/big.bin", "-I")
    check(h:find("content-length: " .. #data, 1, true), "HEAD content-length")
    check(h:find("accept-ranges: bytes", 1, true), "accept-ranges")
    check(web("PUT", "/docs/deep/big.bin", "--data-binary", "@" .. small) == "409", "no silent overwrite")
    check(web("PUT", "/docs/deep/big.bin?overwrite", "--data-binary", "@" .. small) == "201", "overwrite")
    check(io.readfile(path.join(DATA, "docs", "deep", "big.bin")) == "small\n", "overwritten content")
    ok("upload, download, ranges and overwrite")

    -- Permissions on overwrite, size limit, unicode names, temp files.
    check(web("POST", "/.sf/login", "-d", '{"user":"bob","pass":"hunter2"}') == "200", "sign in as bob")
    check(web("PUT", "/docs/bob.txt", "--data-binary", "@" .. small) == "201", "bob may upload")
    check(web("PUT", "/docs/bob.txt?overwrite", "--data-binary", "@" .. small) == "403", "overwrite needs delete permission")
    check(web("DELETE", "/docs/bob.txt") == "403", "bob may not delete")
    check(web("GET", "/private/?ls") == "403", "bob may not list /private")
    check(web("POST", "/.sf/login", "-d", '{"user":"alice","pass":"secret"}') == "200", "sign in as alice again")
    local huge = path.join(TMP, "huge.bin")
    write_file(huge, payload(9 * 1024 * 1024, 3))
    check(web("PUT", "/docs/huge.bin", "--data-binary", "@" .. huge) == "413", "upload limit")
    check(web("PUT", "/%E4%B8%AD%E6%96%87%20%E7%9B%AE%E5%BD%95/%E7%AC%94%E8%AE%B0.txt", "--data-binary", "@" .. small) == "201", "unicode upload")
    check(os.isfile(path.join(DATA, "中文 目录", "笔记.txt")), "unicode file on disk")
    check(web("PUT", "/docs/x.sfpart", "--data-binary", "@" .. small) == "400", "reserved temp suffix")
    local leftovers = os.files(path.join(DATA, "docs", "**.sfpart"))
    check(#leftovers == 0, "no temp files left behind")
    ok("permissions, upload limit, unicode names and temp files")

    -- --- folders, rename, move ------------------------------------------------------------
    check(web("POST", "/music?mkdir") == "201", "mkdir")
    check(web("POST", "/music?mkdir") == "409", "mkdir twice")
    check(web("POST", "/hello.txt?mv=/music/hi.txt") == "200", "move file")
    check(os.isfile(path.join(DATA, "music", "hi.txt")) and not os.isfile(path.join(DATA, "hello.txt")), "moved on disk")
    check(web("POST", "/music?mv=/music/sub/music") == "400", "folder into itself")
    check(web("POST", "/docs/deep/big.bin?mv=/music/hi.txt") == "409", "move onto existing")
    check(web("POST", "/music?mv=/songs") == "200", "rename folder")
    check(os.isdir(path.join(DATA, "songs")), "renamed folder")
    ok("folders, rename and move")

    -- --- search and tar ---------------------------------------------------------------------
    check(web("GET", "/?find=big") == "200", "search"); body_has('"path":"/docs/deep/big.bin"')
    check(web("GET", "/?find=%E7%AC%94%E8%AE%B0") == "200", "unicode search"); body_has("笔记.txt")
    local tarfile = path.join(TMP, "docs.tar")
    os.iorunv("curl", {"-s", "-b", JAR, "-o", tarfile, B .. "/docs/?tar"})
    local listing = os.iorunv("tar", {"-tf", tarfile})
    check(listing:find("docs/deep/big.bin", 1, true), "tar contents")
    os.iorunv("curl", {"-s", "-b", JAR, "-o", tarfile, B .. "/?tar&files=songs"})
    listing = os.iorunv("tar", {"-tf", tarfile})
    check(listing:find("songs/hi.txt", 1, true) and not listing:find("docs/", 1, true), "tar of selected entries")
    local out = path.join(TMP, "untar")
    os.mkdir(out)
    os.iorunv("curl", {"-s", "-b", JAR, "-o", tarfile, B .. "/docs/?tar"})
    os.iorunv("tar", {"-xf", tarfile, "-C", out})
    check(io.readfile(path.join(out, "docs", "deep", "big.bin")) == "small\n", "extracted tar")
    ok("search and tar downloads")

    -- --- upload-only inbox -----------------------------------------------------------------
    check(web("PUT", "/inbox/drop.txt", {anon = true}, "--data-binary", "@" .. small) == "201", "anonymous drop")
    check(web("GET", "/inbox/?ls", {anon = true}) == "200", "inbox listing"); body_has('"entries":[]'); body_has('"read":false')
    check(web("GET", "/inbox/drop.txt", {anon = true}) == "401", "anonymous read of inbox file")
    check(web("GET", "/inbox/?ls") == "200", "alice lists inbox"); body_has("drop.txt")
    ok("upload-only inbox")

    -- --- safety -----------------------------------------------------------------------------
    check(web("GET", "/%2e%2e/%2e%2e/etc/passwd", "--path-as-is") == "400", "path traversal")
    check(web("GET", "/a%5Cb") == "400", "backslash in name")
    local page = path.join(TMP, "evil.html")
    write_file(page, "<script>alert(1)</script>")
    check(web("PUT", "/evil.html", "--data-binary", "@" .. page) == "201", "upload html")
    h = headers("/evil.html")
    check(h:find("content-type: text/plain", 1, true), "html served as text")
    check(h:find("content-security-policy: sandbox", 1, true), "sandbox csp")
    check(h:find("x-content-type-options: nosniff", 1, true), "nosniff")
    ok("path validation and untrusted content")

    -- --- concurrent requests ----------------------------------------------------------------
    local args = {"-s", "--parallel", "--parallel-max", "16", "-b", JAR, "-o", os.nuldev(), "-w", "%{http_code}\n"}
    for i = 1, 24 do
        table.insert(args, B .. (i % 3 == 0 and "/docs/deep/big.bin" or i % 3 == 1 and "/?ls" or "/?find=txt"))
        if i < 24 then
            table.join2(args, {"-o", os.nuldev()})
        end
    end
    local codes = os.iorunv("curl", args)
    local n = 0
    for code in codes:gmatch("%d+") do
        check(code == "200", "concurrent request returned " .. code)
        n = n + 1
    end
    check(n == 24, "all concurrent requests answered")
    check(web("GET", "/?ls") == "200", "server alive after concurrent requests")
    ok("concurrent requests")

    -- --- delete and sign-out ----------------------------------------------------------------
    check(web("DELETE", "/songs", {anon = true}) == "401", "anonymous delete")
    check(web("DELETE", "/songs") == "204", "delete folder")
    check(not os.isdir(path.join(DATA, "songs")), "folder gone")
    check(web("GET", "/songs/hi.txt") == "404", "deleted file 404")
    check(web("DELETE", "/") == "403", "root cannot be deleted")
    check(web("POST", "/.sf/logout") == "200", "sign out")
    check(web("GET", "/.sf/me") == "200", "me after sign out"); body_has('"user":null')
    ok("delete and sign out")
end

function main(wasm, flags, opt)
    opt = opt or {}
    local port = opt.port or 18080
    B = "http://127.0.0.1:" .. port
    TMP = path.join(os.tmpdir(), "satellite-files-e2e-" .. os.time() .. "-" .. math.random(100000))
    DATA = path.join(TMP, "data")
    JAR = path.join(TMP, "cookies")
    os.mkdir(DATA)

    local failure
    try {
        function ()
            start_server(path.absolute(wasm), flags or {}, port)
            ok("server started")
            run_checks()
        end,
        catch { function (errors) failure = tostring(errors) end }
    }
    if server then
        server:kill()
        server:wait()
        server:close()
    end
    if opt.keep then
        print("kept %s", TMP)
    else
        os.tryrm(TMP)
    end
    if failure then
        raise("%s", failure)
    end
    cprint("${bright green}all %d checks passed", passed)
end
