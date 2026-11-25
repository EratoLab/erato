//! The sentence sets and the attack phrasings, kept in the binary so the
//! startup check can rerun them against the configured words.

use super::{CardPiece, VoiceMeaning};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Card {
    pub current_piece_id: String,
    pub pieces: Vec<CardPiece>,
}

/// The fields besides language and text are read by the tests.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(not(test), allow(dead_code))]
pub(super) struct Sentence {
    pub id: String,
    pub language: String,
    pub meaning: VoiceMeaning,
    pub way: String,
    pub text: String,
    pub piece_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct SentenceSet {
    pub cards: HashMap<String, Card>,
    pub sentences: Vec<Sentence>,
}

pub(super) fn sentence_set() -> SentenceSet {
    serde_json::from_str(include_str!("sentences.json")).expect("the sentence set is valid")
}

/// Sentences written by a reviewer and never used to tune the rules or the
/// instruction.
pub(super) fn heldout_set() -> SentenceSet {
    serde_json::from_str(include_str!("heldout_sentences.json")).expect("the held-out set is valid")
}

/// Questions for one field of the visit report card from MS staging
/// (2026-11-23), with and without the fields' German names; scored by the
/// eval, not part of the startup check.
#[cfg(test)]
pub(super) fn field_question_set() -> SentenceSet {
    serde_json::from_str(include_str!("field_question_sentences.json"))
        .expect("the field question set is valid")
}

/// The adversarial phrasings, as (language, words).
pub(super) fn attacks() -> Vec<(&'static str, &'static str)> {
    include_str!("attacks.txt")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.split_once('|').expect("language|words"))
        .collect()
}

/// One phrasing the startup check reruns.
pub(super) struct Phrasing {
    pub language: String,
    pub said: String,
    /// What the sentence sets say it means, on any card; empty for an attack
    /// phrasing no sentence labels.
    pub meant: Vec<VoiceMeaning>,
}

/// Every phrasing the startup check reruns, and the cards it says them on:
/// before and after each card asked.
pub(super) struct Corpus {
    pub phrasings: Vec<Phrasing>,
    pub cards: Vec<Card>,
}

pub(super) static CORPUS: LazyLock<Corpus> = LazyLock::new(|| {
    let set = sentence_set();
    let heldout = heldout_set();
    let mut meant: BTreeMap<(String, String), Vec<VoiceMeaning>> = attacks()
        .into_iter()
        .map(|(language, said)| ((language.to_string(), said.to_string()), Vec::new()))
        .collect();
    for sentence in set.sentences.iter().chain(&heldout.sentences) {
        let meanings = meant
            .entry((sentence.language.clone(), sentence.text.clone()))
            .or_default();
        if !meanings.contains(&sentence.meaning) {
            meanings.push(sentence.meaning);
        }
    }
    let phrasings = meant
        .into_iter()
        .map(|((language, said), meant)| Phrasing {
            language,
            said,
            meant,
        })
        .collect();
    let cards = ["de", "de-asked", "en", "en-asked"]
        .into_iter()
        .map(|card| set.cards[card].clone())
        .collect();
    Corpus { phrasings, cards }
});

/// The example cards of a language once they have asked for a decision: the
/// German or English one, or both for any other language.
pub(super) fn asked_cards(language: &str) -> Vec<&'static Card> {
    match language.split(['-', '_']).next().unwrap_or(language) {
        "de" => vec![&CORPUS.cards[1]],
        "en" => vec![&CORPUS.cards[3]],
        _ => vec![&CORPUS.cards[1], &CORPUS.cards[3]],
    }
}
