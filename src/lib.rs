//! Files — a clean, modern file server built as a WASIp3 HTTP component.

mod config;
mod fs;
mod http;
mod mime;
mod paths;
mod tar;

use std::cell::Cell;
use std::rc::Rc;

use serde_json::json;
use wasip3::http::types::{ErrorCode, Fields, Method, Request, Response};
use wasip3::wit_bindgen::{spawn_local, StreamReader, StreamWriter};
use wasip3::{wit_future, wit_stream};

use config::{Config, Perms};
use fs::Vfs;
use http::{pipe, Body, Resp, Status};
use paths::Target;

wasip3::http::service::export!(App);

struct App;

impl wasip3::exports::http::handler::Guest for App {
    async fn handle(req: Request) -> Result<Response, ErrorCode> {
        Ok(route(req).await.into_response())
    }
}

const SESSION_COOKIE: &str = "files_session";
const SESSION_TTL: i64 = 30 * 24 * 3600;
const SEARCH_LIMIT: usize = 500;
const WALK_LIMIT: usize = 20_000;

const INDEX_HTML: &str = include_str!("../web/index.html");
const APP_CSS: &str = include_str!("../web/app.css");
const APP_JS: &str = include_str!("../web/app.js");
const ICON_SVG: &str = include_str!("../web/icon.svg");

/// Everything a handler needs to know about the incoming request.
struct Ctx {
    cfg: Config,
    user: Option<String>,
    headers: Fields,
    now: i64,
}

impl Ctx {
    fn header(&self, name: &str) -> Option<String> {
        self.headers.get(name).into_iter().next().and_then(|v| String::from_utf8(v).ok())
    }

    fn perms(&self, segs: &[String]) -> Perms {
        self.cfg.perms(self.user.as_deref(), segs)
    }

    /// 401 for anonymous users (so the UI can offer to sign in), 403 otherwise.
    fn denied(&self) -> Resp {
        Resp::error(if self.user.is_none() { Status::UNAUTHORIZED } else { Status::FORBIDDEN })
    }
}

async fn route(req: Request) -> Resp {
    let method = req.get_method();
    let raw = req.get_path_with_query().unwrap_or_else(|| "/".into());
    let headers = req.get_headers();
    let cfg = Config::load();
    let now = wasip3::clocks::system_clock::now().seconds;
    let user = headers
        .get("cookie")
        .iter()
        .filter_map(|v| std::str::from_utf8(v).ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().split_once('='))
        .find(|(k, _)| *k == SESSION_COOKIE)
        .and_then(|(_, v)| cfg.verify_session(v, now));
    if cfg.debug {
        eprintln!("{method:?} {raw} user={user:?}");
    }
    let ctx = Ctx { cfg, user, headers, now };

    // State-changing requests must come from our own UI: browsers never attach
    // custom headers to cross-site form posts, so this blocks CSRF.
    let mutating = !matches!(method, Method::Get | Method::Head | Method::Options);
    if mutating && ctx.header("x-requested-with").is_none() {
        return Resp::error_msg(Status::FORBIDDEN, "Missing X-Requested-With header");
    }

    if let Some(rest) = raw.strip_prefix("/.files/") {
        let rest = rest.split('?').next().unwrap_or("");
        return internal(&ctx, &method, rest, req).await;
    }

    let Ok(t) = Target::parse(&raw) else {
        return Resp::error(Status::BAD_REQUEST);
    };
    let head = matches!(method, Method::Head);
    let resp = match method {
        Method::Get | Method::Head => get(&ctx, &t).await,
        Method::Put => upload(&ctx, &t, req).await,
        Method::Post if t.has("mkdir") => mkdir(&ctx, &t).await,
        Method::Post if t.has("mv") => rename(&ctx, &t).await,
        Method::Delete => delete(&ctx, &t).await,
        _ => Resp::error(Status::METHOD_NOT_ALLOWED),
    };
    if head {
        resp.head_only()
    } else {
        resp
    }
}

// ---------------------------------------------------------------------------
// Built-in endpoints under /.files/
// ---------------------------------------------------------------------------

fn asset_etag() -> String {
    // FNV-1a over all embedded assets, so browsers revalidate after upgrades.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in [INDEX_HTML, APP_CSS, APP_JS, ICON_SVG].iter().flat_map(|s| s.bytes()) {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    format!("\"{h:016x}\"")
}

fn static_asset(ctx: &Ctx, ctype: &str, body: &str) -> Resp {
    let etag = asset_etag();
    if ctx.header("if-none-match").as_deref() == Some(etag.as_str()) {
        return Resp::new(Status::NOT_MODIFIED).header("etag", etag);
    }
    Resp::new(Status::OK)
        .header("etag", etag)
        .header("cache-control", "public, max-age=3600, must-revalidate")
        .bytes(ctype, body.as_bytes())
}

fn session_cookie(value: &str, max_age: i64) -> String {
    format!("{SESSION_COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}")
}

async fn internal(ctx: &Ctx, method: &Method, what: &str, req: Request) -> Resp {
    match (method, what) {
        (Method::Get | Method::Head, "app.css") => static_asset(ctx, "text/css; charset=utf-8", APP_CSS),
        (Method::Get | Method::Head, "app.js") => static_asset(ctx, "text/javascript; charset=utf-8", APP_JS),
        (Method::Get | Method::Head, "icon.svg") => static_asset(ctx, "image/svg+xml", ICON_SVG),
        (Method::Get, "me") => Resp::json(
            Status::OK,
            &json!({ "user": ctx.user, "accounts": ctx.cfg.has_accounts(), "title": ctx.cfg.title }),
        ),
        (Method::Post, "login") => {
            let Ok(body) = read_small_body(req, 16 * 1024).await else {
                return Resp::error(Status::BAD_REQUEST);
            };
            let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
            let user = v["user"].as_str().unwrap_or("").trim();
            let pass = v["pass"].as_str().unwrap_or("");
            if !ctx.cfg.check_password(user, pass) {
                return Resp::error_msg(Status::UNAUTHORIZED, "Wrong user name or password");
            }
            let token = ctx.cfg.issue_session(user, ctx.now, SESSION_TTL);
            Resp::json(Status::OK, &json!({ "user": user }))
                .header("set-cookie", session_cookie(&token, SESSION_TTL))
        }
        (Method::Post, "logout") => {
            Resp::json(Status::OK, &json!({ "user": null })).header("set-cookie", session_cookie("", 0))
        }
        _ => Resp::error(Status::NOT_FOUND),
    }
}

async fn read_small_body(req: Request, max: usize) -> Result<Vec<u8>, ()> {
    let (res_tx, res_rx) = wit_future::new::<Result<(), ErrorCode>>(|| Ok(()));
    drop(res_tx);
    let (mut body, _trailers) = Request::consume_body(req, res_rx);
    let mut out = Vec::new();
    loop {
        let (r, buf) = body.read(Vec::with_capacity(8192)).await;
        out.extend(buf);
        if out.len() > max {
            return Err(());
        }
        if !matches!(r, wasip3::wit_bindgen::StreamResult::Complete(_)) {
            break;
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

fn perms_json(p: Perms) -> serde_json::Value {
    json!({ "read": p.read, "write": p.write, "move": p.move_, "delete": p.delete })
}

fn index_page(ctx: &Ctx) -> Resp {
    let title = html_escape(&ctx.cfg.title);
    let html = INDEX_HTML.replace("{{TITLE}}", &title).replace("{{V}}", asset_etag().trim_matches('"'));
    Resp::new(Status::OK).header("cache-control", "no-cache").bytes("text/html; charset=utf-8", html)
}

async fn get(ctx: &Ctx, t: &Target) -> Resp {
    let perms = ctx.perms(&t.segs);
    if !perms.any() {
        // Directories still render the app shell so the user can sign in.
        return if t.has("ls") || t.has("find") || t.has("tar") || !t.trailing_slash && !t.segs.is_empty() {
            ctx.denied()
        } else {
            index_page(ctx)
        };
    }
    let vfs = Vfs::open();
    let meta = match vfs.stat(&t.segs).await {
        Ok(m) => m,
        Err(s) if s == Status::NOT_FOUND && t.trailing_slash && !t.has("ls") => return index_page(ctx),
        Err(s) => return Resp::error(s),
    };

    if !meta.dir {
        if !perms.read {
            return ctx.denied();
        }
        return serve_file(ctx, &vfs, t).await;
    }
    if !t.trailing_slash && !t.segs.is_empty() {
        let q = t.query.iter().map(|(k, v)| format!("{}={}", paths::percent_encode(k), paths::percent_encode(v)));
        let q: Vec<String> = q.collect();
        let loc = paths::to_url(&t.segs, true);
        return Resp::redirect(&if q.is_empty() { loc } else { format!("{loc}?{}", q.join("&")) });
    }
    if t.has("ls") {
        let mut entries = Vec::new();
        if perms.read {
            match vfs.list(&t.segs).await {
                Ok(list) => {
                    for e in list {
                        let mut child = t.segs.clone();
                        child.push(e.name.clone());
                        // Hide entries the user can't do anything with, and our temp files.
                        if !ctx.perms(&child).any() || e.name.ends_with(".filespart") {
                            continue;
                        }
                        entries.push(json!({ "name": e.name, "dir": e.dir, "size": e.size, "mtime": e.mtime }));
                    }
                }
                Err(s) => return Resp::error(s),
            }
        }
        return Resp::json(
            Status::OK,
            &json!({ "path": paths::to_url(&t.segs, true), "perms": perms_json(perms), "entries": entries }),
        );
    }
    if let Some(q) = t.q("find") {
        if !perms.read {
            return ctx.denied();
        }
        return search(ctx, &vfs, &t.segs, q).await;
    }
    if t.has("tar") {
        if !perms.read {
            return ctx.denied();
        }
        return tar_download(ctx, vfs, t.segs.clone(), t.q("files"));
    }
    index_page(ctx)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn content_disposition(kind: &str, name: &str) -> String {
    let ascii: String = name.chars().map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' }).collect();
    format!("{kind}; filename=\"{ascii}\"; filename*=UTF-8''{}", paths::percent_encode(name))
}

fn parse_range(h: &str, size: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = h.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None; // multiple ranges: just send the whole file
    }
    let (a, b) = spec.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    let r = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return Some(Err(()));
        }
        (size.saturating_sub(n), size.saturating_sub(1))
    } else {
        let start: u64 = a.parse().ok()?;
        let end: u64 = if b.is_empty() { size.saturating_sub(1) } else { b.parse::<u64>().ok()?.min(size.saturating_sub(1)) };
        (start, end)
    };
    if size == 0 || r.0 > r.1 || r.0 >= size {
        return Some(Err(()));
    }
    Some(Ok(r))
}

async fn serve_file(ctx: &Ctx, vfs: &Vfs, t: &Target) -> Resp {
    let (file, meta) = match vfs.open_file(&t.segs).await {
        Ok(v) => v,
        Err(s) => return Resp::error(s),
    };
    let name = t.segs.last().cloned().unwrap_or_default();
    let etag = format!("\"{:x}-{:x}\"", meta.size, meta.mtime);
    let mut ctype = mime::from_name(&name).to_string();
    let mut disposition = "inline";
    if t.has("dl") {
        disposition = "attachment";
    } else if !mime::inline_safe(&ctype) {
        if ctype.starts_with("text/") || ctype.contains("xml") || ctype.contains("javascript") {
            // Show markup/code as source instead of executing it on our origin.
            ctype = "text/plain; charset=utf-8".into();
        } else {
            disposition = "attachment";
        }
    }

    let mut resp = Resp::new(Status::OK)
        .header("etag", etag.clone())
        .header("last-modified", http_date(meta.mtime))
        .header("cache-control", "no-cache")
        .header("accept-ranges", "bytes")
        .header("x-content-type-options", "nosniff")
        .header("content-disposition", content_disposition(disposition, &name));
    if ctype != "application/pdf" {
        // Browsers' built-in PDF viewers don't run inside a sandboxed document.
        resp = resp.header(
            "content-security-policy",
            "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
        );
    }
    resp = resp.header("content-type", ctype);

    if ctx.header("if-none-match").as_deref() == Some(etag.as_str()) {
        resp.status = Status::NOT_MODIFIED;
        return resp;
    }

    let (start, len) = match ctx.header("range").and_then(|h| parse_range(&h, meta.size)) {
        None => (0, meta.size),
        Some(Err(())) => {
            return Resp::new(Status::RANGE_NOT_SATISFIABLE).header("content-range", format!("bytes */{}", meta.size))
        }
        Some(Ok((a, b))) => {
            resp.status = Status::PARTIAL;
            resp = resp.header("content-range", format!("bytes {a}-{b}/{}", meta.size));
            (a, b - a + 1)
        }
    };
    resp = resp.header("content-length", len.to_string());

    let (mut tx, rx) = wit_stream::new::<u8>();
    spawn_local(async move {
        let (mut src, _done) = file.read_via_stream(start);
        let _ = pipe(&mut src, &mut tx, Some(len), false).await;
        drop(src);
        drop(file);
    });
    resp.body = Body::Stream(rx);
    resp
}

/// Recursively walks the tree below `root`, yielding readable entries.
/// Uses an explicit stack so deep trees don't need recursive futures.
async fn walk(ctx: &Ctx, vfs: &Vfs, root: &[String], mut visit: impl FnMut(&[String], &fs::Entry) -> bool) {
    let mut stack = vec![root.to_vec()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        seen += 1;
        if seen > WALK_LIMIT {
            return;
        }
        let Ok(mut list) = vfs.list(&dir).await else { continue };
        list.sort_by(|a, b| b.name.cmp(&a.name));
        for e in list {
            let mut p = dir.clone();
            p.push(e.name.clone());
            if !ctx.perms(&p).read || e.name.ends_with(".filespart") {
                continue;
            }
            if !visit(&p, &e) {
                return;
            }
            if e.dir {
                stack.push(p);
            }
        }
    }
}

async fn search(ctx: &Ctx, vfs: &Vfs, root: &[String], q: &str) -> Resp {
    let terms: Vec<String> = q.to_lowercase().split_whitespace().map(String::from).collect();
    if terms.is_empty() {
        return Resp::json(Status::OK, &json!({ "results": [], "truncated": false }));
    }
    let mut results = Vec::new();
    let mut truncated = false;
    walk(ctx, vfs, root, |p, e| {
        let name = e.name.to_lowercase();
        if terms.iter().all(|t| name.contains(t.as_str())) {
            if results.len() >= SEARCH_LIMIT {
                truncated = true;
                return false;
            }
            results.push(json!({
                "path": paths::to_url(p, e.dir),
                "name": e.name, "dir": e.dir, "size": e.size, "mtime": e.mtime,
            }));
        }
        true
    })
    .await;
    Resp::json(Status::OK, &json!({ "results": results, "truncated": truncated }))
}

fn tar_download(ctx: &Ctx, vfs: Vfs, root: Vec<String>, only: Option<&str>) -> Resp {
    let base = root.last().cloned().unwrap_or_else(|| ctx.cfg.title.clone());
    // Optional subset of direct children, as a `/`-separated list of names.
    let only: Option<Vec<String>> = only.map(|s| s.split('/').filter(|n| paths::valid_name(n)).map(String::from).collect());
    let ctx2 = Ctx { cfg: Config::load(), user: ctx.user.clone(), headers: Fields::new(), now: ctx.now };
    let (mut tx, rx) = wit_stream::new::<u8>();
    let prefix = base.clone();
    spawn_local(async move {
        let _ = write_tar(&ctx2, &vfs, &root, &prefix, only.as_deref(), &mut tx).await;
    });
    Resp {
        status: Status::OK,
        headers: vec![
            ("content-type".into(), b"application/x-tar".to_vec()),
            ("content-disposition".into(), content_disposition("attachment", &format!("{base}.tar")).into_bytes()),
            ("cache-control".into(), b"no-store".to_vec()),
        ],
        body: Body::Stream(rx),
    }
}

async fn write_tar(
    ctx: &Ctx,
    vfs: &Vfs,
    root: &[String],
    prefix: &str,
    only: Option<&[String]>,
    tx: &mut StreamWriter<u8>,
) -> Result<(), ()> {
    async fn put(tx: &mut StreamWriter<u8>, b: Vec<u8>) -> Result<(), ()> {
        if tx.write_all(b).await.is_empty() {
            Ok(())
        } else {
            Err(())
        }
    }
    // Collect the listing first; the walk borrows `ctx`/`vfs` immutably.
    let mut items: Vec<(Vec<String>, fs::Entry)> = Vec::new();
    walk(ctx, vfs, root, |p, e| {
        let top = &p[root.len()];
        if only.is_none_or(|o| o.contains(top)) {
            items.push((p.to_vec(), e.clone()));
        }
        true
    })
    .await;
    put(tx, tar::header(&format!("{prefix}/"), 0, 0, true)).await?;
    for (p, e) in items {
        let rel = format!("{prefix}/{}", p[root.len()..].join("/"));
        if e.dir {
            put(tx, tar::header(&format!("{rel}/"), 0, e.mtime, true)).await?;
            continue;
        }
        let Ok((file, meta)) = vfs.open_file(&p).await else { continue };
        put(tx, tar::header(&rel, meta.size, meta.mtime, false)).await?;
        let (mut src, _done) = file.read_via_stream(0);
        pipe(&mut src, tx, Some(meta.size), true).await?;
        let pad = tar::padding(meta.size);
        if pad > 0 {
            put(tx, vec![0u8; pad]).await?;
        }
    }
    put(tx, tar::trailer()).await
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

fn parent(segs: &[String]) -> &[String] {
    &segs[..segs.len().saturating_sub(1)]
}

async fn upload(ctx: &Ctx, t: &Target, req: Request) -> Resp {
    let Some(name) = t.segs.last().cloned() else {
        return Resp::error(Status::BAD_REQUEST);
    };
    if name.ends_with(".filespart") {
        return Resp::error(Status::BAD_REQUEST);
    }
    let perms = ctx.perms(&t.segs);
    if !perms.write {
        return ctx.denied();
    }
    let max = ctx.cfg.max_upload;
    let declared: Option<u64> = ctx.header("content-length").and_then(|v| v.trim().parse().ok());
    if max > 0 && declared.is_some_and(|n| n > max) {
        return Resp::error(Status::TOO_LARGE);
    }

    let vfs = Vfs::open();
    let dir_segs = parent(&t.segs).to_vec();
    if let Err(s) = vfs.mkdir_all(&dir_segs).await {
        return Resp::error(s);
    }
    let overwrite = t.has("overwrite");
    match vfs.stat(&t.segs).await {
        Ok(m) if m.dir => return Resp::error(Status::CONFLICT),
        Ok(_) if !overwrite => return Resp::error_msg(Status::CONFLICT, "A file with this name already exists"),
        Ok(_) if !perms.delete => return Resp::error_msg(Status::FORBIDDEN, "Replacing files requires delete permission"),
        _ => {}
    }

    let dir = match vfs.open_dir(&dir_segs).await {
        Ok(d) => d,
        Err(s) => return Resp::error(s),
    };
    let rand = wasip3::random::random::get_random_u64();
    let tmp = format!(".{name}.{rand:x}.filespart");
    use wasip3::filesystem::types::{DescriptorFlags, OpenFlags, PathFlags};
    let file = match dir
        .open_at(PathFlags::empty(), tmp.clone(), OpenFlags::CREATE | OpenFlags::EXCLUSIVE, DescriptorFlags::WRITE)
        .await
    {
        Ok(f) => f,
        Err(e) => return Resp::error(fs::err_status(&e)),
    };

    let (res_tx, res_rx) = wit_future::new::<Result<(), ErrorCode>>(|| Ok(()));
    drop(res_tx);
    let (body, trailers) = Request::consume_body(req, res_rx);

    // Pump request body -> file, counting bytes and enforcing the size limit.
    let (tx, rx) = wit_stream::new::<u8>();
    let copied = Rc::new(Cell::new(0u64));
    let copied2 = copied.clone();
    spawn_local(async move {
        let mut body: StreamReader<u8> = body;
        let mut tx = tx;
        let limit = if max > 0 { Some(max + 1) } else { None };
        let n = pipe(&mut body, &mut tx, limit, false).await.unwrap_or(0);
        copied2.set(n);
    });
    let write_res = file.write_via_stream(rx, 0).await;
    let body_ok = trailers.await.is_ok();
    let n = copied.get();
    drop(file);

    let failed = if write_res.is_err() {
        Some(write_res.as_ref().map_err(fs::err_status).unwrap_err())
    } else if max > 0 && n > max {
        Some(Status::TOO_LARGE)
    } else if !body_ok || declared.is_some_and(|d| d != n) {
        Some(Status::BAD_REQUEST)
    } else {
        None
    };
    if let Some(s) = failed {
        let _ = dir.unlink_file_at(tmp).await;
        return Resp::error(s);
    }
    if let Err(e) = dir.rename_at(tmp.clone(), &dir, name.clone()).await {
        let _ = dir.unlink_file_at(tmp).await;
        return Resp::error(fs::err_status(&e));
    }
    Resp::json(Status::CREATED, &json!({ "name": name, "size": n }))
}

async fn mkdir(ctx: &Ctx, t: &Target) -> Resp {
    if t.segs.is_empty() {
        return Resp::error(Status::BAD_REQUEST);
    }
    if !ctx.perms(&t.segs).write {
        return ctx.denied();
    }
    let vfs = Vfs::open();
    if vfs.stat(&t.segs).await.is_ok() {
        return Resp::error_msg(Status::CONFLICT, "Something with this name already exists");
    }
    match vfs.mkdir_all(&t.segs).await {
        Ok(()) => Resp::json(Status::CREATED, &json!({ "path": paths::to_url(&t.segs, true) })),
        Err(s) => Resp::error(s),
    }
}

async fn rename(ctx: &Ctx, t: &Target) -> Resp {
    let Some(dest) = t.q("mv").and_then(|d| paths::segments(d).ok()) else {
        return Resp::error(Status::BAD_REQUEST);
    };
    if t.segs.is_empty() || dest.is_empty() {
        return Resp::error(Status::BAD_REQUEST);
    }
    if dest == t.segs {
        return Resp::json(Status::OK, &json!({ "path": paths::to_url(&dest, false) }));
    }
    if dest.starts_with(&t.segs) {
        return Resp::error_msg(Status::BAD_REQUEST, "A folder can't be moved into itself");
    }
    if !ctx.perms(&t.segs).move_ || !ctx.perms(&dest).write {
        return ctx.denied();
    }
    let vfs = Vfs::open();
    if vfs.stat(&dest).await.is_ok() {
        return Resp::error_msg(Status::CONFLICT, "Something with this name already exists at the destination");
    }
    if let Err(s) = vfs.mkdir_all(parent(&dest)).await {
        return Resp::error(s);
    }
    match vfs.rename(&t.segs, &dest).await {
        Ok(()) => Resp::json(Status::OK, &json!({ "path": paths::to_url(&dest, false) })),
        Err(s) => Resp::error(s),
    }
}

async fn delete(ctx: &Ctx, t: &Target) -> Resp {
    if t.segs.is_empty() {
        return Resp::error(Status::FORBIDDEN);
    }
    if !ctx.perms(&t.segs).delete {
        return ctx.denied();
    }
    match Vfs::open().remove(&t.segs).await {
        Ok(()) => Resp::new(Status::NO_CONTENT),
        Err(s) => Resp::error(s),
    }
}

// ---------------------------------------------------------------------------

/// Formats a unix timestamp as an RFC 7231 date.
fn http_date(ts: i64) -> String {
    let days = ts.div_euclid(86400);
    let secs = ts.rem_euclid(86400);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let wd = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][days.rem_euclid(7) as usize];
    let mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m - 1) as usize];
    format!("{wd}, {d:02} {mon} {y} {:02}:{:02}:{:02} GMT", secs / 3600, secs % 3600 / 60, secs % 60)
}
