//! Confirmation phrases a language package configures: checked at startup,
//! tried with the German and English ones, and never weaker than they are.

use super::phrase::{match_phrase, phrase_for, syllables, word_syllables};
use super::*;
use erato_config::confirmation_phrases::{
    BUILT_IN_PHRASES, ConfirmationPhraseConfig, ConfirmationPhrasesByLanguage,
};
use erato_config::voice_command_words::{VoiceCommandWordLists, VoiceCommandWordsByLanguage};

const JE_CONFIRME_THREE_SYLLABLES: &str = "approval_voice_decisions.phrases.fr: 'Je confirme' has only 3 syllables; a longer phrase is heard by mistake less often";

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
    assert_eq!(notes, [JE_CONFIRME_THREE_SYLLABLES], "{notes:?}");
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
    assert_eq!(syllables(matched.phrase), 3);
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
        (phrase("Oui", &[], &[]), "it has 1 syllable;"),
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
            JE_CONFIRME_THREE_SYLLABLES,
        ]
    );
    let fr = words.for_language("fr");
    assert!(match_phrase("Oui je confirme svp", &[], fr).is_some());
    assert!(match_phrase("Si je confirme", &[], fr).is_none());
    assert!(match_phrase("Je confirme pas", &[], fr).is_none());
}

#[test]
fn three_syllables_are_kept_with_a_warning() {
    let (words, notes) = french(phrase("Je confirme", &[], &[]));
    assert_eq!(notes, [JE_CONFIRME_THREE_SYLLABLES]);
    assert!(match_phrase("Je confirme.", &[], words.for_language("fr")).is_some());
    let (words, notes) = french(phrase("J'approuve", &[], &[]));
    assert_eq!(
        notes,
        [
            "approval_voice_decisions.phrases.fr: 'J'approuve' is ignored: it has 2 syllables; at least 3 keep a short sound from approving"
        ]
    );
    assert!(words.for_language("fr").phrase_of("fr").is_none());
}

#[test]
fn syllables_count_vowel_groups_and_characters_of_chinese_japanese_and_korean() {
    for (word, language, count) in [
        ("bestaetige", "de", Some(4)),
        ("confirm", "en", Some(2)),
        ("confirmé", "fr", Some(3)),
        ("potwierdzam", "pl", Some(3)),
        ("sí", "es", Some(1)),
        ("œuvre", "fr", Some(1)),
        ("bekræfter", "da", Some(3)),
        ("bekräftar", "sv", Some(3)),
        ("brr", "de", Some(1)),
        // A final "e" or "es" after a consonant is silent in French and
        // English, and so is an English "ed" after one but "t" or "d".
        ("japprouve", "fr", Some(2)),
        ("je", "fr", Some(1)),
        ("confirme", "fr", Some(2)),
        ("confirmes", "fr", Some(2)),
        ("sure", "en", Some(1)),
        ("fine", "en", Some(1)),
        ("confirmed", "en", Some(2)),
        ("accepted", "en", Some(3)),
        ("agree", "en", Some(2)),
        ("bestaetige", "en-GB", Some(3)),
        ("sure", "de", Some(2)),
        ("确认", "zh", Some(2)),
        ("かくにん", "ja", Some(4)),
        ("カクニン", "ja", Some(4)),
        ("확인", "ko", Some(2)),
        ("подтверждаю", "ru", None),
        ("επιβεβαιώνω", "el", None),
        ("أؤكد", "ar", None),
        ("מאשר", "he", None),
        ("पुष्टि", "hi", None),
    ] {
        assert_eq!(word_syllables(word, language), count, "{word} ({language})");
    }
}

#[test]
fn a_phrase_in_a_script_whose_syllables_are_not_counted_is_refused() {
    let (words, notes) = built(&[], &[("ru", phrase("Я подтверждаю", &[], &[]))]);
    assert_eq!(
        notes,
        [
            "approval_voice_decisions.phrases.ru: 'Я подтверждаю' is ignored: cannot count syllables for this script"
        ]
    );
    assert!(words.for_language("ru").phrase_of("ru").is_none());
    let (words, notes) = built(&[], &[("ja", phrase("承認します", &[], &[]))]);
    assert!(notes.is_empty(), "{notes:?}");
    assert_eq!(
        syllables(words.for_language("ja").phrase_of("ja").unwrap()),
        5
    );
}

#[test]
fn casual_approvals_are_refused_as_phrases() {
    for (language, said) in [
        ("en", "Sure, fine"),
        ("de", "Ja, bitte gern"),
        ("de", "In Ordnung"),
        ("en", "Go ahead"),
        ("en", "Sounds good"),
        ("de", "Geht klar"),
        ("de", "Ja, das passt"),
        ("en", "Thank you"),
        ("en", "Okay, go"),
        ("de", "Vielen Dank"),
        ("de", "Alles klar, genau"),
    ] {
        let (words, notes) = built(&[], &[(language, phrase(said, &[], &[]))]);
        assert_eq!(notes.len(), 1, "{said}: {notes:?}");
        assert!(
            notes[0].starts_with(&format!(
                "approval_voice_decisions.phrases.{language}: '{said}' is ignored: "
            )),
            "{notes:?}"
        );
        let built_in = words.for_language(language).phrase_of(language).unwrap();
        assert!(built_in.id.starts_with(&format!("{language}.")), "{said}");
        assert_ne!(built_in.shown, said);
    }
    // A package can add its own.
    let fr = VoiceCommandWordLists {
        casual_approvals: strings(&["ça marche pour moi"]),
        ..french_words()
    };
    let (words, notes) = built(
        &[("fr", fr)],
        &[("fr", phrase("Ça marche pour moi", &[], &[]))],
    );
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].contains("said in passing"), "{notes:?}");
    assert!(words.for_language("fr").phrase_of("fr").is_none());
}

#[test]
fn the_built_in_phrases_pass_their_own_check() {
    let built_ins: Vec<(&str, ConfirmationPhraseConfig)> = BUILT_IN_PHRASES
        .iter()
        .map(|phrase| (phrase.language, phrase.config()))
        .collect();
    let (words, notes) = built(&[], &built_ins);
    assert_eq!(
        notes,
        [
            "approval_voice_decisions.phrases.en: 'I confirm' has only 3 syllables; a longer phrase is heard by mistake less often"
        ]
    );
    let de = words.for_language("de").phrase_of("de").unwrap();
    let en = words.for_language("en").phrase_of("en").unwrap();
    assert_eq!(de, phrase_for("de").unwrap());
    assert_eq!(en, phrase_for("en").unwrap());
}

#[test]
fn a_phrase_that_holds_a_refusal_is_refused() {
    for (language, said) in [
        ("en", "Cancel it now"),
        ("de", "Vergiss es bitte"),
        ("de", "Bitte vergiss es"),
        ("en", "I confirm, forget it"),
    ] {
        let (words, notes) = built(&[], &[(language, phrase(said, &[], &[]))]);
        assert_eq!(notes.len(), 1, "{said}: {notes:?}");
        assert!(notes[0].contains("is ignored"), "{notes:?}");
        assert!(
            match_phrase(said, &[], words.for_language(language)).is_none(),
            "{said}"
        );
    }
}

#[test]
fn leading_and_trailing_words_never_stop_refuse_ask_or_repeat_the_phrase() {
    let (words, notes) = french(phrase(
        "Je confirme",
        &["can", "stopp", "je", "oui"],
        &["confirme", "annule", "svp"],
    ));
    for (kind, entry, problem) in [
        (
            "leading",
            "can",
            "it is a negation, condition or question word",
        ),
        ("leading", "stopp", "it stops the voice"),
        ("leading", "je", "it is the phrase's own first or last word"),
        (
            "trailing",
            "confirme",
            "it is the phrase's own first or last word",
        ),
        ("trailing", "annule", "it refuses"),
    ] {
        let note =
            format!("approval_voice_decisions.phrases.fr.{kind}: '{entry}' is ignored: {problem}");
        assert!(notes.contains(&note), "{note}: {notes:?}");
    }
    assert_eq!(notes.len(), 6, "{notes:?}");
    let phrase = words.for_language("fr").phrase_of("fr").unwrap();
    assert_eq!(phrase.leading, ["oui"]);
    assert_eq!(phrase.trailing, ["svp"]);
    assert!(match_phrase("Stopp, je confirme", &[], words.for_language("fr")).is_none());
    assert!(match_phrase("Je je confirme", &[], words.for_language("fr")).is_none());
}

#[test]
fn quote_and_question_marks_of_other_scripts_are_never_a_phrase() {
    let words = CommandWordsByLanguage::default();
    let de = words.for_language("de");
    assert!(match_phrase("Ich bestätige", &[], de).is_some());
    assert!(match_phrase("Ich bestätige;", &[], de).is_some());
    for said in [
        "Ich bestätige؟",
        "Ich bestätige\u{37e}",
        "Ich bestätige՞",
        "Ich bestätige፧",
        "『Ich bestätige』",
    ] {
        assert!(match_phrase(said, &[], de).is_none(), "{said}");
    }
}

#[test]
fn a_hesitation_the_decisions_rely_on_is_never_trimmed() {
    let config = erato_config::config::AudioConversationalConfig {
        hesitations: std::collections::HashMap::from([(
            "de".to_string(),
            strings(&["halt", "ja", "nein", "euh"]),
        )]),
        hesitation_words: strings(&["stopp", "erm"]),
        ..Default::default()
    };
    let words = CommandWordsByLanguage::default();
    let de = words.for_language("de");
    let on_de = config.effective_hesitation_words_for("de");
    for said in [
        "Ich bestätige – halt!",
        "Ich bestätige, stopp",
        "Halt, ich bestätige",
        "Ich bestätige, nein",
        "Nein, ich bestätige",
    ] {
        assert!(match_phrase(said, &on_de, de).is_none(), "{said}");
    }
    assert!(match_phrase("Euh, ich bestätige", &on_de, de).is_some());
    assert_eq!(
        words.hesitation_notes(&config),
        [
            "audio_conversational.hesitation_words: 'stopp' is never trimmed before a confirmation phrase, since the voice commands rely on it",
            "audio_conversational.hesitations.de: 'halt' is never trimmed before a confirmation phrase, since the voice commands rely on it",
            "audio_conversational.hesitations.de: 'ja' is never trimmed before a confirmation phrase, since the voice commands rely on it",
            "audio_conversational.hesitations.de: 'nein' is never trimmed before a confirmation phrase, since the voice commands rely on it",
        ]
    );
    assert!(
        CommandWordsByLanguage::default()
            .hesitation_notes(&erato_config::config::AudioConversationalConfig::default())
            .is_empty()
    );
}

#[test]
fn the_startup_log_names_dropped_and_kept_phrases_and_screen_only_languages() {
    let words: VoiceCommandWordsByLanguage = [
        ("fr".to_string(), french_words()),
        ("es".to_string(), VoiceCommandWordLists::default()),
    ]
    .into_iter()
    .collect();
    let phrases: ConfirmationPhrasesByLanguage = [
        ("fr".to_string(), phrase("Je confirme", &[], &[])),
        ("es".to_string(), phrase("Sí", &[], &[])),
    ]
    .into_iter()
    .collect();
    let log = logged(|| {
        CommandWordsByLanguage::from_config(&words, &phrases);
    });
    for line in [
        "Confirmation phrase dropped: approval_voice_decisions.phrases.es: 'Sí' is ignored: it has 1 syllable; at least 3 keep a short sound from approving.",
        "Confirmation phrase kept with a warning: approval_voice_decisions.phrases.fr: 'Je confirme' has only 3 syllables; a longer phrase is heard by mistake less often.",
        "Confirmation phrases on `de/en` cards: 'Ich bestätige' (de), 'I confirm' (en).",
        "Confirmation phrases on `es` cards: none, screen only.",
        "Confirmation phrases on `fr` cards: 'Ich bestätige' (de), 'I confirm' (en), 'Je confirme' (fr).",
    ] {
        assert!(log.contains(line), "{line}\n{log}");
    }
    assert!(
        !log.contains("Voice-command word dropped: approval_voice_decisions"),
        "{log}"
    );
}

/// What `run` logged.
fn logged(run: impl FnOnce()) -> String {
    #[derive(Clone, Default)]
    struct Capture(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
    impl std::io::Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let capture = Capture::default();
    let writer = capture.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::with_default(subscriber, run);
    String::from_utf8(capture.0.lock().unwrap().clone()).unwrap()
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
