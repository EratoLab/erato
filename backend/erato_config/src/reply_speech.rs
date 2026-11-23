//! `[audio_conversational.reply_speech]`: what the voice says for a reply in
//! conversational audio mode. Approval cards have their own setting,
//! `[approval_speech]`.

use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use crate::config_facet_attrs as erato_config;
use crate::spoken::{Written, written_table};
use config::Config;

const PLACE: &str = "audio_conversational.reply_speech";

/// How a reply in conversational audio mode is spoken.
#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Facet, HeapSize, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum ReplySpeechWording {
    /// The voice says a short answer written for the ear; the chat keeps the
    /// complete written answer. One model call writes both.
    Natural,
    /// The voice reads the written answer as it is, like the read-aloud
    /// button. `turn_instructions.spoken_reply` still shapes the reply, as
    /// before the split existed.
    #[default]
    Precise,
}

/// `[audio_conversational.reply_speech]`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Facet, HeapSize)]
#[serde(default)]
pub struct ReplySpeechConfig {
    /// Whether replies are spoken when a user enters conversational audio
    /// mode. Covered by `user_choice` like the wording. Defaults to `true`:
    /// with a voice configured, a conversation is spoken.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub spoken: bool,
    /// `natural` or `precise`. Defaults to `precise` until the `natural`
    /// spoken-reply wording is applied where it is used.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub wording: ReplySpeechWording,
    /// Whether a user may choose their own wording and whether replies are
    /// spoken, unless a supervisor's
    /// audience setting says otherwise. Defaults to `true`.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub user_choice: bool,
    /// Whether the chat shows what the voice said, folded above the written
    /// answer, with a play button when the recording is kept. A user may
    /// always choose it for themselves. Defaults to `false`: the chat shows
    /// the written answer only.
    #[facet(erato_config::introduced_in(version = "0.9.0"))]
    pub show_in_chat: bool,
}

impl Default for ReplySpeechConfig {
    fn default() -> Self {
        Self {
            spoken: true,
            wording: ReplySpeechWording::Precise,
            user_choice: true,
            show_in_chat: false,
        }
    }
}

/// A value of the wrong kind keeps the default with a warning instead of
/// stopping the configuration.
fn shaped_reply_speech(written: Written) -> (ReplySpeechConfig, Vec<String>) {
    let mut dropped = Vec::new();
    let mut config = ReplySpeechConfig::default();
    for (key, value) in written_table(PLACE, written, &mut dropped) {
        match (key.as_str(), value) {
            ("wording", Written::Text(text)) if text == "natural" => {
                config.wording = ReplySpeechWording::Natural;
            }
            ("wording", Written::Text(text)) if text == "precise" => {
                config.wording = ReplySpeechWording::Precise;
            }
            ("wording", _) => dropped.push(format!(
                "{PLACE}.wording is not `natural` or `precise`; the default is used"
            )),
            ("spoken", Written::Flag(flag)) => config.spoken = flag,
            ("spoken", _) => dropped.push(format!(
                "{PLACE}.spoken is not `true` or `false`; the default is used"
            )),
            ("user_choice", Written::Flag(flag)) => config.user_choice = flag,
            ("user_choice", _) => dropped.push(format!(
                "{PLACE}.user_choice is not `true` or `false`; the default is used"
            )),
            ("show_in_chat", Written::Flag(flag)) => config.show_in_chat = flag,
            ("show_in_chat", _) => dropped.push(format!(
                "{PLACE}.show_in_chat is not `true` or `false`; the default is used"
            )),
            (other, _) => dropped.push(format!("{PLACE}.{other} is not known and is ignored")),
        }
    }
    dropped.sort();
    (config, dropped)
}

pub fn deserialize_reply_speech<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<ReplySpeechConfig, D::Error> {
    Ok(shaped_reply_speech(Written::deserialize(deserializer)?).0)
}

/// What the loader replaced or left out of
/// `[audio_conversational.reply_speech]`, sorted.
pub fn misshaped_reply_speech(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>(PLACE)
        .map(|written| shaped_reply_speech(written).1)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shaped(value: serde_json::Value) -> (ReplySpeechConfig, Vec<String>) {
        shaped_reply_speech(serde_json::from_value(value).unwrap())
    }

    #[test]
    fn precise_and_open_by_default() {
        let (config, dropped) = shaped(serde_json::json!({}));
        assert_eq!(config, ReplySpeechConfig::default());
        assert_eq!(config.wording, ReplySpeechWording::Precise);
        assert!(config.user_choice);
        assert!(!config.show_in_chat);
        assert!(dropped.is_empty());
    }

    #[test]
    fn a_wrong_value_keeps_the_default_and_the_rest() {
        let (config, dropped) = shaped(serde_json::json!({
            "wording": "literal",
            "user_choice": false,
            "length": 3
        }));
        assert_eq!(config.wording, ReplySpeechWording::Precise);
        assert!(!config.user_choice);
        assert_eq!(dropped.len(), 2, "{dropped:?}");

        let (config, dropped) = shaped(serde_json::json!({"wording": "natural"}));
        assert_eq!(config.wording, ReplySpeechWording::Natural);
        assert!(dropped.is_empty());

        let (config, dropped) = shaped(serde_json::json!({"show_in_chat": "yes"}));
        assert!(!config.show_in_chat);
        assert_eq!(dropped.len(), 1, "{dropped:?}");
        let (config, _) = shaped(serde_json::json!({"show_in_chat": true}));
        assert!(config.show_in_chat);
    }

    #[test]
    fn replies_are_spoken_unless_turned_off() {
        assert!(shaped(serde_json::json!({})).0.spoken);
        assert!(!shaped(serde_json::json!({"spoken": false})).0.spoken);
        let (config, dropped) = shaped(serde_json::json!({"spoken": "no"}));
        assert!(config.spoken);
        assert_eq!(dropped.len(), 1, "{dropped:?}");
    }
}
