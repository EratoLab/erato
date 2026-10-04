//! Turning answers into Teams message activities.

use super::cards;
use serde_json::{Value, json};

/// Teams rejects messages above roughly 28 KB; stay well below it.
pub const MAX_MESSAGE_CHARS: usize = 20_000;
/// Serialized size of the details card, leaving room below the same limit
/// for the activity's metadata and summary.
const MAX_DETAILS_CARD_BYTES: usize = 24_000;
pub const EARLIER_STEPS: &str = "Earlier steps";

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

/// Card-only activities can be updated in place. Adding top-level text would
/// make Teams expand this into multiple activities, which cannot share a PUT.
pub fn card_message(attachment: Value, summary: &str) -> Value {
    json!({"type": "message", "summary": summary, "attachments": [attachment]})
}

/// Disclose earlier assistant text without mixing it into the final answer.
/// Large details stay in normal text chunks instead of overflowing a card or
/// silently truncating potentially useful content.
pub fn answer_with_details(text: &str, earlier_text: &str) -> (String, Option<Value>) {
    if earlier_text.trim().is_empty() {
        return (text.to_string(), None);
    }
    let mut attachment = cards::adaptive_card(
        Vec::new(),
        vec![json!({
            "type": "Action.ShowCard", "title": EARLIER_STEPS,
            "card": {
                "type": "AdaptiveCard",
                "body": [{"type": "TextBlock", "text": earlier_text, "wrap": true}],
            },
        })],
    );
    attachment["content"]["fallbackText"] = json!(format!("{EARLIER_STEPS}:\n\n{earlier_text}"));
    // The card is sent separately from the answer. Include JSON escaping and
    // fallback text in its budget.
    if serde_json::to_vec(&attachment).is_ok_and(|bytes| bytes.len() <= MAX_DETAILS_CARD_BYTES) {
        (text.to_string(), Some(attachment))
    } else {
        (
            format!("{text}\n\n---\n\n{}", earlier_steps_markdown(earlier_text)),
            None,
        )
    }
}

pub fn earlier_steps_markdown(earlier_text: &str) -> String {
    format!("**{EARLIER_STEPS}**\n\n{earlier_text}")
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

    #[test]
    fn oversized_details_are_preserved_as_separate_text_instead_of_truncated() {
        let earlier = "Useful earlier finding 界".repeat(2_000);
        let (text, attachment) = answer_with_details("Final answer", &earlier);
        assert!(attachment.is_none());
        assert!(text.starts_with("Final answer\n\n---\n\n**Earlier steps**"));
        assert!(text.ends_with(&earlier));
        assert_eq!(
            answer_with_details("Plain answer", ""),
            ("Plain answer".into(), None)
        );
    }
}
