//! MCP Apps (the `io.modelcontextprotocol/ui` extension, spec 2026-01-26):
//! the interactive view a tool declares in `_meta.ui.resourceUri`, read with
//! `resources/read` from servers that enable `mcp_servers.<id>.mcp_apps`.
//! The web app fetches a view through its own route; the model never sees
//! one, and the tool definitions it is offered are unchanged.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use eyre::{Report, WrapErr, eyre};
use rmcp::model::{ReadResourceResult, ResourceContents, Tool};
use serde_json::Value;
use std::time::Duration;

/// The only MIME type a view is accepted with.
pub const VIEW_MIME_TYPE: &str = "text/html;profile=mcp-app";
/// The most a view may hold, its HTML and `_meta.ui` together: 8 MiB, over
/// twice a view that inlines a charting library (about 3.4 MB).
pub const MAX_VIEW_BYTES: usize = 8 * 1024 * 1024;
/// How long reading a view may take, the bound a stateless tool list has. A
/// tool call waits for its view, so a server that never answers must not
/// hold the call.
pub const VIEW_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a view that was refused or could not be read is left alone, so
/// that a broken view costs one call the wait and not every call.
pub const VIEW_FAILURE_RETRY_AFTER: Duration = Duration::from_secs(5 * 60);
/// The most view bytes kept at once, all servers together. Past it the least
/// used views are dropped and read again when their tool is next called.
pub const VIEW_CACHE_BYTES: u64 = 128 * 1024 * 1024;
/// How many refused or unreadable views are remembered at once.
pub const MAX_REMEMBERED_VIEW_FAILURES: u64 = 10_000;
/// The most of a call's `structuredContent` kept with the call for its view.
pub const MAX_VIEW_STRUCTURED_CONTENT_BYTES: usize = 1024 * 1024;
/// Longest `ui://` URI a tool may name as its view.
const MAX_VIEW_URI_BYTES: usize = 512;

/// The `ui://` view `tool` declares in `_meta.ui.resourceUri`, if it
/// declares a usable one.
pub fn view_uri(tool: &Tool) -> Option<&str> {
    let uri = tool
        .meta
        .as_ref()?
        .get("ui")?
        .get("resourceUri")?
        .as_str()?;
    let usable = uri.len() > "ui://".len()
        && uri.len() <= MAX_VIEW_URI_BYTES
        && uri.starts_with("ui://")
        && !uri.chars().any(char::is_control);
    usable.then_some(uri)
}

/// A view as read and accepted.
#[derive(Debug, Clone, PartialEq, erato_memory::HeapSize)]
pub struct McpAppView {
    pub uri: String,
    /// The view document. Only ever shown inside the sandbox origin, never
    /// on Erato's own.
    pub html: String,
    /// The resource's `_meta.ui` as the server declared it, when it is an
    /// object: the CSP the view needs (`csp`), the permissions it asks for
    /// and how it prefers to be shown.
    pub ui: Option<Value>,
}

impl McpAppView {
    /// The view at `uri` from its `resources/read` result: the first content,
    /// as text or base64, with the MIME type `text/html;profile=mcp-app` and
    /// at most `MAX_VIEW_BYTES`.
    pub fn from_read_result(uri: &str, result: ReadResourceResult) -> Result<Self, Report> {
        let content = result
            .contents
            .into_iter()
            .next()
            .ok_or_else(|| eyre!("the resource has no contents"))?;
        let (mime_type, html, meta) = match content {
            ResourceContents::TextResourceContents {
                mime_type,
                text,
                meta,
                ..
            } => (mime_type, text, meta),
            ResourceContents::BlobResourceContents {
                mime_type,
                blob,
                meta,
                ..
            } => {
                if blob.len() / 4 * 3 > MAX_VIEW_BYTES {
                    return Err(too_large(blob.len() / 4 * 3));
                }
                let bytes = STANDARD
                    .decode(blob)
                    .wrap_err("the view is not valid base64")?;
                let html = String::from_utf8(bytes).wrap_err("the view is not UTF-8")?;
                (mime_type, html, meta)
            }
            _ => return Err(eyre!("the resource has contents of an unknown kind")),
        };
        if !mime_type.as_deref().is_some_and(is_view_mime_type) {
            return Err(eyre!(
                "the view's MIME type is {mime_type:?}, not {VIEW_MIME_TYPE}"
            ));
        }
        let ui = meta
            .and_then(|meta| meta.get("ui").cloned())
            .filter(Value::is_object);
        let size = html.len() + ui.as_ref().map_or(0, |ui| ui.to_string().len());
        if size > MAX_VIEW_BYTES {
            return Err(too_large(size));
        }
        Ok(Self {
            uri: uri.to_owned(),
            html,
            ui,
        })
    }
}

/// A call's `structuredContent` as its view gets it: an object of at most
/// `MAX_VIEW_STRUCTURED_CONTENT_BYTES`, or nothing.
pub fn structured_content_for_view(structured_content: Option<&Value>) -> Option<Value> {
    let value = structured_content.filter(|value| value.is_object())?;
    let size = value.to_string().len();
    if size > MAX_VIEW_STRUCTURED_CONTENT_BYTES {
        tracing::warn!(
            size,
            "structuredContent is larger than the {MAX_VIEW_STRUCTURED_CONTENT_BYTES} bytes kept for a view; the view gets the result's text only"
        );
        return None;
    }
    Some(value.clone())
}

fn too_large(size: usize) -> Report {
    eyre!("the view is {size} bytes, more than the {MAX_VIEW_BYTES} kept")
}

/// Whether `value` is `text/html;profile=mcp-app`, ignoring case and spaces.
fn is_view_mime_type(value: &str) -> bool {
    value
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect::<String>()
        .eq_ignore_ascii_case(VIEW_MIME_TYPE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::JsonObject;
    use serde_json::json;

    fn tool_with_meta(meta: Value) -> Tool {
        let mut tool = Tool::new("show_counter", "Shows a counter", JsonObject::new());
        tool.meta = Some(rmcp::model::MetaObject(meta.as_object().unwrap().clone()));
        tool
    }

    fn read_result(content: Value) -> ReadResourceResult {
        serde_json::from_value(json!({"contents": [content]})).unwrap()
    }

    const URI: &str = "ui://mock/counter";

    #[test]
    fn a_tool_declares_its_view_with_a_ui_uri_in_its_meta() {
        let declared = tool_with_meta(json!({"ui": {"resourceUri": URI}}));
        assert_eq!(view_uri(&declared), Some(URI));
        let long = format!("ui://mock/{}", "a".repeat(MAX_VIEW_URI_BYTES));
        for meta in [
            json!({}),
            json!({"ui": {}}),
            json!({"ui": {"resourceUri": 7}}),
            json!({"ui": {"resourceUri": "https://example.com/view"}}),
            json!({"ui": {"resourceUri": "ui://"}}),
            json!({"ui": {"resourceUri": "ui://mock/\ncounter"}}),
            json!({"ui": {"resourceUri": long}}),
            // The flat key the spec deprecates.
            json!({"ui/resourceUri": URI}),
        ] {
            assert_eq!(view_uri(&tool_with_meta(meta.clone())), None, "{meta}");
        }
        assert_eq!(
            view_uri(&Tool::new("plain", "Plain", JsonObject::new())),
            None
        );
    }

    #[test]
    fn a_view_keeps_its_html_and_its_ui_meta() {
        let ui =
            json!({"csp": {"connectDomains": ["https://api.example.com"]}, "prefersBorder": true});
        let view = McpAppView::from_read_result(
            URI,
            read_result(json!({"uri": URI, "mimeType": "text/html;profile=mcp-app",
                "text": "<p>count</p>", "_meta": {"ui": ui, "other": 1}})),
        )
        .unwrap();
        assert_eq!(
            view,
            McpAppView {
                uri: URI.into(),
                html: "<p>count</p>".into(),
                ui: Some(ui),
            }
        );

        let blob = McpAppView::from_read_result(
            URI,
            read_result(json!({"uri": URI, "mimeType": "Text/HTML; profile=mcp-app",
                "blob": STANDARD.encode("<p>blob</p>"), "_meta": {"ui": "not an object"}})),
        )
        .unwrap();
        assert_eq!(blob.html, "<p>blob</p>");
        assert_eq!(blob.ui, None);
    }

    #[test]
    fn a_view_of_another_type_or_too_large_is_refused() {
        for mime_type in [
            json!("text/html"),
            json!("text/html;profile=other"),
            json!(null),
        ] {
            let error = McpAppView::from_read_result(
                URI,
                read_result(json!({"uri": URI, "mimeType": mime_type, "text": "<p>x</p>"})),
            )
            .unwrap_err();
            assert!(error.to_string().contains("MIME type"), "{error}");
        }

        let at_limit = "x".repeat(MAX_VIEW_BYTES);
        assert!(
            McpAppView::from_read_result(
                URI,
                read_result(json!({"uri": URI, "mimeType": VIEW_MIME_TYPE, "text": at_limit})),
            )
            .is_ok()
        );
        let over = "x".repeat(MAX_VIEW_BYTES + 1);
        for content in [
            json!({"uri": URI, "mimeType": VIEW_MIME_TYPE, "text": over}),
            json!({"uri": URI, "mimeType": VIEW_MIME_TYPE, "blob": STANDARD.encode(&over)}),
            json!({"uri": URI, "mimeType": VIEW_MIME_TYPE, "text": "x".repeat(MAX_VIEW_BYTES - 4),
                "_meta": {"ui": {"csp": {}}}}),
        ] {
            let error = McpAppView::from_read_result(URI, read_result(content)).unwrap_err();
            assert!(error.to_string().contains("more than"), "{error}");
        }
        assert!(
            McpAppView::from_read_result(
                URI,
                serde_json::from_value(json!({"contents": []})).unwrap()
            )
            .is_err()
        );
    }

    #[test]
    fn a_view_gets_structured_content_only_as_an_object_within_the_limit() {
        let object = json!({"series": [1, 2, 3]});
        assert_eq!(
            structured_content_for_view(Some(&object)),
            Some(object.clone())
        );
        assert_eq!(structured_content_for_view(None), None);
        assert_eq!(structured_content_for_view(Some(&json!([1, 2, 3]))), None);
        let large = json!({"text": "x".repeat(MAX_VIEW_STRUCTURED_CONTENT_BYTES)});
        assert_eq!(structured_content_for_view(Some(&large)), None);
    }
}
