//! Microsoft Office integration routes.

use crate::state::AppState;
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};

/// Header the add-in client carries the Exchange callback token in, as
/// `Bearer <token>`. It is kept OFF `Authorization` because that header is owned
/// by oauth2-proxy (it sets it to the Erato session token via
/// `pass_authorization_header`), which would clobber the Exchange token. This
/// proxy re-maps this header onto `Authorization` for the upstream EWS request.
const EWS_AUTHENTICATION_HEADER: &str = "x-ews-authentication";

/// Proxy an Exchange EWS SOAP request to the configured EWS API endpoint.
#[utoipa::path(
    post,
    path = "/integrations/ms-office/ews",
    request_body(content = String, content_type = "text/xml"),
    responses(
        (status = OK, description = "Response from the configured Exchange EWS endpoint", body = String, content_type = "text/xml"),
        (status = NOT_FOUND, description = "Exchange EWS proxy is not configured", body = str),
        (status = UNAUTHORIZED, description = "When the X-EWS-Authentication header is missing or malformed (must be `Bearer <token>` with a non-empty token)"),
        (status = BAD_GATEWAY, description = "Failed to proxy the Exchange EWS request", body = str)
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn ews_proxy(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(ews_api_endpoint) = app_state
        .config
        .integrations
        .ms_office
        .ews_api_endpoint
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
    else {
        return (
            StatusCode::NOT_FOUND,
            "Exchange EWS proxy is not configured",
        )
            .into_response();
    };

    let forwarded_headers = match build_ews_request_headers(&headers) {
        Ok(headers) => headers,
        Err(status) => return status.into_response(),
    };

    if !forwarded_headers.contains_key(reqwest::header::AUTHORIZATION) {
        tracing::error!(
            "Missing {} header for Exchange EWS proxy",
            EWS_AUTHENTICATION_HEADER
        );
        return StatusCode::UNAUTHORIZED.into_response();
    };

    let client = match build_ews_client(
        app_state
            .config
            .integrations
            .ms_office
            .ews_skip_tls_validation,
    ) {
        Ok(client) => client,
        Err(err) => {
            tracing::error!("Failed to build Exchange EWS HTTP client: {}", err);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to build Exchange EWS HTTP client",
            )
                .into_response();
        }
    };
    let proxied_response = match client
        .post(ews_api_endpoint)
        .headers(forwarded_headers)
        .body(body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            tracing::warn!("Failed to proxy Exchange EWS request: {}", err);
            return (
                StatusCode::BAD_GATEWAY,
                "Failed to proxy Exchange EWS request",
            )
                .into_response();
        }
    };

    response_from_ews(proxied_response).await
}

fn build_ews_client(skip_tls_validation: bool) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(skip_tls_validation)
        .build()
}

fn build_ews_request_headers(
    incoming_headers: &HeaderMap,
) -> Result<reqwest::header::HeaderMap, StatusCode> {
    let mut forwarded_headers = reqwest::header::HeaderMap::new();
    for (name, value) in incoming_headers {
        if !should_forward_ews_request_header(name) {
            continue;
        }

        let Ok(forwarded_name) = reqwest::header::HeaderName::from_bytes(name.as_str().as_bytes())
        else {
            continue;
        };
        let Ok(forwarded_value) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) else {
            continue;
        };
        forwarded_headers.insert(forwarded_name, forwarded_value);
    }

    // The Exchange callback token rides X-EWS-Authentication (Bearer <token>) so
    // oauth2-proxy doesn't clobber it; re-map it onto Authorization for Exchange.
    // Only well-formed `Bearer <token>` values are re-mapped; anything else is
    // dropped so the handler rejects the request with 401 instead of relaying a
    // malformed credential to Exchange. The incoming Authorization (the Erato
    // session token) is deliberately NOT forwarded — see
    // `should_forward_ews_request_header`.
    if let Some(value) = incoming_headers.get(EWS_AUTHENTICATION_HEADER)
        && is_well_formed_ews_bearer_value(value)
        && let Ok(forwarded_value) = reqwest::header::HeaderValue::from_bytes(value.as_bytes())
    {
        forwarded_headers.insert(reqwest::header::AUTHORIZATION, forwarded_value);
    }

    Ok(forwarded_headers)
}

/// Whether an X-EWS-Authentication value is a well-formed Bearer credential:
/// a case-insensitive `Bearer ` scheme prefix followed by a non-empty token.
/// Empty values, other schemes (e.g. `Basic`), and a bare `Bearer` without a
/// token are all rejected.
fn is_well_formed_ews_bearer_value(value: &HeaderValue) -> bool {
    let Some((scheme, token)) = value.as_bytes().split_at_checked("Bearer ".len()) else {
        return false;
    };
    scheme.eq_ignore_ascii_case(b"Bearer ") && token.iter().any(|byte| !byte.is_ascii_whitespace())
}

fn should_forward_ews_request_header(name: &HeaderName) -> bool {
    let name = name.as_str();
    name.eq_ignore_ascii_case("accept")
        || name.eq_ignore_ascii_case("content-type")
        || name.eq_ignore_ascii_case("soapaction")
        || name.eq_ignore_ascii_case("prefer")
        || name.eq_ignore_ascii_case("x-anchormailbox")
        || name.eq_ignore_ascii_case("x-preferserveraffinity")
        || name.eq_ignore_ascii_case("client-request-id")
        || name.eq_ignore_ascii_case("return-client-request-id")
}

async fn response_from_ews(response: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(response.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let response_headers = build_ews_response_headers(response.headers());
    let body = match response.bytes().await {
        Ok(body) => Body::from(body),
        Err(err) => {
            tracing::warn!("Failed to read Exchange EWS response body: {}", err);
            return (
                StatusCode::BAD_GATEWAY,
                "Failed to read Exchange EWS response",
            )
                .into_response();
        }
    };

    let mut proxied_response = Response::new(body);
    *proxied_response.status_mut() = status;
    *proxied_response.headers_mut() = response_headers;
    proxied_response
}

fn build_ews_response_headers(ews_headers: &reqwest::header::HeaderMap) -> HeaderMap {
    let mut response_headers = HeaderMap::new();
    response_headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));

    for (name, value) in ews_headers {
        if !should_forward_ews_response_header(name.as_str()) {
            continue;
        }

        let Ok(response_name) = HeaderName::from_bytes(name.as_str().as_bytes()) else {
            continue;
        };
        let Ok(response_value) = HeaderValue::from_bytes(value.as_bytes()) else {
            continue;
        };
        response_headers.insert(response_name, response_value);
    }

    response_headers
}

fn should_forward_ews_response_header(name: &str) -> bool {
    name.eq_ignore_ascii_case(CONTENT_TYPE.as_str())
        || name.eq_ignore_ascii_case("request-id")
        || name.eq_ignore_ascii_case("client-request-id")
        || name.eq_ignore_ascii_case("return-client-request-id")
        || name.eq_ignore_ascii_case("x-ms-diagnostics")
        || name.eq_ignore_ascii_case("x-feserver")
        || name.eq_ignore_ascii_case("x-beserver")
        || name.eq_ignore_ascii_case("x-calculatedbetarget")
        || name.eq_ignore_ascii_case("x-diaginfo")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::{ACCEPT, AUTHORIZATION, HOST};

    #[test]
    fn ews_request_headers_map_ews_authentication_and_drop_session_authorization() {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("text/xml"));
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("text/xml; charset=utf-8"),
        );
        headers.insert(HOST, HeaderValue::from_static("erato.example.com"));
        // The Erato session token on Authorization must NOT reach Exchange.
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer erato-session"),
        );
        // The Exchange callback token rides X-EWS-Authentication.
        headers.insert(
            HeaderName::from_static("x-ews-authentication"),
            HeaderValue::from_static("Bearer exchange-token"),
        );
        headers.insert(
            HeaderName::from_static("soapaction"),
            HeaderValue::from_static("\"GetItem\""),
        );
        headers.insert(
            HeaderName::from_static("x-anchormailbox"),
            HeaderValue::from_static("user@example.com"),
        );

        let forwarded = build_ews_request_headers(&headers).unwrap();

        assert_eq!(forwarded.get(reqwest::header::ACCEPT).unwrap(), "text/xml");
        assert_eq!(
            forwarded.get(reqwest::header::CONTENT_TYPE).unwrap(),
            "text/xml; charset=utf-8"
        );
        // Authorization sent to Exchange is the X-EWS-Authentication value, NOT
        // the Erato session token.
        assert_eq!(
            forwarded.get(reqwest::header::AUTHORIZATION).unwrap(),
            "Bearer exchange-token"
        );
        // The raw X-EWS-Authentication header itself is not forwarded.
        assert!(!forwarded.contains_key("x-ews-authentication"));
        assert_eq!(forwarded.get("soapaction").unwrap(), "\"GetItem\"");
        assert_eq!(
            forwarded.get("x-anchormailbox").unwrap(),
            "user@example.com"
        );
        assert!(!forwarded.contains_key(reqwest::header::HOST));
    }

    #[test]
    fn ews_request_headers_without_ews_authentication_set_no_authorization() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/xml"));
        // Only the Erato session token is present — it must not be forwarded, so
        // the handler will reject the request (401) for a missing EWS token.
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer erato-session"),
        );

        let forwarded = build_ews_request_headers(&headers).unwrap();

        assert!(!forwarded.contains_key(reqwest::header::AUTHORIZATION));
    }

    /// Builds headers with the given X-EWS-Authentication value and returns
    /// the forwarded header map. Whenever no Authorization header comes out of
    /// here, the handler's missing-Authorization guard returns 401 before any
    /// upstream EWS request is built or sent.
    fn forwarded_headers_for_ews_authentication(value: &'static str) -> reqwest::header::HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/xml"));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer erato-session"),
        );
        headers.insert(
            HeaderName::from_static("x-ews-authentication"),
            HeaderValue::from_static(value),
        );

        build_ews_request_headers(&headers).unwrap()
    }

    #[test]
    fn ews_request_headers_reject_empty_ews_authentication() {
        // An empty value must not defeat the handler's 401 guard by inserting
        // an empty Authorization header.
        let forwarded = forwarded_headers_for_ews_authentication("");

        assert!(!forwarded.contains_key(reqwest::header::AUTHORIZATION));
    }

    #[test]
    fn ews_request_headers_reject_non_bearer_ews_authentication_scheme() {
        // Only Bearer credentials may be relayed to Exchange; other schemes
        // (e.g. Basic) are dropped so the handler returns 401.
        let forwarded = forwarded_headers_for_ews_authentication("Basic dXNlcjpwYXNz");

        assert!(!forwarded.contains_key(reqwest::header::AUTHORIZATION));
    }

    #[test]
    fn ews_request_headers_reject_bearer_without_token() {
        // A bare scheme without a token is malformed and must not be relayed.
        for malformed in ["Bearer", "Bearer ", "Bearer   "] {
            let forwarded = forwarded_headers_for_ews_authentication(malformed);

            assert!(
                !forwarded.contains_key(reqwest::header::AUTHORIZATION),
                "expected no Authorization for X-EWS-Authentication value {malformed:?}"
            );
        }
    }

    #[test]
    fn ews_request_headers_accept_case_insensitive_bearer_scheme() {
        let forwarded = forwarded_headers_for_ews_authentication("bearer exchange-token");

        assert_eq!(
            forwarded.get(reqwest::header::AUTHORIZATION).unwrap(),
            "bearer exchange-token"
        );
    }
}
