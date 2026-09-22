use regex::Regex;
use std::{fmt, sync::LazyLock};
use tracing::{Event, Subscriber};
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields, format::Writer};
use tracing_subscriber::registry::LookupSpan;
use url::Url;

static HTTP_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)https?://[^\s\x1b]+").unwrap());
static HTTP_SCHEME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)https?://").unwrap());

/// Sanitize after formatting so opaque dependency errors and span fields receive
/// the same protection as explicitly logged URLs. Never emit the original event
/// if formatting or JSON decoding fails.
pub(super) struct RedactingFormatter<F> {
    inner: F,
    json: bool,
}

impl<F> RedactingFormatter<F> {
    pub(super) fn new(inner: F, json: bool) -> Self {
        Self { inner, json }
    }
}

impl<S, N, F> FormatEvent<S, N> for RedactingFormatter<F>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
    F: FormatEvent<S, N>,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let mut formatted = String::new();
        if self
            .inner
            .format_event(ctx, Writer::new(&mut formatted), event)
            .is_err()
        {
            return write_omitted(&mut writer, self.json);
        }
        if self.json {
            let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&formatted) else {
                return write_omitted(&mut writer, true);
            };
            redact_json(&mut value);
            writeln!(writer, "{value}")
        } else {
            writer.write_str(&redact_text(&formatted))
        }
    }
}

fn write_omitted(writer: &mut Writer<'_>, json: bool) -> fmt::Result {
    writer.write_str(if json {
        "{\"message\":\"Log event omitted: formatting failed\"}\n"
    } else {
        "Log event omitted: formatting failed\n"
    })
}

fn redact_text(text: &str) -> String {
    HTTP_URL
        .replace_all(text, |captures: &regex::Captures<'_>| {
            let matched = &captures[0];
            // Opaque errors may contain adjacent URLs without whitespace (for
            // example, serialized JSON). Sanitize each one, including nested URLs.
            let boundaries: Vec<_> = HTTP_SCHEME
                .find_iter(matched)
                .map(|m| m.start())
                .chain(std::iter::once(matched.len()))
                .collect();
            let mut sanitized = String::new();
            for pair in boundaries.windows(2) {
                let part = &matched[pair[0]..pair[1]];
                // Keep punctuation delimiting URLs in common error/debug messages.
                let url =
                    part.trim_end_matches([')', ']', '}', ',', '.', ';', '\'', '"', '>', '\\']);
                sanitized.push_str(&sanitize_url(url));
                sanitized.push_str(&part[url.len()..]);
            }
            sanitized
        })
        .into_owned()
}

fn redact_json(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(text) => *text = redact_text(text),
        serde_json::Value::Array(values) => values.iter_mut().for_each(redact_json),
        serde_json::Value::Object(values) => {
            for (key, mut value) in std::mem::take(values) {
                redact_json(&mut value);
                values.insert(redact_text(&key), value);
            }
        }
        _ => {}
    }
}

/// Keep endpoint information useful for diagnostics without exposing URL credentials.
/// Drop every query parameter, including unknown names, rather than maintaining a
/// denylist of secrets. Invalid and non-HTTP URLs must never fall back to raw input.
fn sanitize_url(raw: &str) -> String {
    let Ok(mut url) = Url::parse(raw) else {
        return "<redacted>".to_owned();
    };
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return "<redacted>".to_owned();
    }
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.into()
}

#[cfg(test)]
mod tests {
    use super::{RedactingFormatter, redact_text, sanitize_url};
    use std::io::{self, Write};
    use std::sync::{Arc, Mutex};
    use tracing_subscriber::Layer;
    use tracing_subscriber::layer::SubscriberExt;

    struct BrokenFormatter(bool);

    impl<S, N> super::FormatEvent<S, N> for BrokenFormatter
    where
        S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
        N: for<'a> super::FormatFields<'a> + 'static,
    {
        fn format_event(
            &self,
            _: &super::FmtContext<'_, S, N>,
            mut writer: super::Writer<'_>,
            _: &tracing::Event<'_>,
        ) -> std::fmt::Result {
            writer.write_str("partially formatted https://example.com/?secret=hidden")?;
            if self.0 { Err(std::fmt::Error) } else { Ok(()) }
        }
    }

    #[test]
    fn formatter_failures_never_fall_back_to_raw_fields() {
        for fail_formatting in [false, true] {
            let capture = Capture::default();
            let writer = capture.clone();
            let subscriber = tracing_subscriber::registry().with(
                tracing_subscriber::fmt::layer()
                    .event_format(RedactingFormatter::new(
                        BrokenFormatter(fail_formatting),
                        true,
                    ))
                    .with_writer(move || writer.clone()),
            );
            tracing::subscriber::with_default(subscriber, || {
                tracing::warn!("https://example.com/?secret=hidden");
            });
            let output = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
            assert!(!output.contains("secret"));
            assert!(!output.contains("hidden"));
            let value: serde_json::Value = serde_json::from_str(&output).unwrap();
            assert_eq!(value["message"], "Log event omitted: formatting failed");
        }
    }

    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<u8>>>);

    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn global_formatter_redacts_dependency_errors_and_span_fields() {
        for json in [false, true] {
            let capture = Capture::default();
            let writer = capture.clone();
            let layer = if json {
                tracing_subscriber::fmt::layer()
                    .json()
                    .event_format(RedactingFormatter::new(
                        tracing_subscriber::fmt::format().json(),
                        true,
                    ))
                    .with_writer(move || writer.clone())
                    .boxed()
            } else {
                tracing_subscriber::fmt::layer()
                    .event_format(RedactingFormatter::new(
                        tracing_subscriber::fmt::format().compact(),
                        false,
                    ))
                    .with_writer(move || writer.clone())
                    .boxed()
            };
            let subscriber = tracing_subscriber::registry().with(layer);
            tracing::subscriber::with_default(subscriber, || {
                let span = tracing::info_span!(
                    "connection",
                    endpoint = "https://span-user:span-password@example.com/mcp?span-token=hidden",
                    updated = tracing::field::Empty,
                );
                span.record("updated", "https://example.com/sse?updated-secret=hidden");
                let _entered = span.enter();
                let error = "request failed for URL (https://user:password@example.com/mcp?opaque-secret=hidden#fragment-secret)";
                tracing::warn!(target: "third_party_client", error = %error, debug_error = ?error, attempts = 3, retry = true, "Opaque error: {error}");
            });
            let output = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
            for secret in [
                "user:",
                "password",
                "span-token",
                "updated-secret",
                "opaque-secret",
                "fragment-secret",
                "hidden",
            ] {
                assert!(!output.contains(secret), "leaked {secret}: {output}");
            }
            assert!(output.contains("https://example.com/mcp"));
            assert!(output.contains("https://example.com/sse"));
            assert!(output.contains("third_party_client"));
            if json {
                let value: serde_json::Value = serde_json::from_str(&output).unwrap();
                assert_eq!(value["fields"]["attempts"], 3);
                assert_eq!(value["fields"]["retry"], true);
                assert_eq!(value["span"]["endpoint"], "https://example.com/mcp");
            }
        }
    }

    #[test]
    fn redacts_multiple_embedded_urls_and_preserves_surrounding_text() {
        assert_eq!(
            redact_text(
                "failed (HTTPS://user:secret@example.com/mcp?key=one), retry https://example.org/sse?key=two."
            ),
            "failed (https://example.com/mcp), retry https://example.org/sse."
        );
        assert_eq!(
            redact_text("invalid https://user:secret@ next"),
            "invalid <redacted> next"
        );
        assert_eq!(
            redact_text("request failed for 'https://user:p'ass@example.com/mcp?token=sec\"ret'"),
            "request failed for 'https://example.com/mcp'"
        );
        assert_eq!(
            redact_text("no URL: café, count=42"),
            "no URL: café, count=42"
        );
    }

    #[test]
    fn sanitizes_mcp_urls() {
        let adjacent = redact_text(
            r#"["https://example.com/a","https://user:password@example.com/b?token=secret"]"#,
        );
        assert!(!adjacent.contains("password"));
        assert!(!adjacent.contains("secret"));
        for (input, expected) in [
            ("https://example.com/mcp", "https://example.com/mcp"),
            ("http://localhost:8080/sse", "http://localhost:8080/sse"),
            (
                "https://user:password@example.com/mcp?api_key=secret&custom=secret#secret",
                "https://example.com/mcp",
            ),
            ("https://user@example.com/mcp", "https://example.com/mcp"),
            (
                "https://example.com/mcp?token=one&token=two&bare#secret",
                "https://example.com/mcp",
            ),
            (
                "https://us%40er:p%40ss@[::1]:8443/mcp?secret=value",
                "https://[::1]:8443/mcp",
            ),
            ("not a URL?token=secret", "<redacted>"),
            ("https://user:secret@", "<redacted>"),
            ("data:text/plain,secret", "<redacted>"),
            ("", "<redacted>"),
        ] {
            assert_eq!(sanitize_url(input), expected);
        }
    }
}
