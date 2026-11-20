//! Confirmation phrases a language package configures: checked at startup,
//! tried with the German and English ones, and never weaker than they are.

use super::phrase::{match_phrase, syllables, word_syllables};
use super::*;
use erato_config::confirmation_phrases::{ConfirmationPhraseConfig, ConfirmationPhrasesByLanguage};
use erato_config::voice_command_words::{VoiceCommandWordLists, VoiceCommandWordsByLanguage};

fn strings(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| word.to_string()).collect()
}

fn french_words() -> VoiceCommandWordLists {
    VoiceCommandWordLists {
        reject: strings(&["non", "annule tout de suite"]),
        negations: strings(&["non", "ne", "pas", "jamais"]),
        conditions: strings(&["mais", "si", "sauf"]),
        wh_words: strings(&["comment", "pourquoi", "quoi"]),
        hesitations: strings(&["euh", "bah"]),
        ..Default::default()
    }
}

fn phrase(phrase: &str, leading: &[&str], trailing: &[&str]) -> ConfirmationPhraseConfig {
    ConfirmationPhraseConfig {
        phrase: phrase.to_string(),
        leading: strings(leading),
        trailing: strings(trailing),
    }
}

fn built(
    words: &[(&str, VoiceCommandWordLists)],
    phrases: &[(&str, ConfirmationPhraseConfig)],
) -> (CommandWordsByLanguage, Vec<String>) {
    let words: VoiceCommandWordsByLanguage = words
        .iter()
        .map(|(language, lists)| (language.to_string(), lists.clone()))
        .collect();
    let phrases: ConfirmationPhrasesByLanguage = phrases
        .iter()
        .map(|(language, phrase)| (language.to_string(), phrase.clone()))
        .collect();
    CommandWordsByLanguage::build(&words, &phrases)
}

fn french(fr: ConfirmationPhraseConfig) -> (CommandWordsByLanguage, Vec<String>) {
    built(&[("fr", french_words())], &[("fr", fr)])
}

#[test]
fn a_french_phrase_approves_a_french_card_beside_german_and_english() {
    let (words, notes) = french(phrase("Je confirme", &["oui"], &["svp"]));
    assert!(notes.is_empty(), "{notes:?}");
    let fr = words.for_language("fr-CA");
    for said in [
        "Je confirme.",
        "je confirme",
        "Oui, je confirme.",
        "Je confirme, svp.",
        "Euh, je confirme.",
        "Ich bestätige.",
        "I confirm.",
    ] {
        assert!(match_phrase(said, &[], fr).is_some(), "{said}");
    }
    let matched = match_phrase("Oui, je confirme", &[], fr).unwrap();
    assert_eq!(matched.phrase.id, "fr.je_confirme");
    assert_eq!(matched.kind, PhraseMatchKind::Variant);
    assert_eq!(syllables(matched.phrase), 4);
    assert_eq!(fr.phrase_of("fr").unwrap().shown, "Je confirme");
    // Other cards do not take it.
    assert!(match_phrase("Je confirme", &[], words.for_language("de")).is_none());
    assert!(match_phrase("Je confirme", &[], words.for_language("es")).is_none());
}

#[test]
fn a_configured_phrase_never_approves_a_negated_or_longer_sentence() {
    let (words, _) = french(phrase("Je confirme", &["oui"], &["svp"]));
    let fr = words.for_language("fr");
    for said in [
        "Je ne confirme pas",
        "je confirme pas",
        "Non, je confirme",
        "Je confirme, mais demain",
        "Si je confirme",
        "Je confirme?",
        "Je confirme…",
        "« Je confirme »",
        "Je confirme demain",
        "Alors je confirme",
        "Oui oui je confirme",
        "Je confirme svp svp",
        "Je confirme, nicht",
        "Comment je confirme",
    ] {
        assert!(match_phrase(said, &[], fr).is_none(), "{said}");
        assert!(
            match_phrase(said, &strings(&["ne", "pas", "mais"]), fr).is_none(),
            "{said}"
        );
    }
    let (words, notes) = built(&[], &[("de", phrase("Ich stimme zu", &["ja"], &[]))]);
    assert!(notes.is_empty(), "{notes:?}");
    let de = words.for_language("de");
    assert!(match_phrase("Ja, ich stimme zu.", &[], de).is_some());
    assert!(match_phrase("Ich bestätige.", &[], de).is_none());
    assert!(match_phrase("I confirm.", &[], de).is_some());
    for said in [
        "Ich stimme nicht zu",
        "ich stimme zu, aber",
        "Ich stimme zu, wenn",
        "Wie, ich stimme zu",
        "Ich stimme zu und gehe",
    ] {
        assert!(match_phrase(said, &[], de).is_none(), "{said}");
    }
}

#[test]
fn the_checker_drops_a_phrase_that_could_be_heard_by_mistake() {
    for (fr, problem) in [
        (phrase("Oui", &[], &[]), "it has 1 syllables"),
        (phrase("C'est ça", &[], &[]), "it has 2 syllables"),
        (
            phrase("Je ne refuse pas", &[], &[]),
            "a negation, condition or question word",
        ),
        (
            phrase("Je confirme mais", &[], &[]),
            "a negation, condition or question word",
        ),
        (
            phrase("Je confirme comment", &[], &[]),
            "a negation, condition or question word",
        ),
        (phrase("Code 4711 validé", &[], &[]), "a digit"),
        (
            phrase("Okay okay okay", &[], &[]),
            "only noise or hesitation",
        ),
        (
            phrase("Euh euh euh euh", &[], &[]),
            "only noise or hesitation",
        ),
        (phrase("Annule tout", &[], &[]), "a refusal starts with it"),
        (phrase("Lass es sein", &[], &[]), "a refusal starts with it"),
        (phrase("?!", &[], &[]), "it holds no word"),
    ] {
        let (words, notes) = french(fr.clone());
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert!(
            notes[0].starts_with(&format!(
                "approval_voice_decisions.phrases.fr: '{}' is ignored: ",
                fr.phrase
            )) && notes[0].contains(problem),
            "{notes:?}"
        );
        let fr = words.for_language("fr");
        assert!(fr.phrase_of("fr").is_none());
        assert_eq!(
            fr.phrases
                .iter()
                .map(|phrase| phrase.id.as_str())
                .collect::<Vec<_>>(),
            ["de.ich_bestaetige", "en.i_confirm"]
        );
    }
}

#[test]
fn a_dropped_german_phrase_leaves_the_built_in_one() {
    let (words, notes) = built(&[], &[("de", phrase("Nein danke", &[], &[]))]);
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(match_phrase("Ich bestätige", &[], words.for_language("de")).is_some());
}

#[test]
fn leading_and_trailing_words_are_checked_one_by_one() {
    let (words, notes) = french(phrase(
        "Je confirme",
        &["oui", "si", "bon alors"],
        &["svp", "4", "pas"],
    ));
    assert_eq!(
        notes,
        [
            "approval_voice_decisions.phrases.fr.leading: 'bon alors' is ignored: it must be one word",
            "approval_voice_decisions.phrases.fr.leading: 'si' is ignored: it is a negation, condition or question word",
            "approval_voice_decisions.phrases.fr.trailing: '4' is ignored: it holds a digit",
            "approval_voice_decisions.phrases.fr.trailing: 'pas' is ignored: it is a negation, condition or question word",
        ]
    );
    let fr = words.for_language("fr");
    assert!(match_phrase("Oui je confirme svp", &[], fr).is_some());
    assert!(match_phrase("Si je confirme", &[], fr).is_none());
    assert!(match_phrase("Je confirme pas", &[], fr).is_none());
}

#[test]
fn three_syllables_are_kept_with_a_warning() {
    let (words, notes) = french(phrase("J'approuve", &[], &[]));
    assert_eq!(
        notes,
        [
            "approval_voice_decisions.phrases.fr: 'J'approuve' has only 3 syllables; a longer phrase is heard by mistake less often"
        ]
    );
    assert!(match_phrase("J'approuve.", &[], words.for_language("fr")).is_some());
}

#[test]
fn syllables_count_accented_vowels_and_letters_of_other_scripts() {
    for (word, count) in [
        ("bestaetige", 4),
        ("confirm", 2),
        ("confirmé", 3),
        ("potwierdzam", 3),
        ("sí", 1),
        ("œuvre", 2),
        ("bekræfter", 3),
        ("bekräftar", 3),
        ("确认", 2),
        ("подтверждаю", 11),
        ("brr", 1),
    ] {
        assert_eq!(word_syllables(word), count, "{word}");
    }
}

#[test]
fn a_language_without_a_phrase_stays_screen_only() {
    let (words, _) = french(phrase("Je confirme", &[], &[]));
    for language in ["es", "pl", "it"] {
        assert!(words.for_language(language).phrase_of(language).is_none());
    }
    let words = CommandWordsByLanguage::default();
    assert!(words.for_language("fr").phrase_of("fr").is_none());
    assert_eq!(
        words.for_language("de-DE").phrase_of("de-DE").unwrap().id,
        "de.ich_bestaetige"
    );
    assert_eq!(
        words.for_language("en").phrase_of("en").unwrap().id,
        "en.i_confirm"
    );
}

#[test]
fn only_configured_phrases_are_handed_on_as_shown() {
    let (words, _) = built(
        &[],
        &[
            ("fr", phrase("Je confirme", &[], &[])),
            ("es", phrase("Sí", &[], &[])),
        ],
    );
    assert_eq!(
        words.shown_phrases(),
        std::collections::BTreeMap::from([
            ("de".to_string(), "Ich bestätige".to_string()),
            ("en".to_string(), "I confirm".to_string()),
            ("fr".to_string(), "Je confirme".to_string()),
        ])
    );
}

#[test]
fn a_french_hesitation_holds_a_french_card_but_not_an_english_one() {
    let config = erato_config::config::AudioConversationalConfig {
        hesitations: std::collections::HashMap::from([("fr".to_string(), strings(&["euh"]))]),
        ..Default::default()
    };
    let (words, _) = built(&[], &[("fr", phrase("Je confirme", &[], &[]))]);
    let fr = words.for_language("fr");
    let en = words.for_language("en");
    let on_fr = config.effective_hesitation_words_for("fr");
    let on_en = config.effective_hesitation_words_for("en");
    assert!(match_phrase("Euh, je confirme", &on_fr, fr).is_some());
    assert!(match_phrase("Euh, I confirm", &on_fr, fr).is_some());
    assert!(match_phrase("Euh, je confirme", &[], fr).is_none());
    assert!(match_phrase("Euh, I confirm", &on_en, en).is_none());
}
