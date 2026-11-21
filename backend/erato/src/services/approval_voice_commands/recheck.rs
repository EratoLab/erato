//! The startup check behind the per-entry checks in `words.rs` and
//! `phrase.rs`: every phrasing of the sentence sets and the attack set is
//! heard again with the configured words, on cards before and after they
//! asked. A combination of entries that no single check catches shows here,
//! as a refusal or stop the built-in words hear and the configured ones do
//! not, or as an approval the built-in words never reach and the phrasing's
//! label does not mean.

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
/// hear, or reach an approval they do not and the phrasing does not mean
/// (`meant` is empty for an unlabelled attack). A new refusal only makes
/// approving stricter, so it never counts.
fn weakens(meant: &[VoiceMeaning], base: Heard, configured: Heard) -> bool {
    let loses = |base: Option<VoiceMeaning>, configured: Option<VoiceMeaning>| {
        matches!(base, Some(VoiceMeaning::Reject | VoiceMeaning::Stop))
            && configured != base
            && configured != Some(VoiceMeaning::Reject)
    };
    let approves = |base: Option<VoiceMeaning>, configured: Option<VoiceMeaning>| {
        configured == Some(VoiceMeaning::Approve)
            && base != configured
            && !meant.contains(&VoiceMeaning::Approve)
    };
    let differs = |base, configured| loses(base, configured) || approves(base, configured);
    differs(base.rules, configured.rules)
        || base
            .model
            .iter()
            .zip(configured.model)
            .any(|(base, configured)| differs(Some(*base), Some(configured)))
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

    /// The configured languages whose entries these words hold. German and
    /// English come first: their entries already passed on their own cards,
    /// so a combination with a language's own entries keeps them.
    fn languages(&self) -> Vec<&str> {
        let mut languages: Vec<&str> = SHARED_LANGUAGES.to_vec();
        if let Self::Own(language) = self {
            languages.push(language);
        }
        languages
    }

    /// The languages to drop whole when no entry explains a weakening: a
    /// language's own, or German or English as the failing phrasings are.
    fn languages_to_drop(&self, failing: &[(usize, usize)]) -> Vec<&str> {
        match self {
            Self::Own(language) => vec![language],
            Self::Shared => {
                let said: Vec<&str> = SHARED_LANGUAGES
                    .iter()
                    .copied()
                    .filter(|language| {
                        failing
                            .iter()
                            .any(|(phrasing, _)| CORPUS.phrasings[*phrasing].language == *language)
                    })
                    .collect();
                if said.is_empty() {
                    SHARED_LANGUAGES.to_vec()
                } else {
                    said
                }
            }
        }
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

/// `map` over `pairs` on a few threads, in order: the check runs at startup,
/// before the server listens.
fn par_map<T: Send>(pairs: &[(usize, usize)], map: impl Fn((usize, usize)) -> T + Sync) -> Vec<T> {
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get().min(8));
    let chunk = pairs.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        let parts: Vec<_> = pairs
            .chunks(chunk)
            .map(|part| {
                let map = &map;
                scope.spawn(move || part.iter().map(|pair| map(*pair)).collect::<Vec<_>>())
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
    par_map(&all_pairs(), |(phrasing, card)| {
        let phrasing = &CORPUS.phrasings[phrasing];
        let input = input(
            &phrasing.said,
            target.language(&phrasing.language),
            &CORPUS.cards[card],
        );
        hear(&input, CommandWords::base())
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
    par_map(pairs, |(index, card)| {
        let phrasing = &CORPUS.phrasings[index];
        let input = input(
            &phrasing.said,
            target.language(&phrasing.language),
            &CORPUS.cards[card],
        );
        weakens(
            &phrasing.meant,
            base[index * cards + card],
            hear(&input, words),
        )
        .then_some((index, card))
    })
    .into_iter()
    .flatten()
    .collect()
}

/// A configured phrase that accepts a phrasing no built-in phrase accepts:
/// its language, and the phrasing.
fn loose_phrase(
    words: &CommandWords,
    phrases: &ConfirmationPhrasesByLanguage,
) -> Option<(String, String)> {
    let base = CommandWords::base();
    CORPUS.phrasings.iter().find_map(|phrasing| {
        let said = &phrasing.said;
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

/// The configured entries of `languages`, as (language, list, entry).
fn entries_of(
    config: &VoiceCommandWordsByLanguage,
    languages: &[&str],
) -> Vec<(String, &'static str, String)> {
    languages
        .iter()
        .filter_map(|language| Some((*language, config.get(*language)?)))
        .flat_map(|(language, lists)| {
            VoiceCommandWordLists::NAMES.iter().flat_map(move |name| {
                lists
                    .list(name)
                    .into_iter()
                    .flatten()
                    .map(move |entry| (language.to_string(), *name, entry.clone()))
            })
        })
        .collect()
}

fn without_entries(
    config: &VoiceCommandWordsByLanguage,
    languages: &[&str],
) -> VoiceCommandWordsByLanguage {
    let mut emptied = config.clone();
    for language in languages {
        if let Some(lists) = emptied.get_mut(*language) {
            for name in VoiceCommandWordLists::NAMES {
                if let Some(list) = lists.list_mut(name) {
                    list.clear();
                }
            }
        }
    }
    emptied
}

/// Drops the entries behind the `failing` pairs: all of the target's
/// entries are taken out, then put back one at a time, and an entry that
/// brings back a failing pair stays out. Two entries that each weaken alone
/// both stay out, and the rest are kept. Returns whether anything was
/// dropped; nothing is when the failing pairs remain without any entry.
fn drop_entries(
    target: &Target,
    config: &mut VoiceCommandWordsByLanguage,
    phrases: &ConfirmationPhrasesByLanguage,
    base: &[Heard],
    failing: &[(usize, usize)],
    dropped: &mut Vec<String>,
) -> bool {
    let languages = target.languages();
    let mut kept = without_entries(config, &languages);
    let built = CommandWordsByLanguage::build(&kept, phrases).0;
    if !weakened(target, target.words(&built), base, failing).is_empty() {
        return false;
    }
    let mut any = false;
    for (language, name, entry) in entries_of(config, &languages) {
        let mut trial = kept.clone();
        let Some(list) = trial
            .get_mut(&language)
            .and_then(|lists| lists.list_mut(name))
        else {
            continue;
        };
        list.push(entry.clone());
        let built = CommandWordsByLanguage::build(&trial, phrases).0;
        match weakened(target, target.words(&built), base, failing).first() {
            None => kept = trial,
            Some((phrasing, _)) => {
                let phrasing = &CORPUS.phrasings[*phrasing];
                dropped.push(format!(
                    "approval_voice_commands.words.{language}.{name} entry {entry:?} dropped: with it, {} hear {:?} ({}) as an approval it does not mean, or lose its refusal or stop",
                    target.shown(),
                    phrasing.said,
                    phrasing.language,
                ));
                any = true;
            }
        }
    }
    *config = kept;
    any
}

/// Reruns the sentence sets and the attack set against every language the
/// configured words and phrases build, and drops each configured phrase or
/// word list entry that weakens what the built-in words hear. Repeats until
/// a whole pass drops nothing, since a dropped entry can change what the
/// remaining ones and the phrases do. Returns one line per dropped entry.
/// Without configured words or phrases it does nothing.
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
    let base: Vec<Vec<Heard>> = targets.iter().map(base_heard).collect();

    loop {
        let before = dropped.len();
        for (target, base) in targets.iter().zip(&base) {
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
            let failing = weakened(target, target.words(&built), base, &all_pairs());
            if failing.is_empty()
                || drop_entries(target, config, phrases, base, &failing, &mut dropped)
            {
                continue;
            }
            for language in target.languages_to_drop(&failing) {
                let places = [
                    config
                        .remove(language)
                        .map(|_| format!("approval_voice_commands.words.{language}")),
                    phrases
                        .remove(language)
                        .map(|_| format!("approval_voice_decisions.phrases.{language}")),
                ];
                for place in places.into_iter().flatten() {
                    dropped.push(format!(
                        "{place} dropped: together with the rest it weakens what {} hear, and no single entry explains it",
                        target.shown()
                    ));
                }
            }
        }
        if dropped.len() == before {
            return dropped;
        }
    }
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

    /// The German and English lists of the `erato-voice-command-words`
    /// configuration package. Its refusals and its "von mir aus" are labelled
    /// so in the sentence sets, and the built-in words hear them as unclear.
    fn package() -> VoiceCommandWordsByLanguage {
        VoiceCommandWordsByLanguage::from([
            (
                "de".to_string(),
                VoiceCommandWordLists {
                    approve: strings(&["von mir aus"]),
                    reject: strings(&["das will ich nicht", "will ich nicht", "nicht ausführen"]),
                    ..Default::default()
                },
            ),
            (
                "en".to_string(),
                VoiceCommandWordLists {
                    approve: strings(&["fine by me"]),
                    reject: strings(&["I don't want that", "don't run it"]),
                    ..Default::default()
                },
            ),
        ])
    }

    #[test]
    fn the_voice_command_words_package_keeps_every_entry() {
        let mut words = package();
        words.insert("fr".to_string(), french());
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
    fn two_entries_that_weaken_alone_go_and_other_languages_stay() {
        let mut words = package();
        let mut french = french();
        french
            .approve
            .extend(strings(&["mach weiter", "Mach weiter"]));
        words.insert("fr".to_string(), french);
        let mut phrases = ConfirmationPhrasesByLanguage::new();
        let dropped = recheck_configured(&mut words, &mut phrases);
        assert_eq!(
            words["fr"].approve,
            ["oui", "d'accord", "vas-y"],
            "{dropped:#?}"
        );
        assert_eq!(words["de"], package()["de"], "{dropped:#?}");
        assert_eq!(words["en"], package()["en"], "{dropped:#?}");
        assert!(
            dropped
                .iter()
                .all(|line| line.contains(".fr.approve entry")),
            "{dropped:#?}"
        );
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
