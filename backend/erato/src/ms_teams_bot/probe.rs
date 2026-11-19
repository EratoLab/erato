//! Temporary ERMAIN-1253 staging probe. Only fixed labels and shape data cross
//! the logging boundary. Task-local scope follows one accepted activity.
use super::activity::{Activity, TEAMS_FILE_DOWNLOAD_INFO};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::LazyLock;
use uuid::Uuid;

/// One accepted personal-chat message, explicitly marked by the sender.
pub(super) fn capture_marked_html(activity: &Activity) {
    let Ok(config) = std::env::var("ERATO_TEAMS_HTML_CAPTURE") else {
        return;
    };
    let mut parts = config.split('|');
    let (Some(chat), Some(marker), Some(end), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return;
    };
    let Ok(end) = end.parse::<i64>() else { return };
    if chrono::Utc::now().timestamp() >= end {
        return;
    }
    let Some(html) = marked_html(activity, chat, marker) else {
        return;
    };
    let path = Path::new("/tmp/erato-teams-html-capture.json");
    match save_html(path, &html) {
        Ok(()) => {
            tracing::warn!("Marked Teams HTML capture ready");
            tokio::spawn(async move {
                let seconds = end.saturating_sub(chrono::Utc::now().timestamp()).max(0) as u64;
                tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
                let _ = tokio::fs::remove_file(path).await;
            });
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => tracing::warn!("Marked Teams HTML capture could not be saved"),
    }
}

fn marked_html<'a>(activity: &'a Activity, chat: &str, marker: &str) -> Option<Vec<&'a str>> {
    if activity.kind != "message"
        || activity.conversation.as_ref()?.conversation_type.as_deref() != Some("personal")
        || URL_SAFE_NO_PAD.encode(Sha256::digest(activity.conversation_id()?.as_bytes())) != chat
        || Uuid::parse_str(marker).is_err()
        || !activity.text.as_deref()?.contains(marker)
    {
        return None;
    }
    Some(
        activity
            .attachments
            .iter()
            .filter(|a| a.content_type.eq_ignore_ascii_case("text/html"))
            .filter_map(|a| a.content.as_ref()?.as_str())
            .collect(),
    )
}

// The private file becomes visible only after every string has been written.
// JSON preserves the exact string boundaries, whitespace and HTML entities.
fn save_html(path: &Path, html: &[&str]) -> std::io::Result<()> {
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().expect("capture directory"))?;
    serde_json::to_writer(tmp.as_file_mut(), html)?;
    tmp.persist_noclobber(path)?;
    Ok(())
}

tokio::task_local! { pub(super) static TOKEN: Uuid; }
tokio::task_local! { pub(super) static FILE: usize; }

macro_rules! event {
    ($($fields:tt)*) => {
        let _ = $crate::ms_teams_bot::probe::TOKEN.try_with(|token| {
            tracing::warn!(name: "teams_attachment_probe", correlation = %token, $($fields)*, "teams_attachment_probe");
        });
    };
}
pub(super) use event;

pub(super) fn decision(reason: &'static str) {
    event!(stage = "handler", reason);
}

pub(super) fn classify(ordinal: usize, reason: &'static str) {
    event!(stage = "classifier", ordinal, reason);
}

pub(super) fn result<T, E>(stage: &'static str, result: Result<T, E>) -> Result<T, E> {
    let _ = FILE.try_with(|ordinal| {
        event!(stage, ordinal, success = result.is_ok());
    });
    result
}

pub(super) fn http(status: reqwest::StatusCode) {
    let _ = FILE.try_with(|ordinal| {
        event!(
            stage = "http",
            ordinal,
            status_class = status.as_u16() / 100
        );
    });
}

fn content_type(value: &Value) -> &'static str {
    match value.as_str() {
        Some(TEAMS_FILE_DOWNLOAD_INFO) => "download_info",
        Some("reference") => "reference",
        Some("text/html") => "html",
        Some(t) if t.starts_with("image/") => "image",
        _ => "other",
    }
}

fn json_kind(value: Option<&Value>) -> &'static str {
    match value {
        None => "absent",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

#[derive(Default)]
struct Signals {
    placeholder: bool,
    sharepoint: bool,
    onedrive: bool,
    other: bool,
}

impl Signals {
    fn scan(&mut self, value: &Value) {
        match value {
            Value::String(s) => {
                static LINKS: LazyLock<Regex> = LazyLock::new(|| {
                    Regex::new(r#"(?i)https?://[^\s<>"']+"#).expect("fixed URL pattern")
                });
                let lower = s.to_ascii_lowercase();
                self.placeholder |= lower.contains("<attachment") || lower.contains("<file");
                for candidate in LINKS.find_iter(s) {
                    let url = url::Url::parse(candidate.as_str()).ok();
                    let host = url.as_ref().and_then(url::Url::host_str).unwrap_or("");
                    if host == "1drv.ms"
                        || host == "onedrive.live.com"
                        || host.ends_with("-my.sharepoint.com")
                    {
                        self.onedrive = true;
                    } else if host == "sharepoint.com" || host.ends_with(".sharepoint.com") {
                        self.sharepoint = true;
                    } else {
                        self.other = true;
                    }
                }
            }
            Value::Object(map) => map.values().for_each(|v| self.scan(v)),
            Value::Array(items) => items.iter().for_each(|v| self.scan(v)),
            _ => {}
        }
    }

    fn emit(&self, source: &'static str, ordinal: Option<usize>) {
        event!(
            stage = "signals",
            source,
            ordinal,
            placeholder = self.placeholder,
            sharepoint = self.sharepoint,
            onedrive = self.onedrive,
            other = self.other,
            absent = !(self.sharepoint || self.onedrive || self.other)
        );
    }
}

pub(super) fn receipt(body: &[u8]) {
    let Ok(raw) = serde_json::from_slice::<Value>(body) else {
        return;
    };
    let attachments = raw["attachments"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let kind = match raw["type"].as_str() {
        Some("message") => "message",
        Some("messageUpdate") => "messageUpdate",
        _ => return,
    };
    let conversation = match raw
        .pointer("/conversation/conversationType")
        .and_then(Value::as_str)
    {
        Some("personal") => "personal",
        Some("groupChat") => "groupChat",
        Some("channel") => "channel",
        _ => "other",
    };
    event!(
        stage = "receipt",
        kind,
        conversation,
        attachments = attachments.len(),
        entities = raw["entities"].as_array().map_or(0, Vec::len)
    );
    for key in ["text", "entities", "channelData"] {
        let mut signals = Signals::default();
        signals.scan(&raw[key]);
        signals.emit(key, None);
    }
    for (ordinal, a) in attachments.iter().enumerate() {
        let ty = content_type(&a["contentType"]);
        event!(
            stage = "attachment",
            ordinal,
            content_type = ty,
            content_kind = json_kind(a.get("content")),
            content_url = a.get("contentUrl").is_some(),
            download_url = a.pointer("/content/downloadUrl").is_some(),
            unique_id = a.pointer("/content/uniqueId").is_some(),
            file_type = a.pointer("/content/fileType").is_some()
        );
        for (source, v) in [
            ("contentUrl", &a["contentUrl"]),
            ("downloadUrl", &a["content"]["downloadUrl"]),
        ] {
            let mut signals = Signals::default();
            signals.scan(v);
            signals.emit(source, Some(ordinal));
        }
        if ty == "html" {
            let mut signals = Signals::default();
            signals.scan(&a["content"]);
            signals.emit("html", Some(ordinal));
        }
    }
}

pub(super) fn spawn(token: Option<Uuid>, handler: impl Future<Output = ()> + Send + 'static) {
    if let Some(token) = token {
        tokio::spawn(TOKEN.scope(token, handler));
    } else {
        tokio::spawn(handler);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ms_teams_bot::activity::Activity;
    use serde_json::json;
    use std::io::{Read, Seek};

    #[test]
    fn marked_html_is_scoped_exact_and_write_once() {
        let marker = Uuid::new_v4().to_string();
        let chat = URL_SAFE_NO_PAD.encode(Sha256::digest(b"test-chat"));
        let body = " <p data-id=\"YWJj\">&amp;&#65;\r\nλ</p> ";
        let mut activity: Activity = serde_json::from_value(json!({
            "type":"message", "conversation":{"id":"test-chat","conversationType":"personal"},
            "text":marker, "attachments":[{"contentType":"text/html","content":body},
                {"contentType":"reference","contentUrl":"https://unrelated.test/"},
                {"contentType":"text/html","content":""}]
        }))
        .unwrap();
        assert!(marked_html(&activity, "another-chat", &marker).is_none());
        assert!(marked_html(&activity, &chat, &Uuid::new_v4().to_string()).is_none());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("capture.json");
        save_html(&path, &marked_html(&activity, &chat, &marker).unwrap()).unwrap();
        assert_eq!(
            save_html(&path, &["replacement"]).unwrap_err().kind(),
            std::io::ErrorKind::AlreadyExists
        );
        let captured: Vec<String> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(captured, [body, ""]);
        activity.kind = "messageUpdate".into();
        assert!(marked_html(&activity, &chat, &marker).is_none());
    }

    #[test]
    fn serialized_probe_covers_picker_shapes_without_logging_content() {
        let filename = "SENTINEL-private.png";
        let token = "Bearer SENTINEL-credential";
        let url = "https://tenant-my.sharepoint.com/SENTINEL-path?private=SENTINEL-query";
        let raw = json!({
            "type": "message", "text": format!("{token} {url}"),
            "attachments": [
                {"name": filename, "contentType": TEAMS_FILE_DOWNLOAD_INFO, "content": {"downloadUrl": url}},
                {"contentType": "reference", "contentUrl": url},
                {"contentType": "image/png", "contentUrl": url},
                {"contentType": "reference"}, {"contentType": TEAMS_FILE_DOWNLOAD_INFO},
                {"contentType": "image/png"},
                {"contentType": "text/html", "content": format!("<attachment id='{filename}'><a href='{url}'>")},
                {"contentType": filename}
            ]
        });
        let mut capture = tempfile::tempfile().unwrap();
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_writer(capture.try_clone().unwrap())
            .finish();
        let correlation = Uuid::new_v4();
        tracing::subscriber::with_default(subscriber, || {
            TOKEN.sync_scope(correlation, || {
                for (body, count) in [
                    (raw, 3),
                    // Observed when selecting a DOCX from Recent Cloud File in a personal chat.
                    // The caption and entity below are synthetic.
                    (json!({
                        "type": "message",
                        "conversation": {"conversationType": "personal"},
                        "text": "Document test",
                        "attachments": [{"contentType":"text/html","content":"<p>Document test</p>"}],
                        "entities": [{"type":"clientInfo"}]
                    }), 0),
                    (json!({"type":"messageUpdate", "attachments":[]}), 0),
                    (json!({"type":"message","text":url}), 0),
                ] {
                    receipt(&serde_json::to_vec(&body).unwrap());
                    let activity: Activity = serde_json::from_value(body).unwrap();
                    assert_eq!(activity.incoming_files().len(), count);
                }
            });
        });
        capture.rewind().unwrap();
        let mut log = String::new();
        capture.read_to_string(&mut log).unwrap();
        for secret in [filename, token, url, "SENTINEL", "tenant-my", "private="] {
            assert!(!log.contains(secret));
        }
        let events: Vec<Value> = log
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap()["fields"].clone())
            .collect();
        assert!(
            events
                .iter()
                .all(|e| e["correlation"] == correlation.to_string())
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| e["stage"] == "receipt" && e["attachments"] == 0)
                .count(),
            2
        );
        assert!(
            events
                .iter()
                .any(|e| e["source"] == "html" && e["placeholder"] == false && e["absent"] == true)
        );
        let reasons: Vec<_> = events
            .iter()
            .filter(|e| e["stage"] == "classifier")
            .map(|e| e["reason"].as_str().unwrap())
            .collect();
        assert_eq!(
            reasons,
            [
                "download_info",
                "reference",
                "inline_image",
                "missing_content_url",
                "missing_download_url",
                "missing_content_url",
                "unsupported",
                "unsupported",
                "unsupported"
            ]
        );
        assert!(
            events.iter().any(|e| e["source"] == "html"
                && e["onedrive"] == true
                && e["placeholder"] == true)
        );
    }
}
