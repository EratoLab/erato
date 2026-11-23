//! Which language the user spoke in a conversational audio turn: one step
//! for every transcription model, from the recognizer's guess and an offline
//! check of the words. Everything the voice says in the turn follows it.
//!
//! The rule prefers to keep the chat's language: a recognizer often takes
//! accented English for the speaker's mother tongue, and short turns ("ja",
//! "okay") carry too little to tell.

use crate::db::entity::{chats, messages};
use crate::models::message::InputParameters;
use lingua::{IsoCode639_1, Language, LanguageDetector, LanguageDetectorBuilder};
use sea_orm::prelude::*;
use sea_orm::{QueryOrder, QuerySelect, sea_query::Expr};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, LazyLock, Mutex};

/// Words a turn needs before one source alone may decide, or switch away
/// from the chat's language.
const LONG_TURN_WORDS: usize = 4;

/// How far the best language must lead the second before the word check
/// answers at all. Lower answers more often on short text; higher is unsure
/// more often.
const MINIMUM_RELATIVE_DISTANCE: f64 = 0.1;

/// The recognizer's language stays possible while the word check gives it at
/// least this share of its best language's confidence.
const PLAUSIBLE_SHARE_OF_BEST: f64 = 0.2;

/// The candidates the word check and the recognizer's guess are held to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Candidates<'a> {
    /// Every language the word check knows.
    Any,
    /// Only these, as language codes such as `de`.
    Only(&'a [String]),
}

/// What the decision for one turn is made from.
#[derive(Debug, Clone, Copy)]
pub struct SpokenLanguageInput<'a> {
    /// The turn's words, as transcribed.
    pub text: &'a str,
    /// What the recognizer said it heard, if it says.
    pub recognizer_language: Option<&'a str>,
    pub candidates: Candidates<'a>,
    /// The latest spoken language of this chat, if it has one.
    pub chat_language: Option<&'a str>,
    /// The person's own language: the answer for a new chat that is unsure.
    pub main_language: &'a str,
    /// Off: every turn is in `main_language`, whatever was heard.
    pub follow_speaker: bool,
}

/// Why the turn got its language, for the per-turn log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionReason {
    Agreed,
    RecognizerOnLongTurn,
    WordsOnLongTurn,
    KeptChat,
    Main,
    NotFollowing,
}

impl DecisionReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agreed => "agreed",
            Self::RecognizerOnLongTurn => "recognizer_long_turn",
            Self::WordsOnLongTurn => "words_long_turn",
            Self::KeptChat => "kept_chat",
            Self::Main => "main",
            Self::NotFollowing => "not_following",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpokenLanguageDecision {
    pub language: String,
    /// The recognizer's guess, once held to the candidates.
    pub recognizer: Option<String>,
    /// The word check's guess; `None` when unsure.
    pub words: Option<String>,
    pub reason: DecisionReason,
}

impl SpokenLanguageDecision {
    /// Codes only, never the words.
    pub fn log(&self) {
        tracing::info!(
            recognizer = self.recognizer.as_deref().unwrap_or("-"),
            words = self.words.as_deref().unwrap_or("-"),
            chosen = %self.language,
            reason = self.reason.as_str(),
            "Spoken language of the turn"
        );
    }
}

/// The turn's language. Never fails: with nothing to go on it is the chat's
/// language, then the main language.
pub fn decide(input: SpokenLanguageInput<'_>) -> SpokenLanguageDecision {
    let main = language_code(input.main_language).unwrap_or_else(|| "en".to_string());
    let chat = input.chat_language.and_then(language_code);
    let recognizer = input
        .recognizer_language
        .and_then(language_code)
        .filter(|code| is_candidate(code, input.candidates));
    let check = WordCheck::of(input.text, input.candidates);
    let words = check.sure();
    let decision = |language: String, reason| SpokenLanguageDecision {
        language,
        recognizer: recognizer.clone(),
        words: words.clone(),
        reason,
    };
    if !input.follow_speaker {
        return decision(main, DecisionReason::NotFollowing);
    }
    let long = word_count(input.text) >= LONG_TURN_WORDS;
    match (&recognizer, &words) {
        (Some(heard), Some(read)) if heard == read => {
            return decision(heard.clone(), DecisionReason::Agreed);
        }
        (Some(heard), _) if long && check.plausible(heard, input.text) => {
            return decision(heard.clone(), DecisionReason::RecognizerOnLongTurn);
        }
        (None, Some(read)) if long => {
            return decision(read.clone(), DecisionReason::WordsOnLongTurn);
        }
        _ => {}
    }
    match chat {
        Some(chat) => decision(chat, DecisionReason::KeptChat),
        None => decision(main, DecisionReason::Main),
    }
}

/// The primary subtag of a language tag, lower case, if it is one: two or
/// three letters, optionally followed by subtags (`de`, `de-AT`, `pt_BR`).
/// A recognizer that names the language (`german`) is read too.
pub fn language_code(tag: &str) -> Option<String> {
    let tag = tag.trim();
    let mut subtags = tag.split(['-', '_']);
    let primary = subtags.next()?;
    let is_code = (2..=3).contains(&primary.len())
        && primary.chars().all(|c| c.is_ascii_alphabetic())
        && subtags.all(|subtag| {
            (1..=8).contains(&subtag.len()) && subtag.chars().all(|c| c.is_ascii_alphanumeric())
        });
    if is_code {
        return Some(primary.to_ascii_lowercase());
    }
    Language::all()
        .into_iter()
        .find(|language| language.to_string().eq_ignore_ascii_case(tag))
        .map(|language| language.iso_code_639_1().to_string())
}

/// The language a stored user message was spoken in, if it was.
pub fn of_input_parameters(parameters: Option<&serde_json::Value>) -> Option<String> {
    let parameters: InputParameters = serde_json::from_value(parameters?.clone()).ok()?;
    parameters
        .spoken_language
        .as_deref()
        .and_then(language_code)
}

/// The chat's language: that of its latest spoken user message in the
/// active thread. `None` for a chat that is not the user's, or has none.
pub async fn of_chat(
    db: &DatabaseConnection,
    chat_id: Uuid,
    user_id: &str,
) -> Result<Option<String>, DbErr> {
    let owned = chats::Entity::find_by_id(chat_id)
        .one(db)
        .await?
        .is_some_and(|chat| chat.owner_user_id == user_id);
    if !owned {
        return Ok(None);
    }
    let latest = messages::Entity::find()
        .select_only()
        .column(messages::Column::InputParameters)
        .filter(messages::Column::ChatId.eq(chat_id))
        .filter(messages::Column::IsMessageInActiveThread.eq(true))
        .filter(Expr::cust(
            "\"messages\".\"input_parameters\" ->> 'spoken_language' IS NOT NULL",
        ))
        .order_by_desc(messages::Column::CreatedAt)
        .into_tuple::<Option<serde_json::Value>>()
        .one(db)
        .await?;
    Ok(latest
        .flatten()
        .as_ref()
        .and_then(|parameters| of_input_parameters(Some(parameters))))
}

/// Messages walked up from an answer to the user message it answers: tool
/// rounds and continuations sit in between.
const MAX_TURN_DEPTH: usize = 32;

/// The language the turn of `message_id` was spoken in: that of the nearest
/// user message at or above it.
pub async fn of_turn(db: &DatabaseConnection, message_id: Uuid) -> Result<Option<String>, DbErr> {
    let mut next = Some(message_id);
    for _ in 0..MAX_TURN_DEPTH {
        let Some(id) = next else { break };
        let Some(message) = messages::Entity::find_by_id(id).one(db).await? else {
            break;
        };
        if message
            .raw_message
            .get("role")
            .and_then(|role| role.as_str())
            == Some("user")
        {
            return Ok(of_input_parameters(message.input_parameters.as_ref()));
        }
        next = message.previous_message_id;
    }
    Ok(None)
}

/// The language named in English for a sentence to the model: "German".
/// A language prompts do not name is given by its code.
pub fn english_name(code: &str) -> String {
    crate::services::template_rendering::consumers::system_prompt::english_language_name(code)
        .map_or_else(|| code.to_string(), str::to_string)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Script {
    Latin,
    Devanagari,
    Arabic,
    Cyrillic,
    Greek,
    Hebrew,
    Thai,
    Han,
    Kana,
    Hangul,
    Georgian,
    Armenian,
    Bengali,
}

/// The script a language is usually written in. Languages written in more
/// than one, or not listed, count as Latin.
fn script_of(code: &str) -> Script {
    match code {
        "hi" | "mr" | "ne" => Script::Devanagari,
        "ar" | "fa" | "ur" | "ps" => Script::Arabic,
        "ru" | "uk" | "bg" | "be" | "mk" | "kk" | "mn" => Script::Cyrillic,
        "el" => Script::Greek,
        "he" | "yi" => Script::Hebrew,
        "th" => Script::Thai,
        "zh" => Script::Han,
        "ja" => Script::Kana,
        "ko" => Script::Hangul,
        "ka" => Script::Georgian,
        "hy" => Script::Armenian,
        "bn" => Script::Bengali,
        _ => Script::Latin,
    }
}

fn char_script(c: char) -> Option<Script> {
    Some(match c {
        'a'..='z' | 'A'..='Z' | '\u{00c0}'..='\u{024f}' => Script::Latin,
        '\u{0900}'..='\u{097f}' => Script::Devanagari,
        '\u{0600}'..='\u{06ff}' | '\u{0750}'..='\u{077f}' => Script::Arabic,
        '\u{0400}'..='\u{04ff}' => Script::Cyrillic,
        '\u{0370}'..='\u{03ff}' => Script::Greek,
        '\u{0590}'..='\u{05ff}' => Script::Hebrew,
        '\u{0e00}'..='\u{0e7f}' => Script::Thai,
        '\u{3040}'..='\u{30ff}' => Script::Kana,
        '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' => Script::Han,
        '\u{ac00}'..='\u{d7af}' | '\u{1100}'..='\u{11ff}' => Script::Hangul,
        '\u{10a0}'..='\u{10ff}' => Script::Georgian,
        '\u{0530}'..='\u{058f}' => Script::Armenian,
        '\u{0980}'..='\u{09ff}' => Script::Bengali,
        _ => return None,
    })
}

/// Whether the text has letters in the script `code` is written in.
/// Japanese is written with Han characters too.
fn written_in_script_of(code: &str, text: &str) -> bool {
    let wanted = script_of(code);
    text.chars()
        .filter_map(char_script)
        .any(|script| script == wanted || (wanted == Script::Kana && script == Script::Han))
}

fn is_candidate(code: &str, candidates: Candidates<'_>) -> bool {
    match candidates {
        Candidates::Any => true,
        Candidates::Only(list) => list
            .iter()
            .any(|candidate| language_code(candidate).as_deref() == Some(code)),
    }
}

/// Space-separated words; a script written without spaces counts two
/// characters as a word.
fn word_count(text: &str) -> usize {
    let mut words = 0;
    let mut unspaced = 0;
    for token in text.split_whitespace() {
        let dense = token.chars().filter(|c| is_unspaced_script(*c)).count();
        if dense > 0 {
            unspaced += dense;
        } else if token.chars().any(char::is_alphanumeric) {
            words += 1;
        }
    }
    words + unspaced.div_ceil(2)
}

fn is_unspaced_script(c: char) -> bool {
    matches!(c,
        '\u{3040}'..='\u{30ff}' // Hiragana, Katakana
        | '\u{3400}'..='\u{4dbf}' // CJK extension A
        | '\u{4e00}'..='\u{9fff}' // CJK unified ideographs
        | '\u{0e00}'..='\u{0e7f}' // Thai
    )
}

/// The word check's view of the turn: how likely each language it knows is.
struct WordCheck {
    /// Best first; empty when the check has nothing to say.
    confidences: Vec<(String, f64)>,
}

impl WordCheck {
    fn of(text: &str, candidates: Candidates<'_>) -> Self {
        let confidences = match detector_for(candidates) {
            Some(detector) if !text.trim().is_empty() => detector
                .compute_language_confidence_values(text)
                .into_iter()
                .map(|(language, confidence)| (language.iso_code_639_1().to_string(), confidence))
                .collect(),
            _ => Vec::new(),
        };
        Self { confidences }
    }

    /// The language the words are, when it clearly leads.
    fn sure(&self) -> Option<String> {
        let (best, best_confidence) = self.confidences.first()?;
        let second = self.confidences.get(1).map_or(0.0, |(_, value)| *value);
        (*best_confidence > 0.0 && best_confidence - second >= MINIMUM_RELATIVE_DISTANCE)
            .then(|| best.clone())
    }

    /// Whether the words leave `code` possible: a mixed sentence ("Zeig mir
    /// das Forecast-Dashboard") reads as English to the check, but German stays
    /// likely; English words heard as Hindi do not. A language the check does
    /// not know is held to its script alone.
    fn plausible(&self, code: &str, text: &str) -> bool {
        let best = self.confidences.first().map_or(0.0, |(_, value)| *value);
        match self
            .confidences
            .iter()
            .find(|(language, _)| language == code)
        {
            Some((_, confidence)) => *confidence >= PLAUSIBLE_SHARE_OF_BEST * best,
            None => written_in_script_of(code, text),
        }
    }
}

/// Detectors share their models, so one per candidate set costs little.
fn detector_for(candidates: Candidates<'_>) -> Option<Arc<LanguageDetector>> {
    static DETECTORS: LazyLock<Mutex<HashMap<Vec<Language>, Arc<LanguageDetector>>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    let mut languages: Vec<Language> = match candidates {
        Candidates::Any => Language::all().into_iter().collect(),
        Candidates::Only(list) => list
            .iter()
            .filter_map(|code| IsoCode639_1::from_str(&language_code(code)?).ok())
            .map(|iso| Language::from_iso_code_639_1(&iso))
            .filter(|language| Language::all().contains(language))
            .collect(),
    };
    languages.sort();
    languages.dedup();
    // One candidate is no question: the recognizer and the chat decide.
    if languages.len() < 2 {
        return None;
    }
    let mut detectors = DETECTORS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Some(Arc::clone(
        detectors.entry(languages.clone()).or_insert_with(|| {
            Arc::new(
                LanguageDetectorBuilder::from_languages(&languages)
                    .with_minimum_relative_distance(MINIMUM_RELATIVE_DISTANCE)
                    .build(),
            )
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn<'a>(
        text: &'a str,
        recognizer: Option<&'a str>,
        chat: Option<&'a str>,
        main: &'a str,
    ) -> SpokenLanguageDecision {
        decide(SpokenLanguageInput {
            text,
            recognizer_language: recognizer,
            candidates: Candidates::Any,
            chat_language: chat,
            main_language: main,
            follow_speaker: true,
        })
    }

    #[test]
    fn german_speech_under_an_english_profile_is_german() {
        let decided = turn(
            "Kannst du mir bitte die offenen Angebote von dieser Woche zeigen?",
            Some("de"),
            None,
            "en",
        );
        assert_eq!(decided.language, "de");
        assert_eq!(decided.reason, DecisionReason::Agreed);
    }

    #[test]
    fn english_speech_under_a_german_profile_is_english() {
        let decided = turn(
            "Can you show me the open quotes from this week, please?",
            Some("en"),
            None,
            "de",
        );
        assert_eq!(decided.language, "en");
    }

    #[test]
    fn the_first_turn_without_a_recognizer_guess_follows_long_words() {
        let decided = turn(
            "Zeig mir bitte alle Termine für morgen früh",
            None,
            None,
            "en",
        );
        assert_eq!(decided.language, "de");
        assert_eq!(decided.reason, DecisionReason::WordsOnLongTurn);
    }

    #[test]
    fn a_short_unsure_first_turn_is_in_the_main_language() {
        assert_eq!(turn("Hallo", None, None, "en").language, "en");
    }

    #[test]
    fn a_short_answer_keeps_the_chats_language() {
        for text in ["ja", "okay", "mhm", "ok danke"] {
            let decided = turn(text, Some("en"), Some("de"), "en");
            assert_eq!(decided.language, "de", "{text}");
        }
        assert_eq!(turn("okay", None, Some("de"), "en").language, "de");
    }

    #[test]
    fn a_clear_switch_follows_the_speaker() {
        let decided = turn(
            "Let's continue in English, please summarise the last meeting.",
            Some("en"),
            Some("de"),
            "de",
        );
        assert_eq!(decided.language, "en");
    }

    #[test]
    fn a_mixed_sentence_is_the_language_of_its_function_words() {
        let decided = turn(
            "Zeig mir das Forecast-Dashboard",
            Some("de"),
            Some("en"),
            "en",
        );
        assert_eq!(decided.language, "de");
    }

    #[test]
    fn an_accent_taken_for_hindi_keeps_the_chats_language() {
        let decided = turn(
            "Please send the updated report to the whole team today",
            Some("hi"),
            Some("en"),
            "en",
        );
        assert_eq!(decided.language, "en");
        assert_eq!(decided.reason, DecisionReason::KeptChat);
        // In a new chat it is the main language, not the recognizer's guess.
        let fresh = turn(
            "Please send the updated report to the whole team today",
            Some("hi"),
            None,
            "en",
        );
        assert_eq!(fresh.language, "en");
    }

    #[test]
    fn a_language_the_word_check_does_not_know_follows_the_recognizer_on_a_long_turn() {
        let decided = turn(
            "Cho tôi xem lịch họp của ngày mai nhé",
            Some("vi"),
            Some("en"),
            "en",
        );
        assert_eq!(decided.language, "vi");
        // English words heard as Greek are not Greek.
        let decided = turn(
            "Please send the updated report to the whole team today",
            Some("el"),
            Some("en"),
            "en",
        );
        assert_eq!(decided.language, "en");
    }

    #[test]
    fn hindi_spoken_and_written_is_hindi() {
        let decided = turn("मुझे आज की बैठकों की सूची दिखाओ", Some("hi"), Some("en"), "en");
        assert_eq!(decided.language, "hi");
    }

    #[test]
    fn a_recognizer_guess_outside_the_candidates_does_not_count() {
        let only = ["de".to_string(), "en".to_string()];
        let decided = decide(SpokenLanguageInput {
            text: "ja",
            recognizer_language: Some("hi"),
            candidates: Candidates::Only(&only),
            chat_language: Some("de"),
            main_language: "en",
            follow_speaker: true,
        });
        assert_eq!(decided.recognizer, None);
        assert_eq!(decided.language, "de");
    }

    #[test]
    fn not_following_the_speaker_is_always_the_main_language() {
        let decided = decide(SpokenLanguageInput {
            text: "Zeig mir bitte alle Termine für morgen früh",
            recognizer_language: Some("de"),
            candidates: Candidates::Any,
            chat_language: Some("de"),
            main_language: "en",
            follow_speaker: false,
        });
        assert_eq!(decided.language, "en");
    }

    #[test]
    fn language_codes_are_validated_and_reduced() {
        assert_eq!(language_code("de-AT").as_deref(), Some("de"));
        assert_eq!(language_code("pt_BR").as_deref(), Some("pt"));
        assert_eq!(language_code("EN").as_deref(), Some("en"));
        assert_eq!(language_code("German").as_deref(), Some("de"));
        assert_eq!(language_code("hi").as_deref(), Some("hi"));
        for bad in [
            "",
            "d",
            "deutsch!",
            "<script>",
            "de--x",
            "1a",
            "de-AT-toolongsubtag",
        ] {
            assert_eq!(language_code(bad), None, "{bad}");
        }
    }

    #[test]
    fn words_of_unspaced_scripts_count() {
        assert_eq!(word_count("会議の予定を見せて"), 5);
        assert_eq!(word_count("ja"), 1);
        assert_eq!(word_count("…  ?"), 0);
    }

    #[test]
    fn english_names_come_from_the_prompt_map_else_the_code() {
        assert_eq!(english_name("de"), "German");
        assert_eq!(english_name("hi"), "Hindi");
        assert_eq!(english_name("lv"), "lv");
        assert_eq!(english_name("xx"), "xx");
    }
}
