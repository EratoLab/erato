//! The startup check behind the per-entry checks in `words.rs` and
//! `phrase.rs`: every phrasing of the sentence sets and the attack set is
//! heard again with the configured words, on cards before and after they
//! asked. A combination of entries that no single check catches shows here,
//! as a refusal or stop the built-in words hear and the configured ones do
//! not, or as a decision the built-in words never reach.

use super::corpus::{CORPUS, Card};
use super::model::Answer;
use super::phrase::match_phrase;
use super::words::{CommandWords, CommandWordsByLanguage, SHARED_LANGUAGES};
use super::{VoiceCommandInput, VoiceMeaning, classify_by_rules, from_answer};
use erato_config::confirmation_phrases::ConfirmationPhrasesByLanguage;
use erato_config::language_words::WordLists;
use erato_config::voice_command_words::{VoiceCommandWordLists, VoiceCommandWordsByLanguage};

/// What one set of words makes of a phrasing on one card.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Heard {
    rules: Option<VoiceMeaning>,
    /// What a model answering approve, then reject, becomes once guarded.
    model: [VoiceMeaning; 2],
}

fn hear(input: &VoiceCommandInput<'_>, words: &CommandWords) -> Heard {
    let model = |meaning| {
        let answer = Answer {
            meaning,
            piece_id: None,
        };
        from_answer(input, words, &answer).command.meaning
    };
    Heard {
        rules: classify_by_rules(input, words).map(|classified| classified.command.meaning),
        model: [model(VoiceMeaning::Approve), model(VoiceMeaning::Reject)],
    }
}

/// Whether the configured words lose a refusal or stop the built-in words
/// hear, or reach a decision they do not.
fn weakens(base: Heard, configured: Heard) -> bool {
    let decision = |meaning: Option<VoiceMeaning>| meaning.filter(|meaning| meaning.is_decision());
    let refuses_or_stops = matches!(base.rules, Some(VoiceMeaning::Reject | VoiceMeaning::Stop));
    (refuses_or_stops && configured.rules != base.rules)
        || (decision(configured.rules).is_some()
            && decision(configured.rules) != decision(base.rules))
        || base
            .model
            .iter()
            .zip(configured.model)
            .any(|(base, configured)| {
                (*base == VoiceMeaning::Reject && configured != VoiceMeaning::Reject)
                    || (configured.is_decision() && configured != *base)
            })
}

/// The words a check runs with: German and English with what is configured
/// for them, heard in each phrasing's own language, or a configured
/// language's own words, heard in that language.
enum Target {
    Shared,
    Own(String),
}

impl Target {
    fn words<'a>(&self, built: &'a CommandWordsByLanguage) -> &'a CommandWords {
        match self {
            Self::Shared => built.for_language("de"),
            Self::Own(language) => built.for_language(language),
        }
    }

    fn language<'a>(&'a self, phrasing: &'a str) -> &'a str {
        match self {
            Self::Shared => phrasing,
            Self::Own(language) => language,
        }
    }

    /// The configured languages whose entries these words hold, own first.
    fn languages(&self) -> Vec<&str> {
        let mut languages: Vec<&str> = match self {
            Self::Shared => Vec::new(),
            Self::Own(language) => vec![language],
        };
        languages.extend(SHARED_LANGUAGES);
        languages
    }

    fn shown(&self) -> String {
        match self {
            Self::Shared => "German and English cards".to_string(),
            Self::Own(language) => format!("`{language}` cards"),
        }
    }
}

fn input<'a>(said: &'a str, language: &'a str, card: &'a Card) -> VoiceCommandInput<'a> {
    VoiceCommandInput {
        transcript: said,
        language,
        pieces: &card.pieces,
        current_piece_id: Some(&card.current_piece_id),
        question: None,
    }
}

/// Every phrasing on every card, as corpus indexes.
fn all_pairs() -> Vec<(usize, usize)> {
    let cards = CORPUS.cards.len();
    (0..CORPUS.phrasings.len())
        .flat_map(|phrasing| (0..cards).map(move |card| (phrasing, card)))
        .collect()
}

/// `pairs` for which `keep` holds, checked on a few threads: the check runs
/// at startup, before the server listens.
fn par_filter(
    pairs: &[(usize, usize)],
    keep: impl Fn((usize, usize)) -> bool + Sync,
) -> Vec<(usize, usize)> {
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get().min(8));
    let chunk = pairs.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        let parts: Vec<_> = pairs
            .chunks(chunk)
            .map(|part| {
                let keep = &keep;
                scope.spawn(move || {
                    part.iter()
                        .copied()
                        .filter(|pair| keep(*pair))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        parts
            .into_iter()
            .flat_map(|part| part.join().expect("a recheck thread panicked"))
            .collect()
    })
}

/// What the built-in words hear for each pair of [`all_pairs`], in the
/// target's languages; computed once per target.
fn base_heard(target: &Target) -> Vec<Heard> {
    let pairs = all_pairs();
    let heard = |(phrasing, card): (usize, usize)| {
        let (language, said) = &CORPUS.phrasings[phrasing];
        let input = input(said, target.language(language), &CORPUS.cards[card]);
        hear(&input, CommandWords::base())
    };
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get().min(8));
    let chunk = pairs.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        let parts: Vec<_> = pairs
            .chunks(chunk)
            .map(|part| {
                let heard = &heard;
                scope.spawn(move || part.iter().map(|pair| heard(*pair)).collect::<Vec<_>>())
            })
            .collect();
        parts
            .into_iter()
            .flat_map(|part| part.join().expect("a recheck thread panicked"))
            .collect()
    })
}

/// The pairs, among `pairs`, on which `words` weaken what the built-in
/// words hear.
fn weakened(
    target: &Target,
    words: &CommandWords,
    base: &[Heard],
    pairs: &[(usize, usize)],
) -> Vec<(usize, usize)> {
    let cards = CORPUS.cards.len();
    par_filter(pairs, |(phrasing, card)| {
        let (language, said) = &CORPUS.phrasings[phrasing];
        let input = input(said, target.language(language), &CORPUS.cards[card]);
        weakens(base[phrasing * cards + card], hear(&input, words))
    })
}

/// A configured phrase that accepts a phrasing no built-in phrase accepts:
/// its language, and the phrasing.
fn loose_phrase(
    words: &CommandWords,
    phrases: &ConfirmationPhrasesByLanguage,
) -> Option<(String, String)> {
    let base = CommandWords::base();
    CORPUS.phrasings.iter().find_map(|(_, said)| {
        let matched = match_phrase(said, words)?;
        let language = &matched.phrase.language;
        (phrases.contains_key(language) && match_phrase(said, base).is_none())
            .then(|| (language.clone(), said.clone()))
    })
}

fn has_entries(lists: &VoiceCommandWordLists) -> bool {
    VoiceCommandWordLists::NAMES
        .iter()
        .any(|name| lists.list(name).is_some_and(|list| !list.is_empty()))
}

/// Reruns the sentence sets and the attack set against every language the
/// configured words and phrases build, and drops each configured phrase or
/// word list entry that weakens what the built-in words hear. Returns one
/// line per dropped entry. Without configured words or phrases it does
/// nothing.
pub fn recheck_configured(
    config: &mut VoiceCommandWordsByLanguage,
    phrases: &mut ConfirmationPhrasesByLanguage,
) -> Vec<String> {
    let mut dropped = Vec::new();
    let shared_configured = SHARED_LANGUAGES.iter().any(|language| {
        config.get(*language).is_some_and(has_entries) || phrases.contains_key(*language)
    });
    let mut targets: Vec<Target> = Vec::new();
    if shared_configured {
        targets.push(Target::Shared);
    }
    let mut own: Vec<String> = config
        .keys()
        .chain(phrases.keys())
        .filter(|language| !SHARED_LANGUAGES.contains(&language.as_str()))
        .cloned()
        .collect();
    own.sort();
    own.dedup();
    targets.extend(own.into_iter().map(Target::Own));

    for target in targets {
        // Phrases first: each is checked against the words when built, so
        // dropping words could change which phrases are in use.
        loop {
            let built = CommandWordsByLanguage::build(config, phrases).0;
            let Some((language, said)) = loose_phrase(target.words(&built), phrases) else {
                break;
            };
            phrases.remove(&language);
            dropped.push(format!(
                "approval_voice_decisions.phrases.{language} dropped: it accepts {said:?}, which no built-in phrase approves"
            ));
        }

        let built = CommandWordsByLanguage::build(config, phrases).0;
        let base = base_heard(&target);
        let mut failing = weakened(&target, target.words(&built), &base, &all_pairs());
        if failing.is_empty() {
            continue;
        }
        let candidates: Vec<(String, &'static str, String)> = target
            .languages()
            .into_iter()
            .filter_map(|language| Some((language, config.get(language)?)))
            .flat_map(|(language, lists)| {
                VoiceCommandWordLists::NAMES.iter().flat_map(move |name| {
                    lists
                        .list(name)
                        .into_iter()
                        .flatten()
                        .map(move |entry| (language.to_string(), *name, entry.clone()))
                })
            })
            .collect();
        // One entry at a time: an entry whose removal clears some of the
        // weakened phrasings goes, whether it does so alone or with others.
        for (language, name, entry) in candidates {
            let mut trial = config.clone();
            let Some(list) = trial
                .get_mut(&language)
                .and_then(|lists| lists.list_mut(name))
            else {
                continue;
            };
            let Some(at) = list.iter().position(|kept| *kept == entry) else {
                continue;
            };
            list.remove(at);
            let built = CommandWordsByLanguage::build(&trial, phrases).0;
            let still = weakened(&target, target.words(&built), &base, &failing);
            if still.len() < failing.len() {
                let cleared = failing
                    .iter()
                    .find(|pair| !still.contains(pair))
                    .map_or(0, |pair| pair.0);
                let (said_language, said) = &CORPUS.phrasings[cleared];
                *config = trial;
                dropped.push(format!(
                    "approval_voice_commands.words.{language}.{name} entry {entry:?} dropped: with it, {} hear {said:?} ({said_language}) as a decision or lose its refusal or stop",
                    target.shown()
                ));
                failing = still;
                if failing.is_empty() {
                    break;
                }
            }
        }
        if !failing.is_empty() {
            for language in target.languages() {
                if config.remove(language).is_some() {
                    dropped.push(format!(
                        "approval_voice_commands.words.{language} dropped: together its entries weaken what {} hear, and no single entry explains it",
                        target.shown()
                    ));
                }
            }
        }
    }
    dropped
}

#[cfg(test)]
mod tests {
    use super::*;
    use erato_config::confirmation_phrases::ConfirmationPhraseConfig;

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
            casual_approvals: strings(&["ça marche"]),
            hesitations: strings(&["euh", "bah"]),
            ..Default::default()
        }
    }

    #[test]
    fn nothing_configured_drops_nothing() {
        let mut words = VoiceCommandWordsByLanguage::new();
        let mut phrases = ConfirmationPhrasesByLanguage::new();
        assert!(recheck_configured(&mut words, &mut phrases).is_empty());
    }

    #[test]
    fn a_sound_package_keeps_every_entry() {
        let mut words = VoiceCommandWordsByLanguage::from([
            ("fr".to_string(), french()),
            (
                "de".to_string(),
                VoiceCommandWordLists {
                    approve: strings(&["geht klar"]),
                    reject: strings(&["lieber nicht"]),
                    ..Default::default()
                },
            ),
        ]);
        let mut phrases = ConfirmationPhrasesByLanguage::from([(
            "fr".to_string(),
            ConfirmationPhraseConfig {
                phrase: "Je confirme".into(),
                leading: strings(&["oui"]),
                trailing: Vec::new(),
            },
        )]);
        let before = (words.clone(), phrases.clone());
        let started = std::time::Instant::now();
        let dropped = recheck_configured(&mut words, &mut phrases);
        println!("recheck of de, en and fr: {:?}", started.elapsed());
        assert!(dropped.is_empty(), "{dropped:#?}");
        assert_eq!((words, phrases), before);
    }

    #[test]
    fn an_entry_that_lets_an_attack_decide_is_dropped_and_the_rest_kept() {
        let mut words = VoiceCommandWordsByLanguage::from([(
            "de".to_string(),
            VoiceCommandWordLists {
                approve: strings(&["geht klar", "mach weiter"]),
                ..Default::default()
            },
        )]);
        let mut phrases = ConfirmationPhrasesByLanguage::new();
        let dropped = recheck_configured(&mut words, &mut phrases);
        assert_eq!(dropped.len(), 1, "{dropped:#?}");
        assert!(
            dropped[0]
                .starts_with("approval_voice_commands.words.de.approve entry \"mach weiter\""),
            "{dropped:#?}"
        );
        assert_eq!(words["de"].approve, ["geht klar"]);
    }

    #[test]
    fn a_phrase_that_accepts_a_doubt_is_dropped() {
        let mut words = VoiceCommandWordsByLanguage::new();
        let mut phrases = ConfirmationPhrasesByLanguage::from([(
            "de".to_string(),
            ConfirmationPhraseConfig {
                phrase: "Ich überlege noch".into(),
                leading: Vec::new(),
                trailing: Vec::new(),
            },
        )]);
        let dropped = recheck_configured(&mut words, &mut phrases);
        assert!(phrases.is_empty(), "{dropped:#?}");
        assert!(dropped[0].starts_with("approval_voice_decisions.phrases.de dropped"));
    }
}
