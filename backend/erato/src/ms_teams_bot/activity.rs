//! The subset of the Bot Framework activity schema the bot reads.
//!
//! Every field is optional or defaulted: Teams adds fields freely, and an
//! activity the bot does not understand must still deserialize so it can be
//! acknowledged.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub timestamp: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub service_url: Option<String>,
    #[serde(default)]
    pub channel_id: Option<String>,
    #[serde(default)]
    pub from: Option<ChannelAccount>,
    #[serde(default)]
    pub recipient: Option<ChannelAccount>,
    #[serde(default)]
    pub conversation: Option<ConversationAccount>,
    #[serde(default)]
    pub reply_to_id: Option<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub entities: Vec<Value>,
    #[serde(default)]
    pub channel_data: Option<Value>,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAccount {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub aad_object_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationAccount {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub conversation_type: Option<String>,
    #[serde(default)]
    pub tenant_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub content_url: Option<String>,
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(default)]
    pub name: Option<String>,
}

/// Where a conversation happens. Stored as `ms_teams_conversations.conversation_type`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConversationKind {
    Personal,
    GroupChat,
    Channel,
}

impl ConversationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ConversationKind::Personal => "personal",
            ConversationKind::GroupChat => "groupChat",
            ConversationKind::Channel => "channel",
        }
    }

    pub fn is_personal(self) -> bool {
        self == ConversationKind::Personal
    }
}

/// A file the user attached to a message, classified by how it is fetched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IncomingFile {
    /// A file uploaded in a personal chat; `download_url` is pre-authenticated.
    Download { name: String, download_url: String },
    /// A pasted or inline image; `content_url` needs the bot's token.
    InlineImage { name: String, content_url: String },
    /// A SharePoint/OneDrive link, as files shared in group chats and channels
    /// arrive; resolved through Microsoft Graph with the user's token.
    Reference { name: String, url: String },
}

pub const TEAMS_FILE_DOWNLOAD_INFO: &str = "application/vnd.microsoft.teams.file.download.info";

impl Activity {
    pub fn conversation_kind(&self) -> ConversationKind {
        match self
            .conversation
            .as_ref()
            .and_then(|conversation| conversation.conversation_type.as_deref())
        {
            Some("groupChat") => ConversationKind::GroupChat,
            Some("channel") => ConversationKind::Channel,
            _ => ConversationKind::Personal,
        }
    }

    pub fn conversation_id(&self) -> Option<&str> {
        self.conversation
            .as_ref()
            .map(|conversation| conversation.id.as_str())
            .filter(|id| !id.is_empty())
    }

    pub fn tenant_id(&self) -> Option<&str> {
        self.channel_data
            .as_ref()
            .and_then(|data| data.pointer("/tenant/id"))
            .and_then(Value::as_str)
            .or_else(|| {
                self.conversation
                    .as_ref()
                    .and_then(|conversation| conversation.tenant_id.as_deref())
            })
    }

    pub fn from_aad_object_id(&self) -> Option<&str> {
        self.from
            .as_ref()
            .and_then(|from| from.aad_object_id.as_deref())
            .filter(|id| !id.is_empty())
    }

    /// The Microsoft 365 group ID of the team a channel message belongs to.
    pub fn team_aad_group_id(&self) -> Option<&str> {
        self.channel_data
            .as_ref()
            .and_then(|data| data.pointer("/team/aadGroupId"))
            .and_then(Value::as_str)
    }

    /// The user's text with the bot's own @mention removed.
    pub fn text_without_bot_mention(&self) -> String {
        let mut text = self.text.clone().unwrap_or_default();
        let bot_id = self
            .recipient
            .as_ref()
            .map(|recipient| recipient.id.as_str());
        for entity in &self.entities {
            if entity.get("type").and_then(Value::as_str) != Some("mention") {
                continue;
            }
            let mentioned = entity.pointer("/mentioned/id").and_then(Value::as_str);
            if mentioned.is_none() || mentioned != bot_id {
                continue;
            }
            if let Some(mention_text) = entity.get("text").and_then(Value::as_str) {
                text = text.replace(mention_text, "");
            }
        }
        text.replace("&nbsp;", " ").trim().to_string()
    }

    /// Files the user attached, in the order Teams listed them.
    pub fn incoming_files(&self) -> Vec<IncomingFile> {
        let mut files = Vec::new();
        for (index, attachment) in self.attachments.iter().enumerate() {
            let name = attachment
                .name
                .clone()
                .filter(|name| !name.trim().is_empty());
            if attachment.content_type == TEAMS_FILE_DOWNLOAD_INFO {
                let download_url = attachment
                    .content
                    .as_ref()
                    .and_then(|content| content.get("downloadUrl"))
                    .and_then(Value::as_str);
                if let Some(download_url) = download_url {
                    files.push(IncomingFile::Download {
                        name: name.unwrap_or_else(|| format!("file-{}", index + 1)),
                        download_url: download_url.to_string(),
                    });
                }
            } else if attachment.content_type == "reference" {
                if let Some(url) = attachment.content_url.as_deref() {
                    files.push(IncomingFile::Reference {
                        name: name.unwrap_or_else(|| format!("file-{}", index + 1)),
                        url: url.to_string(),
                    });
                }
            } else if attachment.content_type.starts_with("image/")
                && let Some(content_url) = attachment.content_url.as_deref()
            {
                let extension = attachment
                    .content_type
                    .trim_start_matches("image/")
                    .split(';')
                    .next()
                    .unwrap_or("png")
                    .to_string();
                files.push(IncomingFile::InlineImage {
                    name: name.unwrap_or_else(|| format!("image-{}.{extension}", index + 1)),
                    content_url: content_url.to_string(),
                });
            }
        }
        files
    }
}

/// Split a channel conversation ID into the channel ID and the thread's root
/// message ID (`19:…@thread.tacv2;messageid=1700000000000`).
pub fn split_channel_thread(conversation_id: &str) -> (&str, Option<&str>) {
    match conversation_id.split_once(";messageid=") {
        Some((channel, root)) if !root.is_empty() => (channel, Some(root)),
        Some((channel, _)) => (channel, None),
        None => (conversation_id, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(value: Value) -> Activity {
        serde_json::from_value(value).expect("activity parses")
    }

    #[test]
    fn strips_only_the_bot_mention() {
        let activity = parse(json!({
            "type": "message",
            "text": "<at>Erato</at> ask <at>Alice</at> about this",
            "recipient": {"id": "28:bot"},
            "entities": [
                {"type": "mention", "text": "<at>Erato</at>", "mentioned": {"id": "28:bot"}},
                {"type": "mention", "text": "<at>Alice</at>", "mentioned": {"id": "29:alice"}}
            ]
        }));
        assert_eq!(
            activity.text_without_bot_mention(),
            "ask <at>Alice</at> about this"
        );
    }

    #[test]
    fn classifies_conversation_kinds_and_tenant() {
        let activity = parse(json!({
            "type": "message",
            "conversation": {"id": "19:abc@thread.tacv2;messageid=42", "conversationType": "channel"},
            "channelData": {"tenant": {"id": "tenant-1"}, "team": {"aadGroupId": "group-1"}}
        }));
        assert_eq!(activity.conversation_kind(), ConversationKind::Channel);
        assert_eq!(activity.tenant_id(), Some("tenant-1"));
        assert_eq!(activity.team_aad_group_id(), Some("group-1"));
        assert_eq!(
            split_channel_thread(activity.conversation_id().unwrap()),
            ("19:abc@thread.tacv2", Some("42"))
        );
        let personal = parse(json!({"type": "message", "conversation": {"id": "a:1"}}));
        assert_eq!(personal.conversation_kind(), ConversationKind::Personal);
    }

    #[test]
    fn classifies_incoming_files() {
        let activity = parse(json!({
            "type": "message",
            "attachments": [
                {"contentType": "text/html", "content": "<p>hi</p>"},
                {"contentType": TEAMS_FILE_DOWNLOAD_INFO, "name": "report.pdf",
                 "content": {"downloadUrl": "https://contoso.sharepoint.com/dl"}},
                {"contentType": "image/png", "contentUrl": "https://smba.trafficmanager.net/img"},
                {"contentType": "reference", "name": "plan.docx",
                 "contentUrl": "https://contoso.sharepoint.com/sites/x/plan.docx"}
            ]
        }));
        assert_eq!(
            activity.incoming_files(),
            vec![
                IncomingFile::Download {
                    name: "report.pdf".into(),
                    download_url: "https://contoso.sharepoint.com/dl".into()
                },
                IncomingFile::InlineImage {
                    name: "image-3.png".into(),
                    content_url: "https://smba.trafficmanager.net/img".into()
                },
                IncomingFile::Reference {
                    name: "plan.docx".into(),
                    url: "https://contoso.sharepoint.com/sites/x/plan.docx".into()
                },
            ]
        );
    }
}
