//! Microsoft Graph calls made with the user's delegated token: who they are,
//! which groups they are in, the conversation around a mention, and the
//! SharePoint items behind shared file links.

use super::connector::read_limited;
use base64::Engine as _;
use eyre::{Report, eyre};
use serde::Deserialize;
use serde_json::{Value, json};

const GRAPH: &str = "https://graph.microsoft.com/v1.0";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphIdentity {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub mail: Option<String>,
    #[serde(default)]
    pub user_principal_name: Option<String>,
    #[serde(default)]
    pub preferred_language: Option<String>,
}

impl GraphIdentity {
    pub fn email(&self) -> Option<&str> {
        self.mail
            .as_deref()
            .or(self.user_principal_name.as_deref())
            .filter(|value| !value.is_empty())
    }
}

/// One message of the surrounding Teams conversation, for context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextMessage {
    pub id: String,
    pub created: String,
    pub author: String,
    pub text: String,
}

/// A SharePoint/OneDrive item resolved from a sharing URL.
#[derive(Debug, Clone)]
pub struct SharedItem {
    pub drive_id: String,
    pub item_id: String,
    pub name: String,
}

pub struct Graph<'a> {
    http: &'a reqwest::Client,
    token: &'a str,
}

impl<'a> Graph<'a> {
    pub fn new(http: &'a reqwest::Client, token: &'a str) -> Self {
        Self { http, token }
    }

    pub async fn me(&self) -> Result<GraphIdentity, Report> {
        self.get_json(&format!(
            "{GRAPH}/me?$select=id,displayName,mail,userPrincipalName,preferredLanguage"
        ))
        .await
    }

    /// Group object IDs, the same values the login's `groups` claim carries.
    pub async fn member_groups(&self, security_only: bool) -> Result<Vec<String>, Report> {
        let response = self
            .http
            .post(format!("{GRAPH}/me/getMemberGroups"))
            .bearer_auth(self.token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(
                &json!({"securityEnabledOnly": security_only}),
            )?)
            .send()
            .await?;
        let body = checked_json(response).await?;
        Ok(body
            .get("value")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// The latest messages of a group chat, oldest first. Needs `Chat.Read`.
    pub async fn group_chat_messages(
        &self,
        chat_id: &str,
        count: u32,
    ) -> Result<Vec<ContextMessage>, Report> {
        let url = format!(
            "{GRAPH}/chats/{}/messages?$top={}&$orderby=createdDateTime%20desc",
            encode(chat_id),
            count.clamp(1, 50)
        );
        let body: Value = self.get_json(&url).await?;
        let mut messages = parse_messages(&body);
        messages.reverse();
        Ok(messages)
    }

    /// A channel thread's root and its latest replies, oldest first.
    /// Needs `ChannelMessage.Read.All`.
    pub async fn channel_thread_messages(
        &self,
        team_id: &str,
        channel_id: &str,
        root_id: &str,
        count: u32,
    ) -> Result<Vec<ContextMessage>, Report> {
        let base = format!(
            "{GRAPH}/teams/{}/channels/{}/messages/{}",
            encode(team_id),
            encode(channel_id),
            encode(root_id)
        );
        let root: Value = self.get_json(&base).await?;
        let replies: Value = self
            .get_json(&format!("{base}/replies?$top={}", count.clamp(1, 50)))
            .await?;
        let mut messages = parse_messages(&json!({"value": [root]}));
        let mut replies = parse_messages(&replies);
        replies.sort_by(|left, right| left.created.cmp(&right.created));
        let keep_from = replies.len().saturating_sub(count as usize);
        messages.extend(replies.into_iter().skip(keep_from));
        Ok(messages)
    }

    /// Resolve a SharePoint/OneDrive link to its drive item.
    pub async fn resolve_shared_item(&self, url: &str) -> Result<SharedItem, Report> {
        let item: Value = self
            .get_json(&format!(
                "{GRAPH}/shares/{}/driveItem?$select=id,name,parentReference,folder",
                share_id(url)
            ))
            .await?;
        if item.get("folder").is_some() {
            return Err(eyre!("shared link points to a folder"));
        }
        let field = |pointer: &str| {
            item.pointer(pointer)
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .ok_or_else(|| eyre!("shared item response lacks {pointer}"))
        };
        Ok(SharedItem {
            drive_id: field("/parentReference/driveId")?,
            item_id: field("/id")?,
            name: field("/name")?,
        })
    }

    /// Download a shared file's content (used when the SharePoint integration
    /// is off, so the file is stored as a regular upload instead of linked).
    pub async fn download_shared_item(
        &self,
        url: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, Report> {
        let response = self
            .http
            .get(format!(
                "{GRAPH}/shares/{}/driveItem/content",
                share_id(url)
            ))
            .bearer_auth(self.token)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(eyre!(
                "shared file download failed with {}",
                response.status()
            ));
        }
        read_limited(response, max_bytes).await
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T, Report> {
        let response = self.http.get(url).bearer_auth(self.token).send().await?;
        Ok(serde_json::from_value(checked_json(response).await?)?)
    }
}

async fn checked_json(response: reqwest::Response) -> Result<Value, Report> {
    let status = response.status();
    let bytes = response.bytes().await?;
    if !status.is_success() {
        let code = serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|body| {
                body.pointer("/error/code")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_default();
        return Err(eyre!("Graph call failed with {status} {code}"));
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn parse_messages(body: &Value) -> Vec<ContextMessage> {
    body.get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|message| {
            message
                .get("messageType")
                .and_then(Value::as_str)
                .unwrap_or("message")
                == "message"
                && message.get("deletedDateTime").is_none_or(Value::is_null)
        })
        .filter_map(|message| {
            let text = html_to_text(message.pointer("/body/content")?.as_str()?);
            if text.is_empty() {
                return None;
            }
            let author = message
                .pointer("/from/user/displayName")
                .or_else(|| message.pointer("/from/application/displayName"))
                .and_then(Value::as_str)
                .unwrap_or("Unknown")
                .to_string();
            Some(ContextMessage {
                id: message.get("id")?.as_str()?.to_string(),
                created: message
                    .get("createdDateTime")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                author,
                text,
            })
        })
        .collect()
}

/// Teams message bodies are HTML; keep the text and line structure.
pub fn html_to_text(html: &str) -> String {
    let with_breaks = html
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n")
        .replace("</div>", "\n");
    let mut text = String::with_capacity(with_breaks.len());
    let mut in_tag = false;
    for character in with_breaks.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    let decoded = text
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    decoded
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Render context messages as the markdown file attached to a mention.
pub fn context_markdown(conversation_label: &str, messages: &[ContextMessage]) -> String {
    let mut markdown = format!(
        "# Recent messages in this Teams {conversation_label}\n\n\
         The user mentioned the assistant in this conversation. These are the \
         messages that preceded the mention, oldest first.\n"
    );
    for message in messages {
        markdown.push_str(&format!(
            "\n**{}** ({}):\n\n{}\n",
            message.author, message.created, message.text
        ));
    }
    markdown
}

/// Graph's encoding of a sharing URL: `u!` + unpadded base64url.
fn share_id(url: &str) -> String {
    format!(
        "u!{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(url.as_bytes())
    )
}

fn encode(segment: &str) -> String {
    percent_encoding::utf8_percent_encode(segment, percent_encoding::NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_teams_html_to_text() {
        assert_eq!(
            html_to_text(
                "<p>Hello <at id=\"0\">Erato</at>,</p><p>see&nbsp;&lt;this&gt; &amp; that<br>ok</p>"
            ),
            "Hello Erato,\nsee <this> & that\nok"
        );
    }

    #[test]
    fn parses_graph_messages_skipping_system_and_deleted() {
        let body = json!({"value": [
            {"id": "1", "messageType": "message", "createdDateTime": "2026-09-28T10:00:00Z",
             "from": {"user": {"displayName": "Alice"}}, "body": {"content": "<p>Hi</p>"}},
            {"id": "2", "messageType": "systemEventMessage", "body": {"content": "joined"}},
            {"id": "3", "messageType": "message", "deletedDateTime": "2026-09-28T10:01:00Z",
             "from": {"user": {"displayName": "Bob"}}, "body": {"content": "gone"}}
        ]});
        assert_eq!(
            parse_messages(&body),
            vec![ContextMessage {
                id: "1".into(),
                created: "2026-09-28T10:00:00Z".into(),
                author: "Alice".into(),
                text: "Hi".into()
            }]
        );
    }

    #[test]
    fn encodes_sharing_urls_like_graph_expects() {
        assert_eq!(
            share_id(
                "https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1"
            ),
            "u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx"
        );
    }
}
