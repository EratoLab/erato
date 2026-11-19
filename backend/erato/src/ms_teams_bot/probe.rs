//! Temporary ERMAIN-1253 staging probe. Only fixed labels and shape data cross
//! the logging boundary. Task-local scope follows one accepted activity.
use super::activity::TEAMS_FILE_DOWNLOAD_INFO;
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;
use uuid::Uuid;

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
