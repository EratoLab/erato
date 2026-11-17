//! Scores both sentence sets, each on its own, against real chat models. Not
//! part of the normal test run:
//!
//! ```text
//! APPROVAL_VOICE_COMMANDS_EVAL_PROVIDERS=providers.json \
//!   cargo nextest run -p erato --run-ignored only score_sentence_set --no-capture
//! ```
//!
//! `providers.json` maps a name to a `[chat_providers.providers.<id>]` table
//! as JSON. Optional: `APPROVAL_VOICE_COMMANDS_EVAL_PROMPT` (a file with the
//! instruction to try), `APPROVAL_VOICE_COMMANDS_EVAL_OUT` (a file for every
//! answer as JSON lines), `APPROVAL_VOICE_COMMANDS_EVAL_FILE` (score only that
//! file), `APPROVAL_VOICE_COMMANDS_EVAL_CONCURRENCY`. Every sentence costs one
//! model call per provider.

use super::tests::{Sentence, SentenceSet, heldout_set, sentence_set};
use super::*;
use futures::StreamExt;
use std::collections::BTreeMap;
use std::io::Write;
use std::time::Instant;

/// Requests in flight per provider; `APPROVAL_VOICE_COMMANDS_EVAL_CONCURRENCY` overrides it.
const CONCURRENCY: usize = 4;
/// Long enough to measure slow answers; the configured limit is applied after.
const MEASURE_TIMEOUT: Duration = Duration::from_secs(15);

struct Scored<'a> {
    sentence: &'a Sentence,
    /// The rules stage's answer, after the guard.
    rules: Option<(VoiceMeaning, Option<String>)>,
    model: VoiceCommand,
    model_outcome: &'static str,
    model_ms: u128,
}

fn correct(sentence: &Sentence, meaning: VoiceMeaning, piece_id: &Option<String>) -> bool {
    meaning == sentence.meaning
        && (!matches!(meaning, VoiceMeaning::Repeat | VoiceMeaning::ReadText)
            || *piece_id == sentence.piece_id)
}

fn percentile(sorted: &[u128], share: f64) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    let index = ((sorted.len() as f64 - 1.0) * share).round() as usize;
    sorted[index]
}

struct Tally {
    by: BTreeMap<String, (usize, usize)>,
}

impl Tally {
    fn new() -> Self {
        Self {
            by: BTreeMap::new(),
        }
    }

    fn add(&mut self, key: String, ok: bool) {
        let entry = self.by.entry(key).or_default();
        entry.0 += usize::from(ok);
        entry.1 += 1;
    }

    fn print(&self, title: &str) {
        println!("  {title}:");
        for (key, (ok, all)) in &self.by {
            println!(
                "    {key:<24} {ok:>3}/{all:<3} {:>5.1}%",
                100.0 * *ok as f64 / *all as f64
            );
        }
    }
}

#[tokio::test]
#[ignore = "calls real chat models; set APPROVAL_VOICE_COMMANDS_EVAL_PROVIDERS"]
async fn score_sentence_set() {
    let path = std::env::var("APPROVAL_VOICE_COMMANDS_EVAL_PROVIDERS")
        .expect("APPROVAL_VOICE_COMMANDS_EVAL_PROVIDERS names a JSON file of providers");
    let providers: BTreeMap<String, ChatProviderConfig> =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let prompt = std::env::var("APPROVAL_VOICE_COMMANDS_EVAL_PROMPT")
        .map(|path| std::fs::read_to_string(path).unwrap())
        .unwrap_or_else(|_| DEFAULT_PROMPT.to_string());
    let mut out = std::env::var("APPROVAL_VOICE_COMMANDS_EVAL_OUT")
        .ok()
        .map(|path| std::fs::File::create(path).unwrap());
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::WARN)
        .try_init();
    let sets = [
        ("sentences.json", sentence_set()),
        ("heldout_sentences.json", heldout_set()),
    ];
    for (name, config) in &providers {
        let client =
            crate::state::AppState::build_genai_client_with_headers_context(config.clone(), None)
                .unwrap();
        for (file, set) in &sets {
            if std::env::var("APPROVAL_VOICE_COMMANDS_EVAL_FILE").is_ok_and(|only| only != *file) {
                continue;
            }
            let scored = score(set, &client, config, &prompt).await;
            report(name, config, file, set, &scored, out.as_mut());
        }
    }
}

async fn score<'a>(
    set: &'a SentenceSet,
    client: &genai::Client,
    config: &ChatProviderConfig,
    prompt: &str,
) -> Vec<Scored<'a>> {
    futures::stream::iter(&set.sentences)
        .map(|sentence| {
            let input = set.input(sentence);
            async move {
                let rules = classify_by_rules(&input)
                    .map(|found| (found.command.meaning, found.command.piece_id));
                let model = VoiceModel {
                    client,
                    config,
                    prompt,
                    timeout: MEASURE_TIMEOUT,
                };
                let start = Instant::now();
                let answer = model::ask(&model, &input).await;
                let model_ms = start.elapsed().as_millis();
                let (model, model_outcome) = match answer {
                    Ok(answer) => {
                        let classified = from_answer(&input, &answer);
                        (classified.command, classified.outcome)
                    }
                    Err(outcome) => (unclear(), outcome),
                };
                Scored {
                    sentence,
                    rules,
                    model,
                    model_outcome,
                    model_ms,
                }
            }
        })
        .buffered(
            std::env::var("APPROVAL_VOICE_COMMANDS_EVAL_CONCURRENCY")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(CONCURRENCY),
        )
        .collect()
        .await
}

fn report(
    name: &str,
    config: &ChatProviderConfig,
    file: &str,
    set: &SentenceSet,
    scored: &[Scored],
    mut out: Option<&mut std::fs::File>,
) {
    let limit = Duration::from_millis(u64::from(
        crate::config::ApprovalVoiceCommandsConfig::default().model_timeout_ms,
    ));
    println!("\n=== {file}: {name} ({}) ===", config.model_name);
    let mut whole = (Tally::new(), Tally::new(), Tally::new());
    let mut alone = (Tally::new(), Tally::new());
    let (mut whole_ok, mut alone_ok, mut late) = (0, 0, 0);
    let (mut rules_answered, mut rules_right) = (0, 0);
    let mut wrong: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    let mut alone_wrong: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    let mut misses = Vec::new();
    let (mut model_ms, mut whole_ms): (Vec<u128>, Vec<u128>) = (Vec::new(), Vec::new());
    for scored in scored {
        let sentence = scored.sentence;
        let in_time = Duration::from_millis(scored.model_ms as u64) <= limit;
        let (meaning, piece_id, source) = match &scored.rules {
            Some((meaning, piece_id)) => {
                rules_answered += 1;
                rules_right += usize::from(correct(sentence, *meaning, piece_id));
                whole_ms.push(0);
                (*meaning, piece_id.clone(), "rules")
            }
            None if in_time => {
                whole_ms.push(scored.model_ms);
                (scored.model.meaning, scored.model.piece_id.clone(), "model")
            }
            None => {
                whole_ms.push(limit.as_millis());
                late += 1;
                (VoiceMeaning::Unclear, None, "late")
            }
        };
        model_ms.push(scored.model_ms);
        let ok = correct(sentence, meaning, &piece_id);
        whole_ok += usize::from(ok);
        whole.0.add(sentence.meaning.wire_name().to_string(), ok);
        whole.1.add(sentence.way.clone(), ok);
        whole.2.add(
            format!("{} / card {}", sentence.language, sentence.card()),
            ok,
        );
        for (got, list) in [
            (meaning, &mut wrong),
            (scored.model.meaning, &mut alone_wrong),
        ] {
            if got.is_decision() && sentence.meaning != got {
                list.entry(got.wire_name())
                    .or_default()
                    .push(format!("{} {:?}", sentence.id, sentence.text));
            }
        }
        if !ok {
            misses.push(format!(
                "{:<16} {:<10} {:<34} -> {} {} ({source}) {:?}",
                sentence.id,
                sentence.way,
                format!("{:?}", sentence.text),
                meaning.wire_name(),
                piece_id.as_deref().unwrap_or("-"),
                sentence.piece_id
            ));
        }
        let model_ok = correct(sentence, scored.model.meaning, &scored.model.piece_id);
        alone_ok += usize::from(model_ok);
        alone
            .0
            .add(sentence.meaning.wire_name().to_string(), model_ok);
        alone.1.add(sentence.way.clone(), model_ok);
        if let Some(out) = out.as_mut() {
            writeln!(
                out,
                "{}",
                serde_json::json!({
                    "file": file,
                    "provider": name,
                    "id": sentence.id,
                    "expected": sentence.meaning.wire_name(),
                    "expected_piece": sentence.piece_id,
                    "rules": scored.rules.as_ref().map(|(m, p)| (m.wire_name(), p)),
                    "model": scored.model.meaning.wire_name(),
                    "model_piece": scored.model.piece_id,
                    "model_outcome": scored.model_outcome,
                    "model_ms": scored.model_ms,
                    "result": meaning.wire_name(),
                    "result_piece": piece_id,
                    "source": source,
                })
            )
            .unwrap();
        }
    }
    let all = scored.len();
    let mut outcomes: BTreeMap<&str, usize> = BTreeMap::new();
    for scored in scored {
        *outcomes.entry(scored.model_outcome).or_default() += 1;
    }
    model_ms.sort_unstable();
    whole_ms.sort_unstable();
    let count = |map: &BTreeMap<&str, Vec<String>>, key: &str| map.get(key).map_or(0, Vec::len);
    println!("Model outcomes: {outcomes:?}");
    println!(
        "Rules, then the model within {} ms: {whole_ok}/{all} = {:.1}% correct; wrongly approve: {}; wrongly reject: {}; model late: {late}",
        limit.as_millis(),
        100.0 * whole_ok as f64 / all as f64,
        count(&wrong, "approve"),
        count(&wrong, "reject"),
    );
    println!(
        "  the rules answered {rules_answered} of {all} ({} sentences in the file), {rules_right} of them right",
        set.sentences.len()
    );
    whole.0.print("by meaning");
    whole.1.print("by way of saying it");
    whole.2.print("by language and card");
    println!(
        "  time per sentence: median {} ms, p95 {} ms",
        percentile(&whole_ms, 0.5),
        percentile(&whole_ms, 0.95)
    );
    println!(
        "Model alone on every sentence: {alone_ok}/{all} = {:.1}% correct; wrongly approve: {}; wrongly reject: {}",
        100.0 * alone_ok as f64 / all as f64,
        count(&alone_wrong, "approve"),
        count(&alone_wrong, "reject"),
    );
    alone.0.print("by meaning");
    alone.1.print("by way of saying it");
    println!(
        "  model time: median {} ms, p95 {} ms, max {} ms",
        percentile(&model_ms, 0.5),
        percentile(&model_ms, 0.95),
        model_ms.last().copied().unwrap_or(0)
    );
    for (meaning, list) in &wrong {
        println!("  WRONGLY {meaning}: {list:?}");
    }
    for (meaning, list) in &alone_wrong {
        println!("  model alone wrongly {meaning}: {list:?}");
    }
    println!("  misses (rules, then the model):");
    for miss in &misses {
        println!("    {miss}");
    }
}
