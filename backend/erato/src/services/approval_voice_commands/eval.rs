//! Scores the sentence set against real chat models. Not part of the normal
//! test run:
//!
//! ```text
//! APPROVAL_VOICE_COMMANDS_EVAL_PROVIDERS=providers.json \
//!   cargo nextest run -p erato --run-ignored only score_sentence_set --no-capture
//! ```
//!
//! `providers.json` maps a name to a `[chat_providers.providers.<id>]` table
//! as JSON. Optional: `APPROVAL_VOICE_COMMANDS_EVAL_PROMPT` (a file with the
//! instruction to try), `APPROVAL_VOICE_COMMANDS_EVAL_OUT` (a file for every
//! answer as JSON lines). Every sentence costs one model call per provider.

use super::tests::{Sentence, sentence_set};
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
    let limit = Duration::from_millis(u64::from(
        crate::config::ApprovalVoiceCommandsConfig::default().model_timeout_ms,
    ));
    let mut out = std::env::var("APPROVAL_VOICE_COMMANDS_EVAL_OUT")
        .ok()
        .map(|path| std::fs::File::create(path).unwrap());
    let set = sentence_set();
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::WARN)
        .try_init();

    for (name, config) in &providers {
        let client =
            crate::state::AppState::build_genai_client_with_headers_context(config.clone(), None)
                .unwrap();
        let scored: Vec<Scored> = futures::stream::iter(&set.sentences)
            .map(|sentence| {
                let input = set.input(sentence);
                let client = &client;
                let prompt = prompt.as_str();
                async move {
                    let rules =
                        rules::match_rules(&input).map(|found| (found.meaning, found.piece_id));
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
            .await;

        println!("\n=== {name} ({}) ===", config.model_name);
        let mut whole = (Tally::new(), Tally::new(), Tally::new());
        let mut alone = (Tally::new(), Tally::new());
        let (mut whole_ok, mut alone_ok) = (0, 0);
        let mut wrong_approvals = Vec::new();
        let mut alone_wrong_approvals = Vec::new();
        let mut misses = Vec::new();
        let mut model_ms: Vec<u128> = Vec::new();
        let mut whole_ms: Vec<u128> = Vec::new();
        let mut late = 0;
        for scored in &scored {
            let sentence = scored.sentence;
            let in_time = Duration::from_millis(scored.model_ms as u64) <= limit;
            let (meaning, piece_id, source) = match &scored.rules {
                Some((meaning, piece_id)) => {
                    let command = guarded(
                        &set.input(sentence),
                        *meaning,
                        piece_id.clone(),
                        VoiceCommandSource::Rules,
                    );
                    whole_ms.push(0);
                    (command.meaning, command.piece_id, "rules")
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
            whole.2.add(sentence.language.clone(), ok);
            if meaning == VoiceMeaning::Approve && sentence.meaning != VoiceMeaning::Approve {
                wrong_approvals.push(sentence.id.clone());
            }
            if !ok {
                misses.push(format!(
                    "{:<16} {:<10} {:<30} -> {} {} ({source}) {:?}",
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
            if scored.model.meaning == VoiceMeaning::Approve
                && sentence.meaning != VoiceMeaning::Approve
            {
                alone_wrong_approvals.push(sentence.id.clone());
            }
            if let Some(out) = out.as_mut() {
                writeln!(
                    out,
                    "{}",
                    serde_json::json!({
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
        for scored in &scored {
            *outcomes.entry(scored.model_outcome).or_default() += 1;
        }
        println!("Model outcomes: {outcomes:?}");
        model_ms.sort_unstable();
        whole_ms.sort_unstable();
        println!(
            "Rules, then the model within {} ms: {whole_ok}/{all} = {:.1}% correct; wrongly approve: {}; model late: {late}",
            limit.as_millis(),
            100.0 * whole_ok as f64 / all as f64,
            wrong_approvals.len()
        );
        whole.0.print("by meaning");
        whole.1.print("by way of saying it");
        whole.2.print("by language");
        println!(
            "  time per sentence: median {} ms, p95 {} ms",
            percentile(&whole_ms, 0.5),
            percentile(&whole_ms, 0.95)
        );
        println!(
            "Model alone on every sentence: {alone_ok}/{all} = {:.1}% correct; wrongly approve: {}",
            100.0 * alone_ok as f64 / all as f64,
            alone_wrong_approvals.len()
        );
        alone.0.print("by meaning");
        alone.1.print("by way of saying it");
        println!(
            "  model time: median {} ms, p95 {} ms, max {} ms",
            percentile(&model_ms, 0.5),
            percentile(&model_ms, 0.95),
            model_ms.last().copied().unwrap_or(0)
        );
        if !wrong_approvals.is_empty() {
            println!("  WRONGLY APPROVED: {wrong_approvals:?}");
        }
        if !alone_wrong_approvals.is_empty() {
            println!("  model alone wrongly approved: {alone_wrong_approvals:?}");
        }
        println!("  misses (rules, then the model):");
        for miss in &misses {
            println!("    {miss}");
        }
    }
}
