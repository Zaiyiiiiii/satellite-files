//! URL path parsing and validation.

/// Decodes `%XX` escapes. Returns `None` on malformed input or invalid UTF-8.
pub fn percent_decode(s: &str, plus_as_space: bool) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let h = s.get(i + 1..i + 3)?;
                out.push(u8::from_str_radix(h, 16).ok()?);
                i += 3;
            }
            b'+' if plus_as_space => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Encodes a string for use inside a URL path segment or query value.
pub fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Checks that a single file name is safe to use.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 255
        && !name.contains(['/', '\\', '\0'])
        && !name.chars().any(|c| c.is_control())
}

/// Splits an already decoded path into validated segments.
pub fn segments(path: &str) -> Result<Vec<String>, ()> {
    let mut out = Vec::new();
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if !valid_name(seg) {
            return Err(());
        }
        out.push(seg.to_string());
    }
    Ok(out)
}

/// Splits a raw request target (`/a%20b/c?x=1`) into decoded path segments,
/// a trailing-slash flag and the parsed query parameters.
pub struct Target {
    pub segs: Vec<String>,
    pub trailing_slash: bool,
    pub query: Vec<(String, String)>,
}

impl Target {
    pub fn parse(raw: &str) -> Result<Target, ()> {
        let (path, query) = raw.split_once('?').unwrap_or((raw, ""));
        let decoded = percent_decode(path, false).ok_or(())?;
        let segs = segments(&decoded)?;
        let trailing_slash = decoded.ends_with('/');
        let query = query
            .split('&')
            .filter(|kv| !kv.is_empty())
            .filter_map(|kv| {
                let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
                Some((percent_decode(k, true)?, percent_decode(v, true)?))
            })
            .collect();
        Ok(Target { segs, trailing_slash, query })
    }

    pub fn q(&self, key: &str) -> Option<&str> {
        self.query.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    pub fn has(&self, key: &str) -> bool {
        self.q(key).is_some()
    }
}

/// Builds the URL path for a list of segments.
pub fn to_url(segs: &[String], dir: bool) -> String {
    let mut s = String::from("/");
    for (i, seg) in segs.iter().enumerate() {
        if i > 0 {
            s.push('/');
        }
        s.push_str(&percent_encode(seg));
    }
    if dir && !segs.is_empty() {
        s.push('/');
    }
    s
}
