//! Rewords every card of the scenario set with real chat models and reports
//! how often the rule check rejects a wording, why, and how long the model
//! takes. Not part of the normal test run:
//!
//! ```text
//! APPROVAL_REWORDING_EVAL_PROVIDERS=providers.json \
//!   cargo nextest run -p erato --run-ignored only score_rewording_set --no-capture
//! ```
//!
//! `providers.json` maps a name to a `[chat_providers.providers.<id>]` table
//! as JSON. Optional: `APPROVAL_REWORDING_EVAL_PROMPT` (a file with the
//! instruction to try), `APPROVAL_REWORDING_EVAL_WORDS` (a JSON file mapping a
//! language to its allowed words), `APPROVAL_REWORDING_EVAL_OUT` (a file for
//! every card as JSON lines), `APPROVAL_REWORDING_EVAL_CONCURRENCY`.

use super::tests::{Card, card_set};
use super::*;
use crate::config::ChatProviderConfig;
use futures::StreamExt;
use std::io::Write;
use std::time::Instant;

const CONCURRENCY: usize = 2;
/// Long enough to measure slow answers; the configured limit is applied after.
const MEASURE_TIMEOUT: Duration = Duration::from_secs(20);

struct Scored<'a> {
    card: &'a Card,
    outcome: Outcome,
    ms: u128,
}

fn percentile(sorted: &[u128], share: f64) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[((sorted.len() as f64 - 1.0) * share).round() as usize]
}

#[tokio::test]
#[ignore = "calls real chat models; set APPROVAL_REWORDING_EVAL_PROVIDERS"]
async fn score_rewording_set() {
    let path = std::env::var("APPROVAL_REWORDING_EVAL_PROVIDERS")
        .expect("APPROVAL_REWORDING_EVAL_PROVIDERS names a JSON file of providers");
    let providers: BTreeMap<String, ChatProviderConfig> =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let prompt = std::env::var("APPROVAL_REWORDING_EVAL_PROMPT")
        .map(|path| std::fs::read_to_string(path).unwrap())
        .unwrap_or_else(|_| DEFAULT_PROMPT.to_string());
    let words: BTreeMap<String, Vec<String>> = std::env::var("APPROVAL_REWORDING_EVAL_WORDS")
        .map(|path| serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap())
        .unwrap_or_default();
    let concurrency = std::env::var("APPROVAL_REWORDING_EVAL_CONCURRENCY")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(CONCURRENCY);
    let mut out = std::env::var("APPROVAL_REWORDING_EVAL_OUT")
        .ok()
        .map(|path| std::fs::File::create(path).unwrap());
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::WARN)
        .try_init();
    let cards = card_set();
    for (name, config) in &providers {
        let client =
            crate::state::AppState::build_genai_client_with_headers_context(config.clone(), None)
                .unwrap();
        let allowed: BTreeMap<String, BTreeSet<String>> = ["de", "en"]
            .into_iter()
            .map(|language| {
                let configured = words.get(language).cloned().unwrap_or_default();
                (
                    language.to_string(),
                    check::allowed_words(language, &configured),
                )
            })
            .collect();
        let scored: Vec<Scored<'_>> = futures::stream::iter(&cards)
            .map(|card| {
                let client = &client;
                let prompt = &prompt;
                let allowed = &allowed[&card.language];
                async move {
                    let model = RewordModel {
                        client,
                        config,
                        prompt,
                        allowed,
                        timeout: MEASURE_TIMEOUT,
                    };
                    let start = Instant::now();
                    let outcome = reword(
                        &RewordInput {
                            language: &card.language,
                            pieces: &card.pieces,
                        },
                        &model,
                    )
                    .await;
                    Scored {
                        card,
                        outcome,
                        ms: start.elapsed().as_millis(),
                    }
                }
            })
            .buffer_unordered(concurrency)
            .collect()
            .await;
        report(name, config, &scored, out.as_mut());
    }
}

fn report(
    name: &str,
    config: &ChatProviderConfig,
    scored: &[Scored<'_>],
    mut out: Option<&mut std::fs::File>,
) {
    println!("\n== {name} ({}) ==", config.model_name);
    for language in ["de", "en"] {
        let cards: Vec<&Scored<'_>> = scored
            .iter()
            .filter(|scored| {
                scored.card.language == language && scored.outcome.outcome != "nothing_to_reword"
            })
            .collect();
        let asked: usize = cards
            .iter()
            .map(|scored| {
                scored
                    .card
                    .pieces
                    .iter()
                    .filter(|piece| rewordable(piece))
                    .count()
            })
            .sum();
        let natural: usize = cards
            .iter()
            .map(|scored| {
                scored
                    .outcome
                    .reworded
                    .pieces
                    .iter()
                    .filter(|piece| piece.natural)
                    .count()
            })
            .sum();
        let answered: usize = cards
            .iter()
            .map(|scored| scored.outcome.wordings.len())
            .sum();
        let unchanged: usize = cards
            .iter()
            .map(|scored| {
                scored
                    .card
                    .pieces
                    .iter()
                    .filter(|piece| {
                        scored
                            .outcome
                            .wordings
                            .get(&piece.id)
                            .map(|text| text.trim())
                            == Some(piece.text.trim())
                    })
                    .count()
            })
            .sum();
        let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
        let mut new_words: BTreeMap<String, usize> = BTreeMap::new();
        let mut failures: BTreeMap<&str, usize> = BTreeMap::new();
        for scored in &cards {
            for (_, rejection) in &scored.outcome.rejected {
                *kinds.entry(rejection.kind()).or_default() += 1;
                if let Rejection::NewWord(word) = rejection {
                    *new_words.entry(word.clone()).or_default() += 1;
                }
            }
            if !matches!(
                scored.outcome.outcome,
                "reworded" | "partly_reworded" | "none_passed"
            ) {
                *failures.entry(scored.outcome.outcome).or_default() += 1;
            }
        }
        let mut ms: Vec<u128> = cards.iter().map(|scored| scored.ms).collect();
        ms.sort_unstable();
        let rejected: usize = kinds.values().sum();
        let changed = answered - unchanged;
        println!(
            "  {language}: {} cards, {asked} rewordable pieces, {answered} answered, {unchanged} returned unchanged, {changed} changed: {} spoken in the new wording, {rejected} rejected ({:.1}% of changed, {:.1}% of answered)",
            cards.len(),
            natural - unchanged,
            100.0 * rejected as f64 / changed.max(1) as f64,
            100.0 * rejected as f64 / answered.max(1) as f64
        );
        let tokens: Vec<(u64, u64)> = cards
            .iter()
            .filter_map(|scored| scored.outcome.tokens)
            .collect();
        if !tokens.is_empty() {
            let count = tokens.len() as f64;
            println!(
                "    tokens per card: {:.0} in, {:.0} out (mean of {})",
                tokens.iter().map(|(input, _)| *input as f64).sum::<f64>() / count,
                tokens.iter().map(|(_, output)| *output as f64).sum::<f64>() / count,
                tokens.len()
            );
        }
        println!("    rejected by kind: {kinds:?}");
        println!("    cards without an answer: {failures:?}");
        let mut top: Vec<(String, usize)> = new_words.into_iter().collect();
        top.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        println!("    new words most often: {:?}", &top[..top.len().min(25)]);
        println!(
            "    model ms: p50 {} p90 {} max {}",
            percentile(&ms, 0.5),
            percentile(&ms, 0.9),
            ms.last().copied().unwrap_or(0)
        );
    }
    if let Some(out) = out.as_mut() {
        for scored in scored {
            let pieces: Vec<serde_json::Value> = scored
                .card
                .pieces
                .iter()
                .zip(&scored.outcome.reworded.pieces)
                .map(|(piece, said)| {
                    serde_json::json!({
                        "id": piece.id,
                        "role": piece.role,
                        "precise": piece.text,
                        "wording": scored.outcome.wordings.get(&piece.id),
                        "spoken": said.text,
                        "natural": said.natural,
                        "rejected": scored.outcome.rejected.iter()
                            .find(|(id, _)| *id == piece.id)
                            .map(|(_, rejection)| format!("{rejection:?}")),
                    })
                })
                .collect();
            writeln!(
                out,
                "{}",
                serde_json::json!({
                    "provider": name,
                    "scenario": scored.card.scenario,
                    "language": scored.card.language,
                    "outcome": scored.outcome.outcome,
                    "ms": scored.ms,
                    "pieces": pieces,
                })
            )
            .unwrap();
        }
    }
}
