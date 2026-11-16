//! Where the backend serves the MCP Apps sandbox page
//! (`frontend/public/mcp-apps-sandbox.html`): only on a host that is some
//! server's `mcp_apps.sandbox_origin`. The page runs the HTML its embedder
//! sends it, so on the app's own host any page allowed to frame the app
//! could run script on the app's origin through it.
use crate::state::AppState;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, Uri, header, uri::Authority};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use percent_encoding::percent_decode_str;

const SANDBOX_PAGE_FILE: &str = "mcp-apps-sandbox.html";

/// Whether `path` names the sandbox page, wherever a frontend is mounted and
/// however the path is encoded or cased.
fn is_sandbox_page_path(path: &str) -> bool {
    percent_decode_str(path)
        .decode_utf8_lossy()
        .to_ascii_lowercase()
        .ends_with(SANDBOX_PAGE_FILE)
}

/// The host and port the client asked for, as the proxy in front passes it on.
fn requested_authority<'a>(headers: &'a HeaderMap, uri: &'a Uri) -> Option<&'a str> {
    headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .or_else(|| uri.authority().map(Authority::as_str))
}

/// Whether `authority` is the host and port of `origin`. A port the origin
/// leaves out is its scheme's default.
fn is_authority_of(origin: &str, authority: &str) -> bool {
    let (Ok(origin), Ok(authority)) = (
        url::Url::parse(origin),
        authority.to_ascii_lowercase().parse::<Authority>(),
    ) else {
        return false;
    };
    origin.host_str() == Some(authority.host())
        && match authority.port_u16() {
            Some(port) => origin.port_or_known_default() == Some(port),
            None => origin.port().is_none(),
        }
}

fn serves_sandbox_page<'a>(
    headers: &HeaderMap,
    uri: &Uri,
    mut sandbox_origins: impl Iterator<Item = &'a str>,
) -> bool {
    requested_authority(headers, uri)
        .is_some_and(|authority| sandbox_origins.any(|origin| is_authority_of(origin, authority)))
}

/// Answers 404 for the sandbox page unless the request came in on the host of
/// an enabled `mcp_servers.<id>.mcp_apps.sandbox_origin`.
pub async fn on_sandbox_hosts_only(
    State(app_state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if is_sandbox_page_path(request.uri().path()) {
        let mcp = app_state.mcp_state().await;
        let sandbox_origins = mcp
            .config
            .mcp_servers
            .values()
            .filter(|server| server.mcp_apps.enabled)
            .filter_map(|server| server.mcp_apps.sandbox_origin.as_deref());
        if !serves_sandbox_page(request.headers(), request.uri(), sandbox_origins) {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "/public/common/mcp-apps-sandbox.html";
    const SANDBOX: &str = "https://mcp-apps.example.net";

    fn served(host_header: (&'static str, &'static str), origins: &[&str]) -> bool {
        let mut headers = HeaderMap::new();
        headers.insert(host_header.0, host_header.1.parse().unwrap());
        serves_sandbox_page(&headers, &Uri::from_static(PAGE), origins.iter().copied())
    }

    #[test]
    fn the_sandbox_page_is_recognised_however_its_path_is_written() {
        for path in [
            PAGE,
            "/public/common/MCP-Apps-Sandbox.HTML",
            "/public/common/mcp-apps-sandbox%2Ehtml",
            "/public/common/%6Dcp-apps-sandbox.html",
            "/public/common%2Fmcp-apps-sandbox.html",
            "/office-addin/mcp-apps-sandbox.html",
        ] {
            assert!(is_sandbox_page_path(path), "{path}");
        }
        for path in [
            "/",
            "/public/common/index.html",
            "/mcp-apps-sandbox.html.map",
        ] {
            assert!(!is_sandbox_page_path(path), "{path}");
        }
    }

    #[test]
    fn the_sandbox_page_is_served_on_a_sandbox_origin_host_only() {
        assert!(served(("host", "mcp-apps.example.net"), &[SANDBOX]));
        assert!(served(("host", "MCP-Apps.example.net:443"), &[SANDBOX]));
        assert!(served(
            ("host", "localhost:3130"),
            &["https://other.example.net", "http://localhost:3130"]
        ));

        // The app's own host, with and without servers that enable views.
        assert!(!served(("host", "erato.example.com"), &[SANDBOX]));
        assert!(!served(("host", "erato.example.com"), &[]));
        // The same host on another port is another origin.
        assert!(!served(("host", "mcp-apps.example.net:8443"), &[SANDBOX]));
        assert!(!served(("host", "localhost"), &["http://localhost:3130"]));
        assert!(!served(
            ("host", "localhost:4180"),
            &["http://localhost:3130"]
        ));
        // A host that only starts or ends like the sandbox origin's.
        assert!(!served(
            ("host", "mcp-apps.example.net.evil.test"),
            &[SANDBOX]
        ));
        assert!(!served(("host", "x-mcp-apps.example.net"), &[SANDBOX]));
    }

    #[test]
    fn the_forwarded_host_counts_before_the_host_header() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "erato-app:3130".parse().unwrap());
        let uri = Uri::from_static(PAGE);
        assert!(!serves_sandbox_page(&headers, &uri, [SANDBOX].into_iter()));

        headers.insert("x-forwarded-host", "mcp-apps.example.net".parse().unwrap());
        assert!(serves_sandbox_page(&headers, &uri, [SANDBOX].into_iter()));

        headers.insert("x-forwarded-host", "erato.example.com".parse().unwrap());
        headers.insert("host", "mcp-apps.example.net".parse().unwrap());
        assert!(!serves_sandbox_page(&headers, &uri, [SANDBOX].into_iter()));
    }

    #[test]
    fn a_request_without_a_host_header_is_matched_by_its_uri_authority() {
        let uri =
            Uri::from_static("https://mcp-apps.example.net/public/common/mcp-apps-sandbox.html");
        assert!(serves_sandbox_page(
            &HeaderMap::new(),
            &uri,
            [SANDBOX].into_iter()
        ));
        assert!(!serves_sandbox_page(
            &HeaderMap::new(),
            &Uri::from_static(PAGE),
            [SANDBOX].into_iter()
        ));
    }
}
