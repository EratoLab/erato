//! Cache validators and compression for the files of the served frontends.
//!
//! Customers run Erato behind proxies we do not control, so the server itself
//! compresses and labels its files instead of relying on whatever sits in front.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use axum::body::HttpBody as Body;
use axum::http::{HeaderMap, HeaderValue, Response, StatusCode, header};
use sha2::{Digest, Sha256};
use tower_http::compression::predicate::{Predicate, SizeAbove};

use crate::distribution::branding::safe_relative_path;
use crate::http_validators::content_etag;
use crate::translation_po::SourceStamp;

/// For files whose name changes whenever their content does.
pub const IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// Smaller responses gain less from compression than the encoding costs.
const MIN_COMPRESSED_SIZE_BYTES: u16 = 1024;

/// Content-derived entity tags of files on disk, recomputed whenever a file's
/// stamp changes (theme and kit files can change while the server runs).
#[derive(Debug, Default, erato_memory::HeapSize)]
pub struct FileEtags {
    entries: Mutex<HashMap<PathBuf, (FileStamp, String)>>,
}

/// Size and modification time, plus inode and status-change time: copy tools
/// can keep the first two across a content change, but not the last two.
#[derive(Debug, PartialEq, Eq, erato_memory::HeapSize)]
struct FileStamp {
    source: SourceStamp,
    changed: (u64, i64, i64),
}

impl FileStamp {
    fn read(path: &Path) -> Option<Self> {
        let metadata = std::fs::metadata(path).ok().filter(|meta| meta.is_file())?;
        Some(Self {
            source: SourceStamp::read(path).ok()?,
            changed: change_stamp(&metadata),
        })
    }
}

#[cfg(unix)]
fn change_stamp(metadata: &std::fs::Metadata) -> (u64, i64, i64) {
    use std::os::unix::fs::MetadataExt;
    (metadata.ino(), metadata.ctime(), metadata.ctime_nsec())
}

#[cfg(not(unix))]
fn change_stamp(_metadata: &std::fs::Metadata) -> (u64, i64, i64) {
    (0, 0, 0)
}

impl FileEtags {
    /// Returns `None` when the path is not a readable regular file.
    pub async fn etag_for(&self, path: &Path) -> Option<String> {
        let owned_path = path.to_path_buf();
        let stamp = tokio::task::spawn_blocking(move || FileStamp::read(&owned_path))
            .await
            .ok()??;
        if let Some((cached_stamp, etag)) = self.lock().get(path)
            && *cached_stamp == stamp
        {
            return Some(etag.clone());
        }

        let owned_path = path.to_path_buf();
        let etag = tokio::task::spawn_blocking(move || hash_file(&owned_path))
            .await
            .ok()?
            .ok()?;
        self.lock()
            .insert(path.to_path_buf(), (stamp, etag.clone()));
        Some(etag)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, (FileStamp, String)>> {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(content_etag(&hasher.finalize()))
}

/// Maps a request path below a bundle root to the file it names, refusing
/// anything that could leave the root. Directories yield `None`.
pub fn resolve_bundle_file(bundle_root: &Path, request_path: &str) -> Option<(PathBuf, String)> {
    let decoded = percent_encoding::percent_decode_str(request_path)
        .decode_utf8()
        .ok()?;
    let relative = decoded.trim_start_matches('/');
    safe_relative_path(relative).then(|| (bundle_root.join(relative), relative.to_string()))
}

/// Prepares a request for tower-http's file services, which know only
/// modification dates (`etag` is the content tag of the file the request
/// names, `None` for pages):
/// - If-None-Match takes precedence over If-Modified-Since (RFC 9110 §13.2.2);
///   without this, a file whose content changed but whose modification time
///   did not move forward would be answered with 304. Pages never answer 304.
/// - A range is honoured only when If-Range, if sent, names the current
///   content, so resumed bytes are never appended to an older version.
/// - Byte ranges are served from the uncompressed file, so a range always
///   refers to the same bytes whatever encoding the client accepts.
pub fn prepare_file_request<B>(
    mut req: axum::http::Request<B>,
    etag: Option<&str>,
) -> axum::http::Request<B> {
    let headers = req.headers_mut();
    if etag.is_none() || headers.contains_key(header::IF_NONE_MATCH) {
        headers.remove(header::IF_MODIFIED_SINCE);
    }
    if let Some(if_range) = headers.get(header::IF_RANGE)
        && etag.is_none_or(|etag| if_range.as_bytes() != etag.as_bytes())
    {
        headers.remove(header::RANGE);
    }
    headers.remove(header::IF_RANGE);
    if headers.contains_key(header::RANGE) {
        headers.remove(header::ACCEPT_ENCODING);
    }
    req
}

/// Which responses the server compresses on the fly: complete responses of
/// text-like content without a precompressed copy (HTML, compiled translation
/// catalogs, theme and kit files, bundles built without copies).
#[derive(Clone, Copy, Debug, Default)]
pub struct CompressibleResponse;

impl Predicate for CompressibleResponse {
    fn should_compress<B>(&self, response: &Response<B>) -> bool
    where
        B: Body,
    {
        response.status() == StatusCode::OK
            && is_compressible_content_type(response.headers())
            && SizeAbove::new(MIN_COMPRESSED_SIZE_BYTES).should_compress(response)
    }
}

fn is_compressible_content_type(headers: &HeaderMap) -> bool {
    let Some(content_type) = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let essence = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if essence == "text/event-stream" {
        return false;
    }
    essence.starts_with("text/")
        || essence.ends_with("+json")
        || essence.ends_with("+xml")
        || matches!(
            essence.as_str(),
            "application/javascript"
                | "application/json"
                | "application/xml"
                | "application/wasm"
                | "image/x-icon"
                | "image/vnd.microsoft.icon"
                | "font/ttf"
                | "font/otf"
        )
}

/// Runs after compression. An encoded response is a different representation
/// than the file on disk: its entity tag becomes weak (so a byte-range request
/// never pairs it with uncompressed bytes), and caches must key it by
/// Accept-Encoding (precompressed copies are not marked by the compression
/// layer, which leaves encoded responses alone).
pub fn finish_encoded_response<B>(mut response: Response<B>) -> Response<B> {
    if !response.headers().contains_key(header::CONTENT_ENCODING) {
        return response;
    }
    let headers = response.headers_mut();
    // Ranges are only served from the uncompressed file.
    headers.remove(header::ACCEPT_RANGES);
    if let Some(etag) = headers.get(header::ETAG).cloned()
        && !etag.as_bytes().starts_with(b"W/")
        && let Ok(weak) = HeaderValue::from_bytes(&[b"W/".as_slice(), etag.as_bytes()].concat())
    {
        headers.insert(header::ETAG, weak);
    }
    ensure_vary_accept_encoding(headers);
    response
}

pub fn ensure_vary_accept_encoding(headers: &mut HeaderMap) {
    let already_varies = headers.get_all(header::VARY).iter().any(|value| {
        value.to_str().is_ok_and(|value| {
            value.split(',').any(|name| {
                name.trim().eq_ignore_ascii_case("accept-encoding") || name.trim() == "*"
            })
        })
    });
    if !already_varies {
        headers.append(header::VARY, HeaderValue::from_static("accept-encoding"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_paths_never_leave_the_root() {
        let root = Path::new("/bundle");

        assert_eq!(
            resolve_bundle_file(root, "/public/common/assets/app%2DX.js"),
            Some((
                PathBuf::from("/bundle/public/common/assets/app-X.js"),
                "public/common/assets/app-X.js".to_string()
            ))
        );
        assert_eq!(resolve_bundle_file(root, "/public/../secret"), None);
        assert_eq!(resolve_bundle_file(root, "/public/%2e%2e/secret"), None);
        assert_eq!(resolve_bundle_file(root, "/a\\b"), None);
        assert_eq!(resolve_bundle_file(root, "/"), None);
    }

    #[tokio::test]
    async fn entity_tags_follow_file_content_not_server_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("theme.css");
        let etags = FileEtags::default();

        std::fs::write(&path, "a{}").unwrap();
        let first = etags.etag_for(&path).await.unwrap();
        assert_eq!(etags.etag_for(&path).await.unwrap(), first);

        std::fs::write(&path, "a{color:red}").unwrap();
        let changed = etags.etag_for(&path).await.unwrap();
        assert_ne!(changed, first);

        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, "a{color:blu}").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        let same_size_and_time = etags.etag_for(&path).await.unwrap();
        assert_ne!(same_size_and_time, changed);

        let same_content = dir.path().join("copy.css");
        std::fs::write(&same_content, "a{color:blu}").unwrap();
        assert_eq!(
            etags.etag_for(&same_content).await.unwrap(),
            same_size_and_time
        );
        assert_eq!(etags.etag_for(dir.path()).await, None);
    }
}
