//! Minimal streaming tar (ustar + pax) writer used for folder downloads.

fn octal(field: &mut [u8], v: u64) {
    let w = field.len() - 1;
    let s = format!("{v:0w$o}");
    let s = &s.as_bytes()[s.len().saturating_sub(w)..];
    field[..w].copy_from_slice(s);
    field[w] = 0;
}

fn raw_header(name: &[u8], size: u64, mtime: i64, kind: u8) -> [u8; 512] {
    let mut h = [0u8; 512];
    let n = name.len().min(100);
    h[..n].copy_from_slice(&name[..n]);
    octal(&mut h[100..108], if kind == b'5' { 0o755 } else { 0o644 });
    octal(&mut h[108..116], 0);
    octal(&mut h[116..124], 0);
    octal(&mut h[124..136], size.min(0o77777777777));
    octal(&mut h[136..148], mtime.max(0) as u64);
    h[156] = kind;
    h[257..263].copy_from_slice(b"ustar\0");
    h[263..265].copy_from_slice(b"00");
    // Checksum is computed with the checksum field filled with spaces.
    h[148..156].copy_from_slice(b"        ");
    let sum: u64 = h.iter().map(|&b| b as u64).sum();
    octal(&mut h[148..155], sum);
    h[155] = b' ';
    h
}

fn pax_record(key: &str, val: &str) -> Vec<u8> {
    let body = format!(" {key}={val}\n");
    let mut len = body.len() + 1;
    loop {
        let total = len.to_string().len() + body.len();
        if total == len {
            break;
        }
        len = total;
    }
    format!("{len}{body}").into_bytes()
}

pub fn padding(size: u64) -> usize {
    ((512 - (size % 512)) % 512) as usize
}

/// Header block(s) for an entry. `path` uses `/` separators; folders end with `/`.
pub fn header(path: &str, size: u64, mtime: i64, dir: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(512);
    let needs_pax = path.len() > 100 || !path.is_ascii() || size > 0o77777777777;
    if needs_pax {
        let mut rec = pax_record("path", path);
        if size > 0o77777777777 {
            rec.extend(pax_record("size", &size.to_string()));
        }
        out.extend_from_slice(&raw_header(b"././@PaxHeader", rec.len() as u64, mtime, b'x'));
        let pad = padding(rec.len() as u64);
        out.extend(rec);
        out.extend(std::iter::repeat_n(0, pad));
    }
    out.extend_from_slice(&raw_header(path.as_bytes(), size, mtime, if dir { b'5' } else { b'0' }));
    out
}

pub fn trailer() -> Vec<u8> {
    vec![0u8; 1024]
}
