//! Entity tags for the endpoints that answer conditional requests.

/// A strong entity tag from a SHA-256 digest of the content.
pub fn content_etag(sha256_digest: &[u8]) -> String {
    let hex = sha256_digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("\"{hex}\"")
}

/// Weak comparison (RFC 9110 §8.8.3.2), as If-None-Match requires. Returns the
/// tag exactly as the client sent it, so a 304 keeps the client's form of it.
pub fn matching_entity_tag(
    if_none_match: Option<&axum::http::HeaderValue>,
    etag: &str,
) -> Option<String> {
    let opaque = etag.strip_prefix("W/").unwrap_or(etag);
    if_none_match?
        .to_str()
        .ok()?
        .split(',')
        .map(str::trim)
        .find_map(|candidate| {
            if candidate == "*" {
                Some(etag.to_string())
            } else {
                (candidate.strip_prefix("W/").unwrap_or(candidate) == opaque)
                    .then(|| candidate.to_string())
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn if_none_match_uses_weak_comparison_and_echoes_the_client_tag() {
        let etag = "\"abc\"";
        let header = |value: &'static str| HeaderValue::from_static(value);

        assert_eq!(
            matching_entity_tag(Some(&header("\"abc\"")), etag).as_deref(),
            Some("\"abc\"")
        );
        assert_eq!(
            matching_entity_tag(Some(&header("\"x\", W/\"abc\"")), etag).as_deref(),
            Some("W/\"abc\"")
        );
        assert_eq!(
            matching_entity_tag(Some(&header("*")), etag).as_deref(),
            Some("\"abc\"")
        );
        assert_eq!(matching_entity_tag(Some(&header("\"abd\"")), etag), None);
        assert_eq!(matching_entity_tag(None, etag), None);
    }

    #[test]
    fn content_etags_are_quoted_hex_of_the_first_16_digest_bytes() {
        assert_eq!(
            content_etag(&[0xab; 32]),
            format!("\"{}\"", "ab".repeat(16))
        );
    }
}
