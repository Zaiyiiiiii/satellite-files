//! Runtime configuration (read from environment variables) and access control.
//!
//! * `SF_TITLE`    – site name shown in the UI (default: "Satellite").
//! * `SF_ACCOUNTS` – `user:password` pairs separated by commas.
//! * `SF_ACCESS`   – access rules, `;`-separated, each `PATH:WHO=PERMS,WHO=PERMS`.
//!   `WHO` is `*` (everyone), `@acct` (any signed-in user) or a user name.
//!   `PERMS` is any combination of `r` (read), `w` (upload / new folder),
//!   `m` (move / rename) and `d` (delete). The longest matching path wins.
//! * `SF_SECRET`   – key used to sign session cookies.
//! * `SF_MAX_UPLOAD` – optional upload size limit in MiB (0 = unlimited).

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct Perms {
    pub read: bool,
    pub write: bool,
    pub move_: bool,
    pub delete: bool,
}

impl Perms {
    pub fn parse(s: &str) -> Perms {
        let mut p = Perms::default();
        for c in s.chars() {
            match c.to_ascii_lowercase() {
                'r' => p.read = true,
                'w' => p.write = true,
                'm' => p.move_ = true,
                'd' => p.delete = true,
                'a' => {
                    p = Perms { read: true, write: true, move_: true, delete: true };
                }
                _ => {}
            }
        }
        p
    }

    fn union(self, o: Perms) -> Perms {
        Perms {
            read: self.read || o.read,
            write: self.write || o.write,
            move_: self.move_ || o.move_,
            delete: self.delete || o.delete,
        }
    }

    pub fn any(self) -> bool {
        self.read || self.write || self.move_ || self.delete
    }
}

struct Rule {
    /// Normalized path segments of the rule's prefix.
    prefix: Vec<String>,
    grants: Vec<(String, Perms)>,
}

pub struct Config {
    pub title: String,
    accounts: Vec<(String, String)>,
    rules: Vec<Rule>,
    secret: Vec<u8>,
    pub max_upload: u64,
}

impl Config {
    pub fn load() -> Config {
        let env: Vec<(String, String)> = wasip3::cli::environment::get_environment();
        let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());

        let title = get("SF_TITLE").filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "Satellite".into());

        let accounts: Vec<(String, String)> = get("SF_ACCOUNTS")
            .unwrap_or_default()
            .split(',')
            .filter_map(|pair| {
                let (u, p) = pair.trim().split_once(':')?;
                let u = u.trim();
                if u.is_empty() || u.starts_with('@') || u == "*" {
                    return None;
                }
                Some((u.to_string(), p.to_string()))
            })
            .collect();

        let access = get("SF_ACCESS").filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
            if accounts.is_empty() {
                "/:*=rwmd".into()
            } else {
                "/:*=r,@acct=rwmd".into()
            }
        });
        let rules = access
            .split(';')
            .filter_map(|r| {
                let (path, spec) = r.trim().rsplit_once(':')?;
                let prefix = crate::paths::segments(path).ok()?;
                let grants = spec
                    .split(',')
                    .filter_map(|g| {
                        let (who, perms) = g.trim().split_once('=')?;
                        Some((who.trim().to_string(), Perms::parse(perms.trim())))
                    })
                    .collect();
                Some(Rule { prefix, grants })
            })
            .collect();

        let secret = match get("SF_SECRET") {
            Some(s) if !s.is_empty() => s.into_bytes(),
            // Stable across instances, and rotates whenever any account changes.
            _ => {
                let mut h = Sha256::new();
                h.update(b"satellite-files/session-key/v1\0");
                h.update(get("SF_ACCOUNTS").unwrap_or_default().as_bytes());
                h.finalize().to_vec()
            }
        };

        let max_upload = get("SF_MAX_UPLOAD").and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(0) * 1024 * 1024;

        Config { title, accounts, rules, secret, max_upload }
    }

    pub fn has_accounts(&self) -> bool {
        !self.accounts.is_empty()
    }

    pub fn check_password(&self, user: &str, pass: &str) -> bool {
        self.accounts.iter().any(|(u, p)| u == user && ct_eq(p.as_bytes(), pass.as_bytes()))
    }

    fn user_exists(&self, user: &str) -> bool {
        self.accounts.iter().any(|(u, _)| u == user)
    }

    /// Effective permissions of `user` (None = anonymous) at `path`.
    pub fn perms(&self, user: Option<&str>, path: &[String]) -> Perms {
        let rule = self
            .rules
            .iter()
            .filter(|r| path.starts_with(&r.prefix))
            .max_by_key(|r| r.prefix.len());
        let Some(rule) = rule else { return Perms::default() };
        let mut p = Perms::default();
        for (who, perms) in &rule.grants {
            let hit = match who.as_str() {
                "*" => true,
                "@acct" => user.is_some(),
                name => user == Some(name),
            };
            if hit {
                p = p.union(*perms);
            }
        }
        p
    }

    fn sign(&self, msg: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.secret).expect("hmac accepts any key");
        mac.update(msg.as_bytes());
        hex(&mac.finalize().into_bytes())
    }

    /// Creates a session token: `user.expiry.signature`.
    pub fn issue_session(&self, user: &str, now: i64, ttl: i64) -> String {
        let msg = format!("{}.{}", hex(user.as_bytes()), now + ttl);
        let sig = self.sign(&msg);
        format!("{msg}.{sig}")
    }

    pub fn verify_session(&self, token: &str, now: i64) -> Option<String> {
        let (msg, sig) = token.rsplit_once('.')?;
        if !ct_eq(self.sign(msg).as_bytes(), sig.as_bytes()) {
            return None;
        }
        let (user_hex, exp) = msg.split_once('.')?;
        if exp.parse::<i64>().ok()? < now {
            return None;
        }
        let user = String::from_utf8(unhex(user_hex)?).ok()?;
        self.user_exists(&user).then_some(user)
    }
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}
