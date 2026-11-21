//! Words a language package adds: they work on a card in that language and
//! can never weaken the guards.

use super::model::Answer;
use super::phrase::match_phrase;
use super::tests::{SentenceSet, heldout_set, sentence_set};
use super::*;
use erato_config::voice_command_words::{VoiceCommandWordLists, VoiceCommandWordsByLanguage};

fn strings(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| word.to_string()).collect()
}

fn french() -> VoiceCommandWordLists {
    VoiceCommandWordLists {
        approve: strings(&["oui", "d'accord", "vas-y"]),
        reject: strings(&["non", "non merci", "annule"]),
        negations: strings(&["non", "ne", "pas", "jamais"]),
        conditions: strings(&["mais", "si", "sauf"]),
        yes_particles: strings(&["oui"]),
        hesitations: strings(&["euh", "bah"]),
        ..Default::default()
    }
}

fn configured(languages: &[(&str, VoiceCommandWordLists)]) -> CommandWordsByLanguage {
    let config: VoiceCommandWordsByLanguage = languages
        .iter()
        .map(|(language, lists)| (language.to_string(), lists.clone()))
        .collect();
    CommandWordsByLanguage::build(&config, &Default::default()).0
}

/// The card has asked; its pieces are those of the German test card.
fn on_card<'a>(
    set: &'a SentenceSet,
    transcript: &'a str,
    language: &'a str,
) -> VoiceCommandInput<'a> {
    let card = &set.cards["de-asked"];
    VoiceCommandInput {
        transcript,
        language,
        pieces: &card.pieces,
        current_piece_id: Some(&card.current_piece_id),
        question: None,
    }
}

fn by_rules(input: &VoiceCommandInput<'_>, words: &CommandWords) -> Option<VoiceMeaning> {
    classify_by_rules(input, words).map(|classified| classified.command.meaning)
}

/// What a model answering `meaning` becomes once the guard has seen it.
fn by_model(
    input: &VoiceCommandInput<'_>,
    words: &CommandWords,
    meaning: VoiceMeaning,
) -> VoiceMeaning {
    let answer = Answer {
        meaning,
        piece_id: None,
    };
    from_answer(input, words, &answer).command.meaning
}

#[test]
fn a_french_package_lets_a_french_card_approve_and_refuse() {
    let set = sentence_set();
    let words = configured(&[("fr", french())]);
    let fr = words.for_language("fr");
    for (said, meaning) in [
        ("Oui.", VoiceMeaning::Approve),
        ("euh, d'accord", VoiceMeaning::Approve),
        ("Non.", VoiceMeaning::Reject),
        ("non merci", VoiceMeaning::Reject),
    ] {
        let input = on_card(&set, said, "fr");
        assert_eq!(by_rules(&input, fr), Some(meaning), "{said}");
        assert_eq!(by_model(&input, fr, meaning), meaning, "{said}");
    }
    for said in [
        "oui, mais pas maintenant",
        "non, oui",
        "oui ?",
        "ne pas faire",
    ] {
        let input = on_card(&set, said, "fr");
        assert!(
            !matches!(
                by_rules(&input, fr),
                Some(VoiceMeaning::Approve | VoiceMeaning::Reject)
            ),
            "{said}"
        );
        assert_eq!(
            by_model(&input, fr, VoiceMeaning::Approve),
            VoiceMeaning::Unclear,
            "{said}"
        );
    }
    assert_eq!(
        by_rules(&on_card(&set, "nein", "fr"), fr),
        Some(VoiceMeaning::Reject)
    );
}

#[test]
fn a_language_without_words_decides_on_screen_only() {
    let set = sentence_set();
    let words = configured(&[("fr", french())]);
    for (said, language) in [("oui", "de"), ("non", "en"), ("oui", "es"), ("sí", "es")] {
        let lists = words.for_language(language);
        let input = on_card(&set, said, language);
        assert!(
            !matches!(
                by_rules(&input, lists),
                Some(VoiceMeaning::Approve | VoiceMeaning::Reject)
            ),
            "{said} ({language})"
        );
        for meaning in [VoiceMeaning::Approve, VoiceMeaning::Reject] {
            assert_eq!(
                by_model(&input, lists, meaning),
                VoiceMeaning::Unclear,
                "{said} ({language})"
            );
        }
    }
}

#[test]
fn no_built_in_word_can_be_taken_out() {
    let set = sentence_set();
    let words = loaded(serde_json::json!({"de": {
        "remove": {
            "hesitations": ["aeh", "aehm"],
            "fillers": ["doch", "einfach", "mal"],
            "reject": ["nein"],
            "noise_words": ["okay"],
        },
    }}));
    let de = words.for_language("de");
    assert!(de.hesitations.contains("aeh") && de.fillers.contains("doch"));
    assert!(de.reject.contains("nein") && de.noise_words.contains("okay"));
    for said in [
        "Nein, äh, lass es",
        "Nein, ähm, abbrechen",
        "Lass es doch",
        "Lass es einfach",
    ] {
        assert_eq!(
            by_rules(&on_card(&set, said, "de"), de),
            Some(VoiceMeaning::Reject),
            "{said}"
        );
    }
    assert_eq!(
        by_rules(&on_card(&set, "Warte mal", "de"), de),
        Some(VoiceMeaning::Stop)
    );
}

#[test]
fn an_added_word_never_hides_a_refusal_or_a_stop() {
    let set = sentence_set();
    let (words, notes) = CommandWordsByLanguage::build(
        &[(
            "de".to_string(),
            VoiceCommandWordLists {
                approve: strings(&["abbrechen", "nein danke", "von mir aus"]),
                yes_particles: strings(&["abbrechen", "das", "it"]),
                question_first: strings(&["das", "cancel"]),
                question_verbs: strings(&["lass"]),
                continuations: strings(&["it", "es"]),
                leading_no: strings(&["halt"]),
                conditions: strings(&["stopp"]),
                wh_words: strings(&["cancel"]),
                skip: strings(&["abbrechen", "ruhe"]),
                repeat: strings(&["stopp"]),
                casual_approvals: strings(&["vergiss es"]),
                reject: strings(&["warte mal", "das will ich nicht"]),
                stop: strings(&["lass", "sei mal leise"]),
                ..Default::default()
            },
        )]
        .into_iter()
        .collect(),
        &Default::default(),
    );
    let refused = |list: &str, entry: &str| {
        notes.iter().any(|note| {
            note.starts_with(&format!(
                "approval_voice_commands.words.de.{list}: '{entry}' is ignored"
            ))
        })
    };
    for (list, entry) in [
        ("approve", "abbrechen"),
        ("approve", "nein danke"),
        ("yes_particles", "abbrechen"),
        ("yes_particles", "das"),
        ("yes_particles", "it"),
        ("question_first", "das"),
        ("question_first", "cancel"),
        ("question_verbs", "lass"),
        ("continuations", "it"),
        ("continuations", "es"),
        ("leading_no", "halt"),
        ("conditions", "stopp"),
        ("wh_words", "cancel"),
        ("skip", "abbrechen"),
        ("skip", "ruhe"),
        ("repeat", "stopp"),
        ("casual_approvals", "vergiss es"),
        ("reject", "warte mal"),
        ("stop", "lass"),
    ] {
        assert!(refused(list, entry), "{list} {entry}: {notes:?}");
    }
    let de = words.for_language("de");
    assert!(de.approve.contains("von mir aus"));
    assert!(de.reject.contains("das will ich nicht"));
    assert!(de.stop.contains("sei mal leise") || de.stop.contains("sei leise"));
    for (said, meaning) in [
        ("abbrechen", VoiceMeaning::Reject),
        ("nein danke", VoiceMeaning::Reject),
        ("vergiss es", VoiceMeaning::Reject),
        ("Mach das nicht", VoiceMeaning::Reject),
        ("Lass das", VoiceMeaning::Reject),
        ("Cancel it", VoiceMeaning::Reject),
        ("Forget it", VoiceMeaning::Reject),
        ("Don't do it", VoiceMeaning::Reject),
        ("stopp", VoiceMeaning::Stop),
        ("halt", VoiceMeaning::Stop),
        ("ruhe", VoiceMeaning::Stop),
        ("warte mal", VoiceMeaning::Stop),
    ] {
        assert_eq!(
            by_rules(&on_card(&set, said, "de"), de),
            Some(meaning),
            "{said}"
        );
    }
}

#[test]
fn no_built_in_refusal_or_stop_is_also_an_approval_or_noise() {
    let base = CommandWords::base();
    for phrase in base.reject.iter().chain(&base.stop) {
        assert!(!base.approve.contains(phrase), "{phrase}");
        assert!(!base.noise_phrases.contains(phrase), "{phrase}");
        assert!(
            !phrase
                .split(' ')
                .all(|word| base.noise_words.contains(word)),
            "{phrase}"
        );
    }
    assert!(base.reject.is_disjoint(&base.stop));
}

/// A package that adds guard words where they would vanish or agree.
fn hostile() -> VoiceCommandWordLists {
    let guards = strings(&[
        "nicht", "not", "aber", "but", "wenn", "if", "warum", "und", "passt",
    ]);
    VoiceCommandWordLists {
        hesitations: guards.clone(),
        fillers: guards,
        approve: strings(&["nicht machen", "ja aber", "ja wenn", "warum nicht"]),
        yes_particles: strings(&["nicht"]),
        ..Default::default()
    }
}

#[test]
fn added_words_never_make_a_negation_condition_or_question_agree() {
    let set = sentence_set();
    let words = configured(&[("fr", hostile())]);
    let fr = words.for_language("fr");
    for guard in ["nicht", "not", "aber", "but", "wenn", "if", "warum", "und"] {
        assert!(!fr.fillers.contains(guard), "{guard}");
    }
    for said in [
        "nicht machen",
        "ja aber",
        "ja, wenn du willst",
        "warum nicht",
        "nicht, ja",
        "ja, und",
        "passt das",
        "mach das nicht",
        "ja nicht",
    ] {
        let input = on_card(&set, said, "fr");
        assert_ne!(by_rules(&input, fr), Some(VoiceMeaning::Approve), "{said}");
        assert_ne!(
            by_model(&input, fr, VoiceMeaning::Approve),
            VoiceMeaning::Approve,
            "{said}"
        );
    }
}

#[test]
fn the_phrase_check_never_trims_a_guard_word() {
    let words = configured(&[("fr", french()), ("de", hostile())]);
    let fr = words.for_language("fr");
    assert!(match_phrase("Euh, ich bestätige.", fr).is_some());
    assert!(match_phrase("Euh, ich bestätige.", CommandWords::base()).is_none());
    for said in [
        "nicht ich bestätige",
        "ich bestätige nicht",
        "aber ich bestätige",
        "warum ich bestätige",
        "ich bestätige wenn",
        "never I confirm",
        "pas ich bestätige",
        "ich bestätige mais",
        "ich bestätige das jetzt",
    ] {
        assert!(match_phrase(said, fr).is_none(), "{said}");
        assert!(
            match_phrase(said, words.for_language("de")).is_none(),
            "{said}"
        );
    }
}

#[test]
fn a_script_without_spaces_never_decides() {
    let set = sentence_set();
    let japanese = VoiceCommandWordLists {
        approve: strings(&["はい", "お願いします"]),
        reject: strings(&["いいえ"]),
        yes_particles: strings(&["はい"]),
        ..Default::default()
    };
    let words = configured(&[("ja", japanese), ("th", VoiceCommandWordLists::default())]);
    for (said, language) in [
        ("はい", "ja"),
        ("はい、お願いします。", "ja"),
        ("いいえ", "ja"),
        ("いいえ！", "ja"),
        ("ja はい", "ja"),
        ("ใช่", "th"),
        ("好的", "zh"),
    ] {
        let lists = words.for_language(language);
        let input = on_card(&set, said, language);
        assert_eq!(by_rules(&input, lists), None, "{said}");
        for meaning in [VoiceMeaning::Approve, VoiceMeaning::Reject] {
            assert_eq!(
                by_model(&input, lists, meaning),
                VoiceMeaning::Unclear,
                "{said}"
            );
        }
    }
}

fn attacks() -> Vec<(&'static str, &'static str)> {
    include_str!("attacks.txt")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.split_once('|').expect("language|words"))
        .collect()
}

fn decision(meaning: Option<VoiceMeaning>) -> Option<VoiceMeaning> {
    meaning.filter(|meaning| meaning.is_decision())
}

/// Every phrasing on every card, in its own language and in French: what
/// decides with the package decided the same without it.
#[test]
fn configured_words_turn_no_attack_or_sentence_into_a_new_decision() {
    let set = sentence_set();
    let heldout = heldout_set();
    let words = configured(&[("fr", french())]);
    let mut phrasings: Vec<(&str, &str)> = attacks();
    assert!(phrasings.len() >= 349);
    for sentence in set.sentences.iter().chain(&heldout.sentences) {
        phrasings.push((&sentence.language, &sentence.text));
    }
    let base = CommandWords::base();
    for (own_language, said) in phrasings {
        for card in ["de", "de-asked", "en", "en-asked"] {
            let card = &set.cards[card];
            for language in [own_language, "fr"] {
                let lists = words.for_language(language);
                let input = VoiceCommandInput {
                    transcript: said,
                    language,
                    pieces: &card.pieces,
                    current_piece_id: Some(&card.current_piece_id),
                    question: None,
                };
                if let Some(meaning) = decision(by_rules(&input, lists)) {
                    assert_eq!(decision(by_rules(&input, base)), Some(meaning), "{said}");
                }
                for answered in [VoiceMeaning::Approve, VoiceMeaning::Reject] {
                    if let Some(meaning) = decision(Some(by_model(&input, lists, answered))) {
                        assert_eq!(
                            decision(Some(by_model(&input, base, answered))),
                            Some(meaning),
                            "{said}"
                        );
                    }
                }
            }
        }
    }
}

/// With a package that adds every attack to the decisions and every word to
/// the fillers and agreements, a negation still never approves, and a
/// condition or question never decides.
#[test]
fn a_hostile_package_cannot_make_an_attack_with_a_guard_word_decide() {
    let set = sentence_set();
    let phrasings = attacks();
    let all_words: Vec<String> = phrasings
        .iter()
        .flat_map(|(_, said)| rules::words_of(said))
        .collect();
    let all_phrasings: Vec<String> = phrasings.iter().map(|(_, said)| said.to_string()).collect();
    let words = configured(&[(
        "fr",
        VoiceCommandWordLists {
            approve: all_phrasings.clone(),
            reject: all_phrasings,
            fillers: all_words.clone(),
            hesitations: all_words.clone(),
            yes_particles: all_words.clone(),
            continuations: all_words.clone(),
            leading_no: all_words,
            ..Default::default()
        },
    )]);
    let fr = words.for_language("fr");
    let base = CommandWords::base();
    for (_, said) in phrasings {
        let folded = rules::words_of(said);
        let negated = folded.iter().any(|word| base.negations.contains(word));
        let conditional = folded.iter().any(|word| base.conditions.contains(word));
        let asked = said.contains('?');
        for card in ["de-asked", "en-asked"] {
            let card = &set.cards[card];
            let input = VoiceCommandInput {
                transcript: said,
                language: "fr",
                pieces: &card.pieces,
                current_piece_id: Some(&card.current_piece_id),
                question: None,
            };
            let rules = decision(by_rules(&input, fr));
            let approved = by_model(&input, fr, VoiceMeaning::Approve);
            let rejected = by_model(&input, fr, VoiceMeaning::Reject);
            if negated {
                assert_ne!(rules, Some(VoiceMeaning::Approve), "{said}");
                assert_ne!(approved, VoiceMeaning::Approve, "{said}");
            }
            if conditional || asked {
                assert_eq!(rules, None, "{said}");
                assert_ne!(approved, VoiceMeaning::Approve, "{said}");
                assert_ne!(rejected, VoiceMeaning::Reject, "{said}");
            }
        }
    }
}

/// The lists as a deployment's configuration writes them, wrong parts
/// dropped as at startup.
fn loaded(words: serde_json::Value) -> CommandWordsByLanguage {
    CommandWordsByLanguage::build(
        &erato_config::voice_command_words::deserialize_voice_command_words(words).unwrap(),
        &Default::default(),
    )
    .0
}

fn never_approves(said: &str, language: &str, lists: &CommandWords) {
    let set = sentence_set();
    let input = on_card(&set, said, language);
    assert_ne!(
        by_rules(&input, lists),
        Some(VoiceMeaning::Approve),
        "{said}"
    );
    assert_ne!(
        by_model(&input, lists, VoiceMeaning::Approve),
        VoiceMeaning::Approve,
        "{said}"
    );
}

fn never_refuses(said: &str, language: &str, lists: &CommandWords) {
    let set = sentence_set();
    let input = on_card(&set, said, language);
    assert_ne!(
        by_rules(&input, lists),
        Some(VoiceMeaning::Reject),
        "{said}"
    );
    assert_ne!(
        by_model(&input, lists, VoiceMeaning::Reject),
        VoiceMeaning::Reject,
        "{said}"
    );
}

#[test]
fn a_filler_never_takes_a_subject_or_a_refusal_word() {
    let words = configured(&[(
        "de",
        VoiceCommandWordLists {
            fillers: strings(&["das", "abbrechen", "stopp", "lieber", "mal"]),
            hesitations: strings(&["du", "nein"]),
            ..Default::default()
        },
    )]);
    let de = words.for_language("de");
    for word in ["das", "abbrechen", "stopp", "du", "nein"] {
        assert!(!de.fillers.contains(word), "{word}");
    }
    for said in ["passt das", "ja, abbrechen", "kannst du das machen"] {
        never_approves(said, "de", de);
    }
}

#[test]
fn an_added_agreement_never_holds_a_question_word() {
    let words = configured(&[(
        "de",
        VoiceCommandWordLists {
            approve: strings(&["ja warum", "ja wieso"]),
            yes_particles: strings(&["wie", "was"]),
            ..Default::default()
        },
    )]);
    let de = words.for_language("de");
    assert!(!de.yes_particles.contains("wie") && !de.approve.contains("ja wieso"));
    for said in ["ja warum", "ja wieso", "warum ja", "ja was", "wie ja"] {
        never_approves(said, "de", de);
    }
}

#[test]
fn helper_words_never_decide_alone() {
    let set = sentence_set();
    let german = configured(&[(
        "de",
        VoiceCommandWordLists {
            reject: strings(&[
                "das will ich nicht",
                "nicht ausführen",
                "I don't want that",
                "don't run it",
            ]),
            ..Default::default()
        },
    )]);
    let de = german.for_language("de");
    for said in ["das will ich nicht", "nicht ausführen", "don't run it"] {
        let input = on_card(&set, said, "de");
        assert_eq!(by_rules(&input, de), Some(VoiceMeaning::Reject), "{said}");
    }
    for said in ["will", "ausführen", "want", "run", "Ausführen."] {
        never_refuses(said, "de", de);
    }
}

#[test]
fn a_hesitation_or_filler_is_never_a_negation_time_or_correction() {
    let words = configured(&[
        (
            "de",
            VoiceCommandWordLists {
                hesitations: strings(&["niemals", "nichts", "spaeter", "Montag", "falsch", "öhm"]),
                fillers: strings(&["nix", "keinesfalls", "später", "morgen"]),
                ..Default::default()
            },
        ),
        (
            "en",
            VoiceCommandWordLists {
                hesitations: strings(&["nothing", "later", "neither", "umm"]),
                ..Default::default()
            },
        ),
    ]);
    let de = words.for_language("de");
    for word in [
        "niemals",
        "nichts",
        "spaeter",
        "montag",
        "falsch",
        "nix",
        "keinesfalls",
        "nothing",
        "later",
        "neither",
    ] {
        assert!(!de.fillers.contains(word), "{word}");
    }
    assert!(de.hesitations.contains("oehm") && de.hesitations.contains("umm"));
    for said in [
        "Ich bestätige niemals",
        "Ich bestätige nichts",
        "Ich bestätige später",
        "Ich bestätige nix",
        "I confirm nothing",
        "I confirm later",
        "Neither, I confirm",
    ] {
        assert!(match_phrase(said, de).is_none(), "{said}");
    }
    assert!(match_phrase("Öhm, ich bestätige", de).is_some());
}

#[test]
fn a_refusal_is_never_lost_to_navigation_beside_it() {
    let set = sentence_set();
    let words = configured(&[(
        "de",
        VoiceCommandWordLists {
            skip: strings(&["spaeter"]),
            ..Default::default()
        },
    )]);
    let de = words.for_language("de");
    for said in ["Nein, sorry", "No, sorry", "Nein sorry", "Nein, später"] {
        let meaning = by_rules(&on_card(&set, said, "de"), de);
        assert!(
            matches!(meaning, None | Some(VoiceMeaning::Reject)),
            "{said}: {meaning:?}"
        );
    }
    assert_eq!(
        by_rules(&on_card(&set, "Nein, stopp", "de"), de),
        Some(VoiceMeaning::Stop)
    );
}

#[test]
fn a_language_table_serves_its_regions_and_a_region_table_its_tag() {
    let set = sentence_set();
    let words = configured(&[
        ("fr", french()),
        (
            "pt-br",
            VoiceCommandWordLists {
                approve: strings(&["sim"]),
                ..Default::default()
            },
        ),
    ]);
    for language in ["fr", "fr-FR", "fr-CA", "fr_BE", "FR"] {
        let input = on_card(&set, "oui", language);
        let lists = words.for_language(language);
        assert_eq!(
            by_rules(&input, lists),
            Some(VoiceMeaning::Approve),
            "{language}"
        );
    }
    let input = on_card(&set, "sim", "pt-BR");
    assert_eq!(
        by_rules(&input, words.for_language("pt-BR")),
        Some(VoiceMeaning::Approve)
    );
    for language in ["pt", "pt-PT"] {
        let input = on_card(&set, "sim", language);
        assert_eq!(by_rules(&input, words.for_language(language)), None);
    }
}
