//! The sentence sets and the attack phrasings, kept in the binary so the
//! startup check can rerun them against the configured words.

use super::{CardPiece, VoiceMeaning};
use serde::Deserialize;
use std::collections::HashMap;
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

/// The adversarial phrasings, as (language, words).
pub(super) fn attacks() -> Vec<(&'static str, &'static str)> {
    include_str!("attacks.txt")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.split_once('|').expect("language|words"))
        .collect()
}

/// Every phrasing the startup check reruns, as (language, words), and the
/// cards it says them on: before and after each card asked.
pub(super) struct Corpus {
    pub phrasings: Vec<(String, String)>,
    pub cards: Vec<Card>,
}

pub(super) static CORPUS: LazyLock<Corpus> = LazyLock::new(|| {
    let set = sentence_set();
    let heldout = heldout_set();
    let mut phrasings: Vec<(String, String)> = attacks()
        .into_iter()
        .map(|(language, said)| (language.to_string(), said.to_string()))
        .collect();
    phrasings.extend(
        set.sentences
            .iter()
            .chain(&heldout.sentences)
            .map(|sentence| (sentence.language.clone(), sentence.text.clone())),
    );
    phrasings.sort();
    phrasings.dedup();
    let cards = ["de", "de-asked", "en", "en-asked"]
        .into_iter()
        .map(|card| set.cards[card].clone())
        .collect();
    Corpus { phrasings, cards }
});

/// The German example card once it has asked for a decision.
pub(super) fn asked_card() -> &'static Card {
    &CORPUS.cards[1]
}
