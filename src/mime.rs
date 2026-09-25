pub fn from_name(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "txt" | "log" | "ini" | "conf" | "cfg" | "toml" | "yaml" | "yml" | "rs" | "py" | "go" | "c" | "h" | "cpp"
        | "hpp" | "java" | "kt" | "ts" | "tsx" | "jsx" | "sh" | "bat" | "ps1" | "sql" | "csv" | "tsv" | "srt"
        | "vtt" | "nfo" | "diff" | "patch" | "rb" | "php" | "lua" | "swift" | "zig" | "wit" | "vue" | "svelte" => {
            "text/plain; charset=utf-8"
        }
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" | "tgz" => "application/gzip",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

/// Types that are safe to render inline in the browser on our origin.
/// Anything able to run script (HTML, SVG, XML) is served as an attachment
/// or as plain text to avoid stored XSS.
pub fn inline_safe(ctype: &str) -> bool {
    let t = ctype.split(';').next().unwrap_or("");
    (t.starts_with("image/") && t != "image/svg+xml")
        || t.starts_with("audio/")
        || t.starts_with("video/")
        || t == "application/pdf"
        || t.starts_with("text/plain")
        || t.starts_with("text/markdown")
        || t == "application/json"
}
