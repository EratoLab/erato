//! Teams transcripts carry a machine-readable index block (see
//! `frontend/src/utils/teams/teamsTranscriptIndex.ts`). This condenses it into what a
//! message needs to render the conversation without downloading the transcript.

use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

/// Names the index block the Teams picker and the desktop sidecar append to a transcript.
pub const TEAMS_TRANSCRIPT_INDEX_MARKER: &str = "erato:teams-transcript";

const SUPPORTED_INDEX_VERSION: u32 = 1;

/// The index block ends the file; a block larger than this yields no summary.
const TRANSCRIPT_TAIL_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TeamsTranscriptSummary {
    /// One entry per conversation in the transcript, in transcript order.
    pub sections: Vec<TeamsTranscriptSummarySection>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TeamsTranscriptSummarySection {
    pub kind: TeamsConversationKind,
    /// Chat title, or the channel's own name.
    pub title: String,
    pub team_name: Option<String>,
    pub selection: TeamsTranscriptSelection,
    /// Whether messages outside the exported window were left out.
    pub truncated: bool,
    pub skipped_count: u32,
    pub message_count: u32,
    pub window: TeamsTranscriptSummaryWindow,
    pub participants: Vec<String>,
    /// Uploads shared in this section's messages, in message order.
    pub assets: Vec<TeamsTranscriptSummaryAsset>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TeamsTranscriptSummaryWindow {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TeamsTranscriptSummaryAsset {
    /// Uploaded filename; the key the transcript joins files to messages by.
    pub name: String,
    /// The name Teams gave the file; null for a pasted image.
    pub display_name: Option<String>,
    pub kind: TeamsTranscriptAssetKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TeamsConversationKind {
    Chat,
    Channel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TeamsTranscriptSelection {
    WholeChat,
    Messages,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TeamsTranscriptAssetKind {
    Image,
    File,
}

/// Whether an upload with this name could be a transcript worth summarizing.
pub fn may_carry_teams_transcript(filename: &str) -> bool {
    let Some((_, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "md" | "markdown" | "txt"
    )
}

/// Keeps the end of an upload stream, where the index block sits, so a transcript can be
/// summarized without holding the whole file.
#[derive(Debug)]
pub struct TranscriptTail {
    bytes: Vec<u8>,
    limit: usize,
}

impl Default for TranscriptTail {
    fn default() -> Self {
        Self::with_limit(TRANSCRIPT_TAIL_BYTES)
    }
}

impl TranscriptTail {
    fn with_limit(limit: usize) -> Self {
        Self {
            bytes: Vec::new(),
            limit,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
        if self.bytes.len() > 2 * self.limit {
            let excess = self.bytes.len() - self.limit;
            self.bytes.drain(..excess);
        }
    }

    pub fn summarize(&self) -> Option<TeamsTranscriptSummary> {
        let start = self.bytes.len().saturating_sub(self.limit);
        summarize_teams_transcript(&String::from_utf8_lossy(&self.bytes[start..]))
    }
}

/// Summarizes the transcript's last intact index block. Like the frontend parser this is
/// all-or-nothing: a block it cannot fully read yields `None`, never a partial summary.
pub fn summarize_teams_transcript(text: &str) -> Option<TeamsTranscriptSummary> {
    if !text.contains(TEAMS_TRANSCRIPT_INDEX_MARKER) {
        return None;
    }
    let payload = text.rsplit('\n').find_map(index_payload)?;
    let index: Index = serde_json::from_str(payload).ok()?;
    summarize_index(index)
}

/// The serializer writes the block as one line, so a block never spans lines; prose that
/// merely names the marker cannot reach a block further down the file.
fn index_payload(line: &str) -> Option<&str> {
    line.rmatch_indices(TEAMS_TRANSCRIPT_INDEX_MARKER)
        .find_map(|(at, marker)| {
            if !line[..at].trim_end().ends_with("<!--") {
                return None;
            }
            let after = &line[at + marker.len()..];
            let version = after.trim_start();
            if version.len() == after.len() {
                return None;
            }
            let digits = version.strip_prefix('v')?;
            let digits_len = digits
                .find(|char: char| !char.is_ascii_digit())
                .unwrap_or(digits.len());
            if digits_len == 0 {
                return None;
            }
            let rest = &digits[digits_len..];
            if !rest.starts_with(char::is_whitespace) {
                return None;
            }
            rest.find("-->").map(|end| &rest[..end])
        })
}

fn summarize_index(index: Index) -> Option<TeamsTranscriptSummary> {
    if index.version != SUPPORTED_INDEX_VERSION || index.sections.is_empty() {
        return None;
    }
    let mut message_counts = vec![0u32; index.sections.len()];
    let mut assets: Vec<Vec<TeamsTranscriptSummaryAsset>> = vec![Vec::new(); index.sections.len()];
    for message in index.messages {
        let section = usize::try_from(message.section)
            .ok()
            .filter(|section| *section < index.sections.len())?;
        message_counts[section] = message_counts[section].saturating_add(1);
        assets[section].extend(message.assets.into_iter().map(|asset| {
            TeamsTranscriptSummaryAsset {
                name: asset.name,
                display_name: asset.display_name,
                kind: asset.kind,
            }
        }));
    }
    let sections = index
        .sections
        .into_iter()
        .zip(message_counts)
        .zip(assets)
        .map(
            |((section, message_count), assets)| TeamsTranscriptSummarySection {
                kind: section.kind,
                title: section.title,
                team_name: section.team_name,
                selection: section.selection,
                truncated: section.truncated,
                skipped_count: section.skipped_count,
                message_count,
                window: TeamsTranscriptSummaryWindow {
                    from: section.window.from,
                    to: section.window.to,
                },
                participants: section.participants,
                assets,
            },
        )
        .collect();
    Some(TeamsTranscriptSummary { sections })
}

/// Fields the frontend parser requires are required here too, so both sides agree on
/// which files are transcripts; the ones it reads leniently map anything else to `None`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    version: u32,
    #[serde(rename = "exportedAt")]
    _exported_at: String,
    #[serde(rename = "timeZone")]
    _time_zone: String,
    sections: Vec<IndexSection>,
    messages: Vec<IndexMessage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexSection {
    kind: TeamsConversationKind,
    #[serde(rename = "ref")]
    _conversation: IndexConversationRef,
    title: String,
    #[serde(default, deserialize_with = "lenient_string")]
    team_name: Option<String>,
    selection: TeamsTranscriptSelection,
    truncated: bool,
    skipped_count: u32,
    window: IndexWindow,
    participants: Vec<String>,
}

#[derive(Deserialize)]
struct IndexWindow {
    #[serde(default, deserialize_with = "lenient_string")]
    from: Option<String>,
    #[serde(default, deserialize_with = "lenient_string")]
    to: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum IndexConversationRef {
    Chat {
        #[serde(rename = "chatId")]
        _chat_id: String,
    },
    Channel {
        #[serde(rename = "teamId")]
        _team_id: String,
        #[serde(rename = "channelId")]
        _channel_id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexMessage {
    #[serde(rename = "ordinal")]
    _ordinal: f64,
    section: i64,
    #[serde(rename = "ref")]
    _message: IndexMessageRef,
    #[serde(rename = "sender")]
    _sender: String,
    #[serde(rename = "deepLink")]
    _deep_link: String,
    #[serde(rename = "text")]
    _text: String,
    assets: Vec<IndexAsset>,
}

#[derive(Deserialize)]
struct IndexMessageRef {
    #[serde(rename = "conversation")]
    _conversation: IndexConversationRef,
    #[serde(rename = "messageId")]
    _message_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexAsset {
    name: String,
    #[serde(default, deserialize_with = "lenient_string")]
    display_name: Option<String>,
    kind: TeamsTranscriptAssetKind,
}

fn lenient_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value {
        serde_json::Value::String(value) => Some(value),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn index() -> serde_json::Value {
        let chat = json!({ "kind": "chat", "chatId": "19:chat" });
        let channel = json!({ "kind": "channel", "teamId": "team-1", "channelId": "chan-1" });
        json!({
            "version": 1,
            "exportedAt": "2026-03-02T00:00:00Z",
            "timeZone": "Europe/Berlin",
            "sections": [
                {
                    "kind": "chat",
                    "ref": chat,
                    "title": "Product sync",
                    "teamName": null,
                    "selection": "whole-chat",
                    "limit": 200,
                    "truncated": true,
                    "skippedCount": 1,
                    "window": { "from": "2026-03-01T08:00:00Z", "to": "2026-03-01T09:00:00Z" },
                    "participants": ["Ada Lovelace", "Grace Hopper"],
                    "viewer": "Ada Lovelace"
                },
                {
                    "kind": "channel",
                    "ref": channel,
                    "title": "Releases",
                    "teamName": "Contoso",
                    "selection": "messages",
                    "limit": null,
                    "truncated": false,
                    "skippedCount": 0,
                    "window": { "from": null, "to": null },
                    "participants": [],
                    "viewer": null
                }
            ],
            "messages": [
                message(0, &chat, "m1", json!([
                    { "name": "teams-img-0123456789abcdef.png", "displayName": null, "kind": "image" }
                ])),
                message(0, &chat, "m2", json!([
                    { "name": "teams-file-0123abcd-Q3_report.pdf", "displayName": "Q3 report.pdf", "kind": "file" }
                ])),
                message(1, &channel, "m3", json!([])),
            ]
        })
    }

    fn message(
        section: usize,
        conversation: &serde_json::Value,
        id: &str,
        assets: serde_json::Value,
    ) -> serde_json::Value {
        json!({
            "ordinal": section + 1,
            "section": section,
            "ref": { "conversation": conversation, "messageId": id, "parentMessageId": null },
            "sender": "Ada Lovelace",
            "createdAt": "2026-03-01T08:00:00Z",
            "editedAt": null,
            "subject": null,
            "deepLink": format!("https://teams.microsoft.com/l/message/19:chat/{id}"),
            "text": "Ship it --> today",
            "assets": assets
        })
    }

    /// Mirrors the add-in serializer: one line, `-` of every `--` escaped.
    fn block(index: &serde_json::Value) -> String {
        let payload = serde_json::to_string(index)
            .unwrap()
            .replace("--", "\\u002d-");
        format!("<!-- {TEAMS_TRANSCRIPT_INDEX_MARKER} v1 {payload} -->")
    }

    fn transcript(index: &serde_json::Value) -> String {
        format!(
            "# Product sync\n\n[1] Ada Lovelace: Ship it\n\n{}\n",
            block(index)
        )
    }

    #[test]
    fn summarizes_sections_counts_and_assets() {
        let summary = summarize_teams_transcript(&transcript(&index())).unwrap();

        assert_eq!(
            summary,
            TeamsTranscriptSummary {
                sections: vec![
                    TeamsTranscriptSummarySection {
                        kind: TeamsConversationKind::Chat,
                        title: "Product sync".into(),
                        team_name: None,
                        selection: TeamsTranscriptSelection::WholeChat,
                        truncated: true,
                        skipped_count: 1,
                        message_count: 2,
                        window: TeamsTranscriptSummaryWindow {
                            from: Some("2026-03-01T08:00:00Z".into()),
                            to: Some("2026-03-01T09:00:00Z".into()),
                        },
                        participants: vec!["Ada Lovelace".into(), "Grace Hopper".into()],
                        assets: vec![
                            TeamsTranscriptSummaryAsset {
                                name: "teams-img-0123456789abcdef.png".into(),
                                display_name: None,
                                kind: TeamsTranscriptAssetKind::Image,
                            },
                            TeamsTranscriptSummaryAsset {
                                name: "teams-file-0123abcd-Q3_report.pdf".into(),
                                display_name: Some("Q3 report.pdf".into()),
                                kind: TeamsTranscriptAssetKind::File,
                            },
                        ],
                    },
                    TeamsTranscriptSummarySection {
                        kind: TeamsConversationKind::Channel,
                        title: "Releases".into(),
                        team_name: Some("Contoso".into()),
                        selection: TeamsTranscriptSelection::Messages,
                        truncated: false,
                        skipped_count: 0,
                        message_count: 1,
                        window: TeamsTranscriptSummaryWindow {
                            from: None,
                            to: None,
                        },
                        participants: vec![],
                        assets: vec![],
                    },
                ],
            }
        );
    }

    #[test]
    fn serializes_with_the_api_field_names() {
        let summary = summarize_teams_transcript(&transcript(&index())).unwrap();
        let value = serde_json::to_value(&summary).unwrap();

        assert_eq!(value["sections"][0]["selection"], "whole-chat");
        assert_eq!(value["sections"][0]["team_name"], serde_json::Value::Null);
        assert_eq!(value["sections"][0]["message_count"], 2);
        assert_eq!(
            value["sections"][0]["assets"][1]["display_name"],
            "Q3 report.pdf"
        );
        assert_eq!(value["sections"][1]["kind"], "channel");
    }

    #[test]
    fn ignores_prose_that_names_the_marker() {
        let text = format!(
            "We should call it {TEAMS_TRANSCRIPT_INDEX_MARKER} v1 {{\"version\":1}} -->\n{}\n",
            block(&index())
        );
        assert!(summarize_teams_transcript(&text).is_some());

        let prose_only = format!("We should call it {TEAMS_TRANSCRIPT_INDEX_MARKER} v1 {{}} -->\n");
        assert_eq!(summarize_teams_transcript(&prose_only), None);
    }

    #[test]
    fn last_block_wins() {
        let mut later = index();
        later["sections"][0]["title"] = json!("Later");
        let text = format!("{}\n{}\n", block(&index()), block(&later));

        let summary = summarize_teams_transcript(&text).unwrap();
        assert_eq!(summary.sections[0].title, "Later");
    }

    #[test]
    fn rejects_unsupported_or_inconsistent_blocks() {
        let mut wrong_version = index();
        wrong_version["version"] = json!(2);
        assert_eq!(
            summarize_teams_transcript(&transcript(&wrong_version)),
            None
        );

        let mut out_of_range = index();
        out_of_range["messages"][2]["section"] = json!(2);
        assert_eq!(summarize_teams_transcript(&transcript(&out_of_range)), None);

        let mut no_sections = index();
        no_sections["sections"] = json!([]);
        no_sections["messages"] = json!([]);
        assert_eq!(summarize_teams_transcript(&transcript(&no_sections)), None);

        let mut missing_sender = index();
        missing_sender["messages"][0]
            .as_object_mut()
            .unwrap()
            .remove("sender");
        assert_eq!(
            summarize_teams_transcript(&transcript(&missing_sender)),
            None
        );

        assert_eq!(
            summarize_teams_transcript("# Notes\n\nNothing to see here.\n"),
            None
        );
    }

    #[test]
    fn tail_keeps_the_block_at_the_end_of_a_long_upload() {
        let mut tail = TranscriptTail::with_limit(64 * 1024);
        let prose = "[1] Ada Lovelace: Ship it\n".repeat(20_000);
        let text = format!("{prose}\n{}\n", block(&index()));
        assert!(text.len() > 4 * 64 * 1024);

        for chunk in text.as_bytes().chunks(7_919) {
            tail.push(chunk);
        }

        assert!(tail.bytes.len() <= 2 * 64 * 1024);
        assert_eq!(tail.summarize().unwrap().sections.len(), 2);
    }

    #[test]
    fn only_text_uploads_may_carry_a_transcript() {
        assert!(may_carry_teams_transcript("teams-chat.md"));
        assert!(may_carry_teams_transcript("Notes.MARKDOWN"));
        assert!(may_carry_teams_transcript("export.txt"));
        assert!(!may_carry_teams_transcript("report.pdf"));
        assert!(!may_carry_teams_transcript("md"));
    }
}
