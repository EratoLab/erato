//! Turning answers into Teams message activities.

use serde_json::{Value, json};

/// Teams rejects messages above roughly 28 KB; stay well below it.
pub const MAX_MESSAGE_CHARS: usize = 20_000;

/// A markdown message activity. In group chats and channels the requester is
/// @mentioned so the answer is attributable in a busy thread.
pub fn message(text: &str, mention: Option<&Mention>) -> Value {
    match mention {
        Some(mention) => {
            let tag = format!("<at>{}</at>", escape_mention_name(&mention.name));
            json!({
                "type": "message",
                "textFormat": "markdown",
                "text": format!("{tag} {text}"),
                "entities": [{
                    "type": "mention",
                    "text": tag,
                    "mentioned": {"id": mention.id, "name": mention.name},
                }],
            })
        }
        None => json!({"type": "message", "textFormat": "markdown", "text": text}),
    }
}

pub fn typing() -> Value {
    json!({"type": "typing"})
}

pub fn with_attachment(mut activity: Value, attachment: Value) -> Value {
    activity["attachments"] = json!([attachment]);
    activity
}

#[derive(Debug, Clone)]
pub struct Mention {
    pub id: String,
    pub name: String,
}

/// Split long answers at paragraph, then line, then character boundaries.
pub fn split_for_teams(text: &str, max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut rest = text.trim();
    while rest.chars().count() > max_chars {
        let limit = rest
            .char_indices()
            .nth(max_chars)
            .map(|(index, _)| index)
            .unwrap_or(rest.len());
        let window = &rest[..limit];
        let cut = window
            .rfind("\n\n")
            .or_else(|| window.rfind('\n'))
            .filter(|index| *index > limit / 2)
            .unwrap_or(limit);
        chunks.push(rest[..cut].trim_end().to_string());
        rest = rest[cut..].trim_start();
    }
    if !rest.is_empty() || chunks.is_empty() {
        chunks.push(rest.to_string());
    }
    chunks
}

/// A link back to the chat in Erato, when the public origin is configured.
pub fn chat_link(public_base_url: Option<&str>, chat_id: &str) -> Option<String> {
    public_base_url.map(|base| format!("{}/chat/{chat_id}", base.trim_end_matches('/')))
}

fn escape_mention_name(name: &str) -> String {
    name.replace(['<', '>'], "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_at_paragraphs_and_keeps_short_text_whole() {
        assert_eq!(split_for_teams("short", 100), vec!["short"]);
        let text = format!("{}\n\n{}", "a".repeat(60), "b".repeat(60));
        assert_eq!(
            split_for_teams(&text, 100),
            vec!["a".repeat(60), "b".repeat(60)]
        );
        let unbroken = "c".repeat(250);
        let chunks = split_for_teams(&unbroken, 100);
        assert_eq!(chunks.len(), 3);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 100));
    }

    #[test]
    fn mentions_the_requester() {
        let activity = message(
            "done",
            Some(&Mention {
                id: "29:alice".into(),
                name: "Alice".into(),
            }),
        );
        assert_eq!(activity["text"], "<at>Alice</at> done");
        assert_eq!(activity["entities"][0]["mentioned"]["id"], "29:alice");
    }
}
