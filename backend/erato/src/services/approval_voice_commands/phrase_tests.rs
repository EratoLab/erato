//! Confirmation phrases a language package configures: checked at startup,
//! tried with the German and English ones, and never weaker than they are.

use super::phrase::{built_in_phrases, match_phrase, syllables, word_syllables};
use super::*;
use erato_config::confirmation_phrases::{
    BUILT_IN_PHRASES, ConfirmationPhraseConfig, ConfirmationPhrasesByLanguage,
};
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

/// French words with the yes, casual approvals and filler a phrase is
/// checked against and may stand beside.
fn quiet_french_words() -> VoiceCommandWordLists {
    VoiceCommandWordLists {
        yes_particles: strings(&["oui", "ouais"]),
        casual_approvals: strings(&["d'accord", "ça marche"]),
        fillers: strings(&["svp"]),
        ..french_words()
    }
}

fn french(fr: ConfirmationPhraseConfig) -> (CommandWordsByLanguage, Vec<String>) {
    built(&[("fr", quiet_french_words())], &[("fr", fr)])
}

#[test]
fn a_french_phrase_approves_a_french_card_beside_german_and_english() {
    let (words, notes) = french(phrase("Je confirme l'action", &["oui"], &["svp"]));
    assert!(notes.is_empty(), "{notes:?}");
    let fr = words.for_language("fr-CA");
    for said in [
        "Je confirme l'action.",
        "je confirme l'action",
        "Oui, je confirme l'action.",
        "Je confirme l'action, svp.",
        "Euh, je confirme l'action.",
        "Ich bestätige.",
        "I confirm.",
    ] {
        assert!(match_phrase(said, fr).is_some(), "{said}");
    }
    let matched = match_phrase("Oui, je confirme l'action", fr).unwrap();
    assert_eq!(matched.phrase.id, "fr.je_confirme_laction");
    assert_eq!(matched.kind, PhraseMatchKind::Variant);
    assert_eq!(syllables(matched.phrase), 5);
    assert_eq!(fr.phrase_of("fr").unwrap().shown, "Je confirme l'action");
    assert!(match_phrase("Je confirme l'action", words.for_language("de")).is_none());
    assert!(match_phrase("Je confirme l'action", words.for_language("es")).is_none());
}

#[test]
fn a_configured_phrase_never_approves_a_negated_or_longer_sentence() {
    let (words, _) = french(phrase("Je confirme l'action", &["oui"], &["svp"]));
    let fr = words.for_language("fr");
    for said in [
        "Je ne confirme pas",
        "je confirme l'action pas",
        "Non, je confirme l'action",
        "Je confirme l'action, mais demain",
        "Si je confirme l'action",
        "Je confirme l'action?",
        "Je confirme l'action…",
        "« Je confirme l'action »",
        "Je confirme l'action demain",
        "Alors je confirme l'action",
        "Oui oui je confirme l'action",
        "Je confirme l'action svp svp",
        "Je confirme l'action, nicht",
        "Comment je confirme l'action",
    ] {
        assert!(match_phrase(said, fr).is_none(), "{said}");
    }
    let (words, notes) = built(&[], &[("de", phrase("Ich gebe das frei", &["ja"], &[]))]);
    assert!(notes.is_empty(), "{notes:?}");
    let de = words.for_language("de");
    assert!(match_phrase("Ja, ich gebe das frei.", de).is_some());
    assert!(match_phrase("Ich bestätige.", de).is_none());
    assert!(match_phrase("I confirm.", de).is_some());
    for said in [
        "Ich gebe das nicht frei",
        "ich gebe das frei, aber",
        "Ich gebe das frei, wenn",
        "Wie, ich gebe das frei",
        "Ich gebe das frei und gehe",
    ] {
        assert!(match_phrase(said, de).is_none(), "{said}");
    }
}

#[test]
fn the_checker_drops_a_phrase_that_could_be_heard_by_mistake() {
    for (fr, problem) in [
        (phrase("Oui", &[], &[]), "only noise or hesitation"),
        (phrase("C'est ça", &[], &[]), "it has 2 syllables"),
        (
            phrase("Je ne refuse pas", &[], &[]),
            "a negation, condition or question word",
        ),
        (
            phrase("Je confirme l'action mais", &[], &[]),
            "a negation, condition or question word",
        ),
        (
            phrase("Je confirme l'action comment", &[], &[]),
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
        let (words, notes) = built(&[("fr", quiet_french_words())], &[("fr", fr.clone())]);
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
    assert!(match_phrase("Ich bestätige", words.for_language("de")).is_some());
}

#[test]
fn leading_and_trailing_words_are_checked_one_by_one() {
    let (words, notes) = french(phrase(
        "Je confirme l'action",
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
    assert!(match_phrase("Oui je confirme l'action svp", fr).is_some());
    assert!(match_phrase("Si je confirme l'action", fr).is_none());
    assert!(match_phrase("Je confirme l'action pas", fr).is_none());
}

#[test]
fn three_syllables_are_kept_with_a_warning() {
    let (words, notes) = built(&[], &[("en", phrase("I sign off", &[], &[]))]);
    assert_eq!(
        notes,
        [
            "approval_voice_decisions.phrases.en: 'I sign off' has only 3 syllables; a longer phrase is heard by mistake less often"
        ]
    );
    assert!(match_phrase("I sign off.", words.for_language("en")).is_some());
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
    let russian = VoiceCommandWordLists {
        yes_particles: strings(&["да"]),
        casual_approvals: strings(&["ладно"]),
        ..Default::default()
    };
    let (words, notes) = built(
        &[("ru", russian)],
        &[("ru", phrase("Я подтверждаю", &[], &[]))],
    );
    assert_eq!(
        notes,
        [
            "approval_voice_decisions.phrases.ru: 'Я подтверждаю' is ignored: cannot count syllables for this script"
        ]
    );
    assert!(words.for_language("ru").phrase_of("ru").is_none());
    let japanese = VoiceCommandWordLists {
        yes_particles: strings(&["はい"]),
        casual_approvals: strings(&["いいよ"]),
        ..Default::default()
    };
    let (words, notes) = built(
        &[("ja", japanese)],
        &[("ja", phrase("承認します", &[], &[]))],
    );
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
        ..quiet_french_words()
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
    assert_eq!([de, en], [&built_in_phrases()[0], &built_in_phrases()[1]]);
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
            match_phrase(said, words.for_language(language)).is_none(),
            "{said}"
        );
    }
}

#[test]
fn leading_and_trailing_words_never_stop_refuse_ask_or_repeat_the_phrase() {
    let (words, notes) = french(phrase(
        "Je confirme l'action",
        &["can", "stopp", "je", "oui"],
        &["l'action", "annule", "svp"],
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
            "l'action",
            "it is the phrase's own first or last word",
        ),
        ("trailing", "annule", "it refuses"),
    ] {
        let note =
            format!("approval_voice_decisions.phrases.fr.{kind}: '{entry}' is ignored: {problem}");
        assert!(notes.contains(&note), "{note}: {notes:?}");
    }
    assert_eq!(notes.len(), 5, "{notes:?}");
    let phrase = words.for_language("fr").phrase_of("fr").unwrap();
    assert_eq!(phrase.leading, ["oui"]);
    assert_eq!(phrase.trailing, ["svp"]);
    assert!(match_phrase("Stopp, je confirme l'action", words.for_language("fr")).is_none());
    assert!(match_phrase("Je je confirme l'action", words.for_language("fr")).is_none());
}

#[test]
fn quote_and_question_marks_of_other_scripts_are_never_a_phrase() {
    let words = CommandWordsByLanguage::default();
    let de = words.for_language("de");
    assert!(match_phrase("Ich bestätige", de).is_some());
    assert!(match_phrase("Ich bestätige;", de).is_some());
    for said in [
        "Ich bestätige؟",
        "Ich bestätige\u{37e}",
        "Ich bestätige՞",
        "Ich bestätige፧",
        "『Ich bestätige』",
    ] {
        assert!(match_phrase(said, de).is_none(), "{said}");
    }
}

#[test]
fn turn_end_hesitations_are_never_trimmed_before_a_phrase() {
    let mut config = erato_config::config::AudioConversationalConfig {
        hesitations: std::collections::HashMap::from([
            (
                "de".to_string(),
                strings(&["halt", "ja", "nein", "euh", "vielleicht"]),
            ),
            ("pl".to_string(), strings(&["yyy", "eee"])),
        ]),
        hesitation_words: strings(&["stopp", "erm", "maybe"]),
        ..Default::default()
    };
    let words = CommandWordsByLanguage::default();
    let (warnings, notes) = words.check_turn_hesitations(&mut config);
    assert_eq!(
        warnings,
        [
            "`audio_conversational.hesitations.de` entry \"nein\" dropped: it is a negation, condition or question word, which is never only a hesitation."
        ]
    );
    let de = words.for_language("de");
    for said in [
        "Ich bestätige – halt!",
        "Ich bestätige, stopp",
        "Halt, ich bestätige",
        "Ich bestätige, nein",
        "Nein, ich bestätige",
        "Euh, ich bestätige",
        "Ich bestätige vielleicht",
        "Maybe I confirm",
    ] {
        assert!(match_phrase(said, de).is_none(), "{said}");
    }
    assert!(match_phrase("Erm, ich bestätige", de).is_some());
    let add = |language: &str| {
        format!(
            "only hold a turn and are not trimmed before a confirmation phrase; add them to `approval_voice_commands.words.{language}.hesitations` for that"
        )
    };
    // Polish cards have no phrase: nothing to trim there.
    assert_eq!(
        notes,
        [
            format!(
                "audio_conversational.hesitation_words: 'stopp', 'maybe' {}",
                add("<language>")
            ),
            format!(
                "audio_conversational.hesitations.de: 'halt', 'ja', 'euh', 'vielleicht' {}",
                add("de")
            ),
        ]
    );
    let (warnings, notes) = CommandWordsByLanguage::default()
        .check_turn_hesitations(&mut erato_config::config::AudioConversationalConfig::default());
    assert!(warnings.is_empty() && notes.is_empty());
}

#[test]
fn turn_end_hesitations_drop_guard_words_of_their_language() {
    let mut config = erato_config::config::AudioConversationalConfig {
        hesitations: std::collections::HashMap::from([(
            "fr".to_string(),
            strings(&["Euh", "bah", "ne", "pas", "Comment", "euh bah", "42"]),
        )]),
        ..Default::default()
    };
    let words: VoiceCommandWordsByLanguage = [("fr".to_string(), french_words())].into();
    let (words, _) = CommandWordsByLanguage::build(&words, &Default::default());
    let (warnings, _) = words.check_turn_hesitations(&mut config);
    assert_eq!(warnings.len(), 5, "{warnings:?}");
    for dropped in ["\"ne\"", "\"pas\"", "\"Comment\""] {
        assert!(
            warnings
                .iter()
                .any(|warning| warning.contains(dropped)
                    && warning.contains("never only a hesitation")),
            "{dropped}: {warnings:?}"
        );
    }
    assert_eq!(config.hesitations["fr"], ["euh", "bah"]);
}

#[test]
fn a_phrase_made_of_casual_approvals_or_holding_a_stop_is_refused() {
    for (language, said, problem) in [
        ("en", "Sure, go ahead", "made of approvals said in passing"),
        ("en", "Okay, go ahead", "made of approvals said in passing"),
        (
            "en",
            "I confirm, go ahead",
            "made of approvals said in passing",
        ),
        (
            "de",
            "Okay, passt, mach das so",
            "made of approvals said in passing",
        ),
        (
            "de",
            "Geht klar, mach das so",
            "made of approvals said in passing",
        ),
        ("en", "Wait, I confirm", "a word that stops the voice"),
        ("de", "Moment, ich bestätige", "a word that stops the voice"),
    ] {
        let (words, notes) = built(&[], &[(language, phrase(said, &[], &[]))]);
        assert_eq!(notes.len(), 1, "{said}: {notes:?}");
        assert!(
            notes[0].starts_with(&format!(
                "approval_voice_decisions.phrases.{language}: '{said}' is ignored: "
            )) && notes[0].contains(problem),
            "{said}: {notes:?}"
        );
        assert!(
            match_phrase(said, words.for_language(language)).is_none(),
            "{said}"
        );
    }
    for (language, said) in [("de", "Ich bestätige das"), ("en", "I confirm this action")] {
        let (_, notes) = built(&[], &[(language, phrase(said, &[], &[]))]);
        assert!(notes.is_empty(), "{said}: {notes:?}");
    }
}

#[test]
fn another_language_needs_its_own_yes_and_casual_words_and_the_longest_built_in_length() {
    for (language, said) in [
        ("fr", "Oui, d'accord"),
        ("es", "Sí, claro"),
        ("pl", "Tak, dobrze"),
        ("fr", "Je confirme l'action"),
    ] {
        let (words, notes) = built(&[], &[(language, phrase(said, &[], &[]))]);
        assert_eq!(
            notes,
            [format!(
                "approval_voice_decisions.phrases.{language}: '{said}' is ignored: the voice-command words of `{language}` list no `yes_particles` and `casual_approvals` to check it against"
            )]
        );
        assert!(words.for_language(language).phrase_of(language).is_none());
    }
    for (said, problem) in [
        ("Oui, d'accord", "it holds a yes"),
        ("Ouais, je valide", "it holds a yes"),
        (
            "Je confirme",
            "it is shorter than the built-in 'Ich bestätige'",
        ),
    ] {
        let (_, notes) = french(phrase(said, &[], &[]));
        assert_eq!(notes.len(), 1, "{said}: {notes:?}");
        assert!(notes[0].contains(problem), "{said}: {notes:?}");
    }
}

#[test]
fn the_startup_log_names_dropped_and_kept_phrases_and_screen_only_languages() {
    let words: VoiceCommandWordsByLanguage = [
        ("fr".to_string(), quiet_french_words()),
        ("es".to_string(), VoiceCommandWordLists::default()),
    ]
    .into_iter()
    .collect();
    let phrases: ConfirmationPhrasesByLanguage = [
        ("fr".to_string(), phrase("Je confirme l'action", &[], &[])),
        ("es".to_string(), phrase("Sí", &[], &[])),
    ]
    .into_iter()
    .collect();
    let log = logged(|| {
        CommandWordsByLanguage::from_config(&words, &phrases);
    });
    for line in [
        "Confirmation phrase dropped: approval_voice_decisions.phrases.es: 'Sí' is ignored: the voice-command words of `es` list no `yes_particles` and `casual_approvals` to check it against.",
        "Confirmation phrases on `de/en` cards: 'Ich bestätige' (de), 'I confirm' (en).",
        "Confirmation phrases on `es` cards: none, screen only.",
        "Confirmation phrases on `fr` cards: 'Ich bestätige' (de), 'I confirm' (en), 'Je confirme l'action' (fr).",
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
    let (words, _) = french(phrase("Je confirme l'action", &[], &[]));
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
        &[("fr", quiet_french_words())],
        &[
            ("fr", phrase("Je confirme l'action", &[], &[])),
            ("es", phrase("Sí", &[], &[])),
        ],
    );
    assert_eq!(
        words.shown_phrases(),
        std::collections::BTreeMap::from([
            ("de".to_string(), "Ich bestätige".to_string()),
            ("en".to_string(), "I confirm".to_string()),
            ("fr".to_string(), "Je confirme l'action".to_string()),
        ])
    );
}

#[test]
fn a_french_hesitation_sound_is_trimmed_on_a_french_card_only() {
    let (words, _) = french(phrase("Je confirme l'action", &[], &[]));
    let fr = words.for_language("fr");
    let en = words.for_language("en");
    assert!(match_phrase("Euh, je confirme l'action", fr).is_some());
    assert!(match_phrase("Euh, I confirm", fr).is_some());
    assert!(match_phrase("Euh, I confirm", en).is_none());
}

#[test]
fn a_phrase_is_never_weaker_than_the_built_in_one() {
    for (language, said, problem) in [
        ("de", "Ja, mach das", "it holds a yes"),
        ("en", "Yes, go ahead", "it holds a yes"),
        ("en", "Yeah, I confirm", "it holds a yes"),
        (
            "de",
            "Einverstanden",
            "the voice commands already hear it as a plain approval",
        ),
        (
            "en",
            "I approve",
            "the voice commands already hear it as a plain approval",
        ),
        (
            "de",
            "Ich gebe frei",
            "it is shorter than the built-in 'Ich bestätige'",
        ),
        (
            "de-at",
            "Ich gebe frei",
            "it is shorter than the built-in 'Ich bestätige'",
        ),
    ] {
        let (words, notes) = built(&[], &[(language, phrase(said, &[], &[]))]);
        assert_eq!(notes.len(), 1, "{said}: {notes:?}");
        assert!(
            notes[0].starts_with(&format!(
                "approval_voice_decisions.phrases.{language}: '{said}' is ignored: {problem}"
            )),
            "{notes:?}"
        );
        assert!(
            match_phrase(said, words.for_language(language)).is_none(),
            "{said}"
        );
    }
    for (language, said) in [("de", "Ich gebe das frei"), ("en", "I hereby confirm")] {
        let (words, notes) = built(&[], &[(language, phrase(said, &[], &[]))]);
        assert!(notes.is_empty(), "{said}: {notes:?}");
        assert!(
            match_phrase(said, words.for_language(language)).is_some(),
            "{said}"
        );
    }
}

#[test]
fn only_quiet_words_may_stand_before_or_after_a_phrase() {
    let (words, notes) = built(
        &[],
        &[(
            "de",
            phrase(
                "Ich bestätige",
                &["vielleicht", "ja"],
                &["vielleicht", "später", "dann", "bitte"],
            ),
        )],
    );
    for (kind, entry) in [
        ("leading", "vielleicht"),
        ("trailing", "vielleicht"),
        ("trailing", "später"),
        ("trailing", "dann"),
    ] {
        let note = format!(
            "approval_voice_decisions.phrases.de.{kind}: '{entry}' is ignored: only a noise, hesitation, filler, yes or agreement word may stand there"
        );
        assert!(notes.contains(&note), "{note}: {notes:?}");
    }
    let de = words.for_language("de");
    let phrase = de.phrase_of("de").unwrap();
    assert_eq!(phrase.leading, ["ja"]);
    assert_eq!(phrase.trailing, ["bitte"]);
    for said in [
        "Ich bestätige vielleicht",
        "Vielleicht ich bestätige",
        "Ich bestätige später",
        "Ich bestätige dann",
    ] {
        assert!(match_phrase(said, de).is_none(), "{said}");
    }
    assert!(match_phrase("Ja, ich bestätige bitte", de).is_some());
}

#[test]
fn the_startup_log_names_the_phrases_in_use_without_a_package() {
    assert_eq!(
        CommandWordsByLanguage::default().shown_phrases_by_card_language(),
        [(
            "de/en".to_string(),
            "'Ich bestätige' (de), 'I confirm' (en)".to_string()
        )]
    );
}
