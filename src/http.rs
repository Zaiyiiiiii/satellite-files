//! Small helpers for building WASIp3 HTTP responses.

use wasip3::http::types::{ErrorCode, Fields, Response};
use wasip3::wit_bindgen::{spawn_local, StreamReader, StreamResult, StreamWriter};
use wasip3::{wit_future, wit_stream};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Status(pub u16);

impl Status {
    pub const OK: Status = Status(200);
    pub const CREATED: Status = Status(201);
    pub const NO_CONTENT: Status = Status(204);
    pub const PARTIAL: Status = Status(206);
    pub const FOUND: Status = Status(302);
    pub const NOT_MODIFIED: Status = Status(304);
    pub const BAD_REQUEST: Status = Status(400);
    pub const UNAUTHORIZED: Status = Status(401);
    pub const FORBIDDEN: Status = Status(403);
    pub const NOT_FOUND: Status = Status(404);
    pub const METHOD_NOT_ALLOWED: Status = Status(405);
    pub const CONFLICT: Status = Status(409);
    pub const TOO_LARGE: Status = Status(413);
    pub const RANGE_NOT_SATISFIABLE: Status = Status(416);
    pub const INTERNAL: Status = Status(500);
    pub const BAD_GATEWAY: Status = Status(502);
    pub const INSUFFICIENT_STORAGE: Status = Status(507);

    pub fn reason(self) -> &'static str {
        match self.0 {
            400 => "Bad request",
            401 => "Sign in required",
            403 => "Permission denied",
            404 => "Not found",
            405 => "Method not allowed",
            409 => "Already exists or conflicts with an existing item",
            413 => "Upload too large",
            416 => "Range not satisfiable",
            502 => "Operation not supported across volumes",
            507 => "Not enough storage space",
            _ => "Internal error",
        }
    }
}

pub enum Body {
    Empty,
    Bytes(Vec<u8>),
    Stream(StreamReader<u8>),
}

pub struct Resp {
    pub status: Status,
    pub headers: Vec<(String, Vec<u8>)>,
    pub body: Body,
}

impl Resp {
    pub fn new(status: Status) -> Resp {
        Resp { status, headers: Vec::new(), body: Body::Empty }
    }

    pub fn header(mut self, k: &str, v: impl Into<String>) -> Resp {
        self.headers.push((k.to_string(), v.into().into_bytes()));
        self
    }

    pub fn bytes(mut self, ctype: &str, b: impl Into<Vec<u8>>) -> Resp {
        let b = b.into();
        self.headers.push(("content-type".into(), ctype.as_bytes().to_vec()));
        self.headers.push(("content-length".into(), b.len().to_string().into_bytes()));
        self.body = Body::Bytes(b);
        self
    }

    pub fn json(status: Status, v: &serde_json::Value) -> Resp {
        Resp::new(status)
            .header("cache-control", "no-store")
            .bytes("application/json; charset=utf-8", serde_json::to_vec(v).unwrap_or_default())
    }

    pub fn error(status: Status) -> Resp {
        Resp::error_msg(status, status.reason())
    }

    pub fn error_msg(status: Status, msg: &str) -> Resp {
        Resp::json(status, &serde_json::json!({ "error": msg }))
    }

    pub fn redirect(location: &str) -> Resp {
        Resp::new(Status::FOUND).header("location", location).header("content-length", "0")
    }

    /// Drops the body but keeps headers (for HEAD requests).
    pub fn head_only(mut self) -> Resp {
        self.body = Body::Empty;
        self
    }

    pub fn into_response(self) -> Response {
        let headers = Fields::from_list(&self.headers).unwrap_or_else(|_| Fields::new());
        let (trailers_tx, trailers_rx) = wit_future::new::<Result<Option<Fields>, ErrorCode>>(|| Ok(None));
        drop(trailers_tx);
        let contents = match self.body {
            Body::Empty => None,
            Body::Stream(s) => Some(s),
            Body::Bytes(b) => {
                let (mut tx, rx) = wit_stream::new::<u8>();
                spawn_local(async move {
                    let _ = tx.write_all(b).await;
                });
                Some(rx)
            }
        };
        let (resp, _done) = Response::new(headers, contents, trailers_rx);
        let _ = resp.set_status_code(self.status.0);
        resp
    }
}

pub const CHUNK: usize = 256 * 1024;

/// Copies up to `limit` bytes from `src` into `dst`; returns bytes copied.
/// When `pad` is set, zero-fills up to `limit` if the source ends early.
pub async fn pipe(src: &mut StreamReader<u8>, dst: &mut StreamWriter<u8>, limit: Option<u64>, pad: bool) -> Result<u64, ()> {
    let mut copied: u64 = 0;
    loop {
        let want = match limit {
            Some(l) if copied >= l => break,
            Some(l) => ((l - copied) as usize).min(CHUNK),
            None => CHUNK,
        };
        let (res, buf) = src.read(Vec::with_capacity(want)).await;
        if !buf.is_empty() {
            copied += buf.len() as u64;
            if !dst.write_all(buf).await.is_empty() {
                return Err(()); // receiver went away
            }
        }
        if let StreamResult::Dropped | StreamResult::Cancelled = res {
            break;
        }
    }
    if pad {
        if let Some(l) = limit {
            while copied < l {
                let n = ((l - copied) as usize).min(CHUNK);
                if !dst.write_all(vec![0u8; n]).await.is_empty() {
                    return Err(());
                }
                copied += n as u64;
            }
        }
    }
    Ok(copied)
}
