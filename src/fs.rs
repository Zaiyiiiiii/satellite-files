//! A small virtual file system on top of the WASI preopened directories.
//!
//! Every preopen becomes a "volume" mounted at its guest path. A preopen at
//! `/` (or `.`) is the root volume; others appear as folders in the tree.

use wasip3::filesystem::preopens::get_directories;
use wasip3::filesystem::types::{
    Descriptor, DescriptorFlags, DescriptorStat, DescriptorType, ErrorCode, OpenFlags, PathFlags,
};

use crate::http::Status;

pub struct Vfs {
    vols: Vec<(Vec<String>, Descriptor)>,
}

/// A resolved location inside the virtual tree.
pub enum Loc<'a> {
    /// A folder that only exists because a volume is mounted below it.
    Virtual,
    /// A path relative to a volume's directory ("." for the volume root).
    Real { dir: &'a Descriptor, rel: String },
}

impl<'a> Loc<'a> {
    pub fn is_mount_root(&self) -> bool {
        match self {
            Loc::Virtual => true,
            Loc::Real { rel, .. } => rel == ".",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    pub mtime: i64,
}

#[derive(Clone, Debug)]
pub struct Meta {
    pub dir: bool,
    pub size: u64,
    pub mtime: i64,
}

impl Meta {
    fn from_stat(s: &DescriptorStat) -> Meta {
        Meta {
            dir: matches!(s.type_, DescriptorType::Directory),
            size: s.size,
            mtime: s.data_modification_timestamp.as_ref().map(|t| t.seconds).unwrap_or(0),
        }
    }
}

pub fn err_status(e: &ErrorCode) -> Status {
    match e {
        ErrorCode::NoEntry | ErrorCode::NotDirectory => Status::NOT_FOUND,
        ErrorCode::Access | ErrorCode::NotPermitted | ErrorCode::ReadOnly => Status::FORBIDDEN,
        ErrorCode::Exist | ErrorCode::NotEmpty | ErrorCode::IsDirectory => Status::CONFLICT,
        ErrorCode::InsufficientSpace | ErrorCode::Quota => Status::INSUFFICIENT_STORAGE,
        ErrorCode::NameTooLong | ErrorCode::Invalid | ErrorCode::IllegalByteSequence => Status::BAD_REQUEST,
        ErrorCode::CrossDevice => Status::BAD_GATEWAY,
        _ => Status::INTERNAL,
    }
}

impl Vfs {
    pub fn open() -> Vfs {
        let vols = get_directories()
            .into_iter()
            .filter_map(|(d, p)| Some((crate::paths::segments(&p).ok()?, d)))
            .collect();
        Vfs { vols }
    }

    pub fn resolve(&self, segs: &[String]) -> Option<Loc<'_>> {
        let best = self
            .vols
            .iter()
            .filter(|(m, _)| segs.starts_with(m))
            .max_by_key(|(m, _)| m.len());
        if let Some((m, d)) = best {
            let rest = &segs[m.len()..];
            let rel = if rest.is_empty() { ".".to_string() } else { rest.join("/") };
            return Some(Loc::Real { dir: d, rel });
        }
        if self.vols.iter().any(|(m, _)| m.len() > segs.len() && m.starts_with(segs)) {
            return Some(Loc::Virtual);
        }
        None
    }

    /// Names of volumes mounted directly below `segs`.
    fn mounts_below(&self, segs: &[String]) -> Vec<String> {
        let mut v: Vec<String> = self
            .vols
            .iter()
            .filter(|(m, _)| m.len() > segs.len() && m.starts_with(segs))
            .map(|(m, _)| m[segs.len()].clone())
            .collect();
        v.sort();
        v.dedup();
        v
    }

    pub async fn stat(&self, segs: &[String]) -> Result<Meta, Status> {
        match self.resolve(segs).ok_or(Status::NOT_FOUND)? {
            Loc::Virtual => Ok(Meta { dir: true, size: 0, mtime: 0 }),
            Loc::Real { dir, rel } => {
                if rel == "." {
                    // Volume roots may be shadowed by a mount; treat them as folders.
                    let s = dir.stat().await.map_err(|e| err_status(&e))?;
                    return Ok(Meta::from_stat(&s));
                }
                let s = dir.stat_at(PathFlags::SYMLINK_FOLLOW, rel).await.map_err(|e| err_status(&e))?;
                Ok(Meta::from_stat(&s))
            }
        }
    }

    pub async fn list(&self, segs: &[String]) -> Result<Vec<Entry>, Status> {
        let mut out: Vec<Entry> = Vec::new();
        if let Loc::Real { dir, rel } = self.resolve(segs).ok_or(Status::NOT_FOUND)? {
            let d = open_dir(dir, &rel).await?;
            for name in read_names(&d).await? {
                let meta = match d.stat_at(PathFlags::SYMLINK_FOLLOW, name.clone()).await {
                    Ok(s) => Meta::from_stat(&s),
                    Err(_) => continue, // broken symlink, vanished file, …
                };
                out.push(Entry { name, dir: meta.dir, size: meta.size, mtime: meta.mtime });
            }
        }
        for m in self.mounts_below(segs) {
            if !out.iter().any(|e| e.name == m) {
                out.push(Entry { name: m, dir: true, size: 0, mtime: 0 });
            }
        }
        Ok(out)
    }

    pub async fn open_file(&self, segs: &[String]) -> Result<(Descriptor, Meta), Status> {
        match self.resolve(segs).ok_or(Status::NOT_FOUND)? {
            Loc::Virtual => Err(Status::CONFLICT),
            Loc::Real { dir, rel } => {
                let f = dir
                    .open_at(PathFlags::SYMLINK_FOLLOW, rel, OpenFlags::empty(), DescriptorFlags::READ)
                    .await
                    .map_err(|e| err_status(&e))?;
                let s = f.stat().await.map_err(|e| err_status(&e))?;
                Ok((f, Meta::from_stat(&s)))
            }
        }
    }

    /// Opens a directory for further `*_at` operations.
    pub async fn open_dir(&self, segs: &[String]) -> Result<Descriptor, Status> {
        match self.resolve(segs).ok_or(Status::NOT_FOUND)? {
            Loc::Virtual => Err(Status::FORBIDDEN),
            Loc::Real { dir, rel } => open_dir(dir, &rel).await,
        }
    }

    /// Creates `segs` and all missing parents.
    pub async fn mkdir_all(&self, segs: &[String]) -> Result<(), Status> {
        for i in 1..=segs.len() {
            let part = &segs[..i];
            match self.resolve(part).ok_or(Status::NOT_FOUND)? {
                Loc::Virtual => continue,
                Loc::Real { dir, rel } => {
                    if rel == "." {
                        continue;
                    }
                    match dir.create_directory_at(rel).await {
                        Ok(()) => {}
                        Err(ErrorCode::Exist) => {
                            if !self.stat(part).await?.dir {
                                return Err(Status::CONFLICT);
                            }
                        }
                        Err(e) => return Err(err_status(&e)),
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn remove(&self, segs: &[String]) -> Result<(), Status> {
        let loc = self.resolve(segs).ok_or(Status::NOT_FOUND)?;
        if loc.is_mount_root() {
            return Err(Status::FORBIDDEN);
        }
        let Loc::Real { dir, rel } = loc else { unreachable!() };
        let meta = self.stat(segs).await?;
        if meta.dir {
            remove_tree(dir, rel).await
        } else {
            dir.unlink_file_at(rel).await.map_err(|e| err_status(&e))
        }
    }

    pub async fn rename(&self, from: &[String], to: &[String]) -> Result<(), Status> {
        let a = self.resolve(from).ok_or(Status::NOT_FOUND)?;
        let b = self.resolve(to).ok_or(Status::NOT_FOUND)?;
        if a.is_mount_root() || b.is_mount_root() {
            return Err(Status::FORBIDDEN);
        }
        let (Loc::Real { dir: da, rel: ra }, Loc::Real { dir: db, rel: rb }) = (a, b) else { unreachable!() };
        da.rename_at(ra, db, rb).await.map_err(|e| err_status(&e))
    }
}

pub async fn open_dir(dir: &Descriptor, rel: &str) -> Result<Descriptor, Status> {
    dir.open_at(PathFlags::SYMLINK_FOLLOW, rel.to_string(), OpenFlags::DIRECTORY, DescriptorFlags::READ)
        .await
        .map_err(|e| err_status(&e))
}

pub async fn read_names(d: &Descriptor) -> Result<Vec<String>, Status> {
    let (stream, done) = d.read_directory();
    let entries = stream.collect().await;
    done.await.map_err(|e| err_status(&e))?;
    Ok(entries.into_iter().map(|e| e.name).filter(|n| n != "." && n != "..").collect())
}

/// Recursively deletes a directory (iteratively, to avoid recursive async fns).
async fn remove_tree(root: &Descriptor, rel: String) -> Result<(), Status> {
    // Stack of (path, children already pushed?)
    let mut stack = vec![(rel, false)];
    while let Some((path, expanded)) = stack.pop() {
        if expanded {
            root.remove_directory_at(path).await.map_err(|e| err_status(&e))?;
            continue;
        }
        let d = open_dir(root, &path).await?;
        let names = read_names(&d).await?;
        stack.push((path.clone(), true));
        for n in names {
            let child = format!("{path}/{n}");
            let st = d.stat_at(PathFlags::empty(), n).await.map_err(|e| err_status(&e))?;
            if matches!(st.type_, DescriptorType::Directory) {
                stack.push((child, false));
            } else {
                root.unlink_file_at(child).await.map_err(|e| err_status(&e))?;
            }
        }
    }
    Ok(())
}
