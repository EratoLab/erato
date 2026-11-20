use super::*;
use crate::services::genai::GenAIChatStreamResponse;
use async_trait::async_trait;
use genai::chat::{ChatOptions, ChatRequest, ChatResponse, MessageContent};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Card {
    pub current_piece_id: String,
    pub pieces: Vec<CardPiece>,
}

#[derive(Debug, Clone, Deserialize)]
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

impl Sentence {
    /// The card named by a `card:` tag, else the language's example card.
    pub(super) fn card(&self) -> &str {
        self.tags
            .iter()
            .find_map(|tag| tag.strip_prefix("card:"))
            .unwrap_or(&self.language)
    }
}

impl SentenceSet {
    pub(super) fn input<'a>(&'a self, sentence: &'a Sentence) -> VoiceCommandInput<'a> {
        let card = &self.cards[sentence.card()];
        VoiceCommandInput {
            transcript: &sentence.text,
            language: &sentence.language,
            pieces: &card.pieces,
            current_piece_id: Some(&card.current_piece_id),
            question: None,
        }
    }
}

const WAYS: [&str; 6] = ["plain", "free", "filler", "mixed", "misheard", "broken_off"];

#[test]
fn the_sentence_set_covers_every_meaning_in_both_languages() {
    let set = sentence_set();
    let mut counts: BTreeMap<(String, &str), usize> = BTreeMap::new();
    let mut ids = std::collections::HashSet::new();
    for sentence in &set.sentences {
        assert!(ids.insert(&sentence.id), "{} twice", sentence.id);
        assert!(WAYS.contains(&sentence.way.as_str()), "{}", sentence.id);
        *counts
            .entry((sentence.language.clone(), sentence.meaning.wire_name()))
            .or_default() += 1;
        let card = &set.cards[sentence.card()];
        match sentence.meaning {
            VoiceMeaning::Repeat | VoiceMeaning::ReadText => {
                let piece = sentence.piece_id.as_deref().expect("a piece is expected");
                assert!(card.pieces.iter().any(|p| p.id == piece), "{}", sentence.id);
            }
            _ => assert_eq!(sentence.piece_id, None, "{}", sentence.id),
        }
        assert!(
            check_input(&set.input(sentence)).is_ok(),
            "{} breaks the limits",
            sentence.id
        );
    }
    for language in ["de", "en"] {
        for meaning in VoiceMeaning::ALL {
            let count = counts
                .get(&(language.to_string(), meaning.wire_name()))
                .copied()
                .unwrap_or(0);
            assert!(count >= 12, "{language} {}: {count}", meaning.wire_name());
        }
    }
}

#[test]
fn every_plain_sentence_is_matched_by_the_rules_alone() {
    let set = sentence_set();
    let mut misses = Vec::new();
    for sentence in set.sentences.iter().filter(|s| s.way == "plain") {
        let found = classify_by_rules(&set.input(sentence));
        let got = found
            .as_ref()
            .map(|found| (found.command.meaning, found.command.piece_id.clone()));
        if got != Some((sentence.meaning, sentence.piece_id.clone())) {
            misses.push(format!("{} {:?}: {got:?}", sentence.id, sentence.text));
        }
    }
    assert!(misses.is_empty(), "{misses:#?}");
}

#[test]
fn the_rules_never_report_a_decision_that_is_not_meant_in_either_set() {
    for set in [sentence_set(), heldout_set()] {
        for sentence in &set.sentences {
            let Some(classified) = classify_by_rules(&set.input(sentence)) else {
                continue;
            };
            if classified.command.meaning.is_decision() {
                assert_eq!(
                    classified.command.meaning, sentence.meaning,
                    "{} {:?}",
                    sentence.id, sentence.text
                );
            }
        }
    }
}

#[tokio::test]
async fn whatever_the_rules_match_they_match_right() {
    let set = sentence_set();
    let mut wrong = Vec::new();
    for sentence in &set.sentences {
        let classified = classify(&set.input(sentence), None).await;
        if classified.command.source == VoiceCommandSource::Rules
            && (
                classified.command.meaning,
                classified.command.piece_id.clone(),
            ) != (sentence.meaning, sentence.piece_id.clone())
        {
            wrong.push(format!(
                "{} {:?}: {:?} {:?}",
                sentence.id, sentence.text, classified.command.meaning, classified.command.piece_id
            ));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}

enum Script {
    Reply(String),
    Fail,
    Sleep(Duration),
}

struct ScriptedModel {
    script: Script,
    calls: AtomicUsize,
    request: Mutex<Option<(ChatRequest, ChatOptions)>>,
}

impl ScriptedModel {
    fn new(script: Script) -> Self {
        Self {
            script,
            calls: AtomicUsize::new(0),
            request: Mutex::new(None),
        }
    }

    fn answering(meaning: &str, piece_id: Option<&str>) -> Self {
        Self::new(Script::Reply(
            serde_json::json!({"meaning": meaning, "piece_id": piece_id}).to_string(),
        ))
    }
}

#[async_trait]
impl GenAIClient for ScriptedModel {
    async fn exec_chat(
        &self,
        _model: &str,
        request: ChatRequest,
        options: Option<&ChatOptions>,
    ) -> genai::Result<ChatResponse> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.request.lock().unwrap() = Some((request, options.cloned().unwrap_or_default()));
        let text = match &self.script {
            Script::Reply(text) => text.clone(),
            Script::Fail => return Err(genai::Error::Internal("forced failure".into())),
            Script::Sleep(duration) => {
                tokio::time::sleep(*duration).await;
                r#"{"meaning":"skip","piece_id":null}"#.into()
            }
        };
        let model_iden = genai::ModelIden::new(genai::adapter::AdapterKind::OpenAI, "test-model");
        Ok(ChatResponse {
            content: MessageContent::from_text(text),
            reasoning_content: None,
            model_iden: model_iden.clone(),
            provider_model_iden: model_iden,
            stop_reason: None,
            usage: Default::default(),
            captured_raw_body: None,
            response_id: None,
        })
    }

    async fn exec_chat_stream(
        &self,
        _model: &str,
        _request: ChatRequest,
        _options: Option<&ChatOptions>,
    ) -> genai::Result<GenAIChatStreamResponse> {
        panic!("voice commands use the non-streaming chat API")
    }
}

fn provider() -> ChatProviderConfig {
    ChatProviderConfig {
        provider_kind: "openai".into(),
        model_name: "test-model".into(),
        ..Default::default()
    }
}

fn card() -> (Vec<CardPiece>, String) {
    let set = sentence_set();
    let card = set.cards["de"].clone();
    (card.pieces, card.current_piece_id)
}

async fn ask(client: &ScriptedModel, transcript: &str) -> Classified {
    let (pieces, current) = card();
    let config = provider();
    let input = VoiceCommandInput {
        transcript,
        language: "de",
        pieces: &pieces,
        current_piece_id: Some(&current),
        question: None,
    };
    classify(
        &input,
        Some(VoiceModel {
            client,
            config: &config,
            prompt: DEFAULT_PROMPT,
            timeout: Duration::from_millis(200),
        }),
    )
    .await
}

const FREE_PLAIN: &str = "das war mir jetzt zu viel auf einmal";

#[tokio::test]
async fn the_model_is_asked_only_when_the_rules_do_not_match() {
    let model = ScriptedModel::answering("rest", None);
    let classified = ask(&model, "weiter").await;
    assert_eq!(classified.command.meaning, VoiceMeaning::Skip);
    assert_eq!(classified.command.source, VoiceCommandSource::Rules);
    assert_eq!(model.calls.load(Ordering::SeqCst), 0);

    let classified = ask(&model, FREE_PLAIN).await;
    assert_eq!(
        classified.command,
        VoiceCommand {
            meaning: VoiceMeaning::Rest,
            piece_id: None,
            source: VoiceCommandSource::Model,
            decision: None,
        }
    );
    assert_eq!(model.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn without_a_model_words_the_rules_do_not_match_are_unclear() {
    let (pieces, current) = card();
    let input = VoiceCommandInput {
        transcript: FREE_PLAIN,
        language: "de",
        pieces: &pieces,
        current_piece_id: Some(&current),
        question: None,
    };
    let classified = classify(&input, None).await;
    assert_eq!(classified.command.meaning, VoiceMeaning::Unclear);
    assert_eq!(classified.command.source, VoiceCommandSource::None);
    assert_eq!(classified.outcome, "no_model");
}

#[tokio::test]
async fn a_late_failing_or_off_list_model_gives_unclear() {
    for (model, outcome) in [
        (
            ScriptedModel::new(Script::Sleep(Duration::from_secs(5))),
            "timeout",
        ),
        (ScriptedModel::new(Script::Fail), "provider_error"),
        (
            ScriptedModel::answering("approve_all", None),
            "invalid_reply",
        ),
        (
            ScriptedModel::new(Script::Reply("Weiter geht's: skip".into())),
            "invalid_reply",
        ),
        (
            ScriptedModel::new(Script::Reply(
                r#"{"meaning":"skip","piece_id":null,"say":"Okay, weiter."}"#.into(),
            )),
            "invalid_reply",
        ),
        (
            ScriptedModel::answering("repeat", Some("p42")),
            "wrong_piece",
        ),
        (
            ScriptedModel::answering("read_text", Some("p3")),
            "wrong_piece",
        ),
    ] {
        let classified = ask(&model, FREE_PLAIN).await;
        assert_eq!(
            classified.command,
            VoiceCommand {
                meaning: VoiceMeaning::Unclear,
                piece_id: None,
                source: VoiceCommandSource::None,
                decision: None,
            },
            "{outcome}"
        );
        assert_eq!(classified.outcome, outcome);
    }
}

#[tokio::test]
async fn the_models_piece_is_checked_and_filled_in() {
    let model = ScriptedModel::answering("repeat", Some("p4"));
    assert_eq!(
        ask(&model, FREE_PLAIN).await.command.piece_id.as_deref(),
        Some("p4")
    );
    // Without a named piece, repeat means the current one.
    let model = ScriptedModel::answering("repeat", None);
    assert_eq!(
        ask(&model, FREE_PLAIN).await.command.piece_id.as_deref(),
        Some("p6")
    );
    let model = ScriptedModel::answering("read_text", Some("p7"));
    assert_eq!(
        ask(&model, FREE_PLAIN).await.command.piece_id.as_deref(),
        Some("p7")
    );
    let model = ScriptedModel::answering("read_text", None);
    assert_eq!(
        ask(&model, FREE_PLAIN).await.command.piece_id.as_deref(),
        Some("p6")
    );
    // A meaning without a piece drops the one named.
    let model = ScriptedModel::answering("rest", Some("p3"));
    let classified = ask(&model, FREE_PLAIN).await;
    assert_eq!(
        (classified.command.meaning, classified.command.piece_id),
        (VoiceMeaning::Rest, None)
    );
}

async fn answered_by(
    model: &ScriptedModel,
    set: &SentenceSet,
    sentence: &Sentence,
) -> VoiceCommand {
    let config = provider();
    classify(
        &set.input(sentence),
        Some(VoiceModel {
            client: model,
            config: &config,
            prompt: DEFAULT_PROMPT,
            timeout: Duration::from_millis(200),
        }),
    )
    .await
    .command
}

/// Whatever a model answers, the guard lets only the decisions through that
/// are meant: a model that always says approve, or always reject, never
/// decides a sentence in either set that is not that decision.
#[tokio::test]
async fn a_model_that_always_decides_decides_nothing_that_is_not_meant() {
    for decision in [VoiceMeaning::Approve, VoiceMeaning::Reject] {
        let model = ScriptedModel::answering(decision.wire_name(), None);
        let mut wrong = Vec::new();
        for set in [sentence_set(), heldout_set()] {
            for sentence in &set.sentences {
                let answer = answered_by(&model, &set, sentence).await;
                if answer.meaning == decision && sentence.meaning != decision {
                    wrong.push(format!("{} {:?}", sentence.id, sentence.text));
                }
            }
        }
        assert!(wrong.is_empty(), "{}: {wrong:#?}", decision.wire_name());
    }
}

#[tokio::test]
async fn words_that_could_be_a_change_are_never_sent_on_as_a_new_request() {
    let model = ScriptedModel::answering("new_request", None);
    let mut wrong = Vec::new();
    for set in [sentence_set(), heldout_set()] {
        // A misheard word, or an English field name, hides the change from the
        // guard; those are left to the model.
        for sentence in set.sentences.iter().filter(|sentence| {
            (sentence.meaning == VoiceMeaning::Change
                && sentence.way != "misheard"
                && !matches!(sentence.card(), "dyn" | "de-english-fields"))
                || sentence
                    .tags
                    .iter()
                    .any(|tag| tag == "hard:change_or_new_request")
        }) {
            if answered_by(&model, &set, sentence).await.meaning == VoiceMeaning::NewRequest {
                wrong.push(format!("{} {:?}", sentence.id, sentence.text));
            }
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}

/// Review findings 1.1 to 1.5 and 1.10, and the decisions on 1.1 and 1.11.
#[tokio::test]
async fn the_review_cases_hold() {
    let de = sentence_set().cards["de"].clone();
    let asked = sentence_set().cards["de-asked"].clone();
    let english_fields = sentence_set().cards["de-english-fields"].clone();
    let rules = |words: &str, card: &Card| {
        classify_by_rules(&VoiceCommandInput {
            transcript: words,
            language: "de",
            pieces: &card.pieces,
            current_piece_id: Some(&card.current_piece_id),
            question: None,
        })
        .map(|classified| classified.command.meaning)
    };
    let model_says = |meaning: VoiceMeaning, words: &'static str, card: Card| async move {
        let model = ScriptedModel::answering(meaning.wire_name(), None);
        let config = provider();
        classify_by_model(
            &VoiceCommandInput {
                transcript: words,
                language: "de",
                pieces: &card.pieces,
                current_piece_id: Some(&card.current_piece_id),
                question: None,
            },
            &VoiceModel {
                client: &model,
                config: &config,
                prompt: DEFAULT_PROMPT,
                timeout: Duration::from_millis(200),
            },
        )
        .await
        .command
        .meaning
    };

    // 1.1: a yes before the card asked, or beside a backchannel, is noise.
    assert_eq!(rules("ja", &de), Some(VoiceMeaning::Noise));
    assert_eq!(rules("nein", &de), Some(VoiceMeaning::Noise));
    assert_eq!(rules("ja", &asked), Some(VoiceMeaning::Approve));
    assert_eq!(rules("nein", &asked), Some(VoiceMeaning::Reject));
    assert_eq!(rules("mhm, ja", &asked), Some(VoiceMeaning::Noise));
    assert_eq!(rules("ja ja", &asked), Some(VoiceMeaning::Noise));
    assert_eq!(rules("Ja. Ja. Ja.", &asked), Some(VoiceMeaning::Approve));
    assert_eq!(
        model_says(VoiceMeaning::Approve, "ja, passt", de.clone()).await,
        VoiceMeaning::Noise
    );

    // 1.2: refusals, questions without a question mark and thanks are no approval.
    for words in [
        "ja nee",
        "yeah, nope",
        "nö",
        "nah",
        "passt das",
        "ist das so richtig",
        "stimmt das so",
        "kannst du das so machen",
        "danke",
        "thanks",
    ] {
        assert_ne!(
            model_says(VoiceMeaning::Approve, words, asked.clone()).await,
            VoiceMeaning::Approve,
            "{words}"
        );
    }

    // 1.3: only refusal words make a rejection, whatever the field names.
    for words in [
        "nein, das Datum",
        "das Datum ist falsch",
        "nee, die Teilnehmer passen nicht",
        "ja, das ist falsch",
        "ja, nein",
    ] {
        for card in [&asked, &english_fields] {
            assert_ne!(
                model_says(VoiceMeaning::Reject, words, card.clone()).await,
                VoiceMeaning::Reject,
                "{words}"
            );
        }
    }

    // 1.4: unrelated words are left to the model.
    for words in [
        "was steht heute noch in meinem Kalender?",
        "what else is on my calendar today?",
        "ich hab noch eine Frage zu einem anderen Kunden",
        "ich hab ne Frage",
        "was ist der Unterschied zwischen mit und ohne Mehrwertsteuer?",
        "ich möchte lieber zuerst meine Mails lesen",
        "what's the difference between with and without VAT?",
    ] {
        assert_eq!(rules(words, &de), None, "{words}");
    }
    assert_eq!(rules("hab ich, was noch?", &de), Some(VoiceMeaning::Rest));
    assert_eq!(rules("das kenn ich schon", &de), Some(VoiceMeaning::Skip));
    assert_eq!(rules("ohne Anna", &de), Some(VoiceMeaning::Change));

    // 1.5: a no taken back is the model's to judge.
    assert_eq!(rules("nein, doch", &asked), None);
    assert_eq!(rules("no, wait, yes", &asked), None);

    // 1.10: decomposed Unicode is matched like composed.
    assert_eq!(
        rules("na\u{308}chster Punkt", &de),
        Some(VoiceMeaning::Skip)
    );
    assert_eq!(rules("ho\u{308}r auf", &de), Some(VoiceMeaning::Stop));

    // 1.11: a change that breaks off before it says what is unclear.
    for words in ["nimm lieber den", "ohne die An-", "take the 2-"] {
        assert_eq!(rules(words, &de), None, "{words}");
        assert_eq!(
            model_says(VoiceMeaning::Change, words, de.clone()).await,
            VoiceMeaning::Unclear,
            "{words}"
        );
    }
}

#[test]
fn only_a_short_unconditional_sentence_can_be_a_decision() {
    let (pieces, _) = card();
    for (meaning, words) in [
        (VoiceMeaning::Approve, "ja"),
        (VoiceMeaning::Approve, "okay, mach das"),
        (VoiceMeaning::Approve, "go ahead"),
        (VoiceMeaning::Reject, "nein, lass es"),
        (VoiceMeaning::Reject, "mach das nicht"),
        // Voice loop test 2026-11-18: a final "so" or "then" closes these,
        // and an acknowledgement before a yes is not checked as its words.
        (VoiceMeaning::Approve, "ja passt, mach das so"),
        (VoiceMeaning::Approve, "mach das so"),
        (VoiceMeaning::Approve, "das passt so"),
        (VoiceMeaning::Approve, "ja, genau so"),
        (VoiceMeaning::Approve, "go ahead then"),
        (VoiceMeaning::Approve, "in Ordnung, mach"),
        (VoiceMeaning::Approve, "I see, go ahead"),
    ] {
        assert!(
            rules::Words::of(words).could_be_plain_decision(meaning, &pieces),
            "{words}"
        );
    }
    for words in [
        "ja?",
        "ja, aber",
        "ja, wenn das Datum stimmt",
        "ja, nimm den 22.",
        "yes, only the probability",
        "ja mach das und schick danach noch eine Mail an alle",
        "ja, das Datum passt",
        "yes or no",
        "ja, mach d-",
        "uh, yes, so",
        "ja, nicht so",
        "Jaguar, mach",
        "ja, aber dann",
        "ja, und dann",
        "ja und so",
        "ja so",
        "mach das aus",
        "von mir aus nicht",
        "yes, but then",
        "yes and so",
        "yes, and then",
    ] {
        assert!(
            !rules::Words::of(words).could_be_plain_decision(VoiceMeaning::Approve, &pieces),
            "{words}"
        );
    }
}

/// Card-correctness review 2026-11-18, B1: the refusal guard passes only a
/// clear no, whatever the model says.
#[tokio::test]
async fn only_a_clear_no_is_a_refusal() {
    let set = sentence_set();
    let (asked, en) = (set.cards["de-asked"].clone(), set.cards["en-asked"].clone());
    let says_reject = |words: &'static str, card: Card| async move {
        let model = ScriptedModel::answering(VoiceMeaning::Reject.wire_name(), None);
        let config = provider();
        classify(
            &VoiceCommandInput {
                transcript: words,
                language: "de",
                pieces: &card.pieces,
                current_piece_id: Some(&card.current_piece_id),
                question: None,
            },
            Some(VoiceModel {
                client: &model,
                config: &config,
                prompt: DEFAULT_PROMPT,
                timeout: Duration::from_millis(200),
            }),
        )
        .await
        .command
        .meaning
    };
    for words in [
        "lass es so",
        "lass das so",
        "nein, lass es so",
        "nein nein, lass es so",
        "aha ja, lass es so",
        "nein, mach das so",
        "nee, mach das so",
        "nein nein, mach das so",
        "nein, in Ordnung, mach",
        "nein, mach",
        "mach das nicht so",
        "nicht so",
        "nein, nicht so",
        "in Ordnung, mach das nicht so",
        "so nicht",
        "mach das so nicht",
        "genau so nicht",
        "lass, so",
    ] {
        assert_ne!(
            says_reject(words, asked.clone()).await,
            VoiceMeaning::Reject,
            "{words}"
        );
    }
    for words in [
        "not then",
        "no, not then",
        "not like that",
        "no, do it like that",
    ] {
        assert_ne!(
            says_reject(words, en.clone()).await,
            VoiceMeaning::Reject,
            "{words}"
        );
    }
    // Clear refusals stay refusals. An acknowledgement before a no ("in
    // Ordnung, nein") is not understood rather than taken as a no.
    for words in [
        "nein",
        "dann nicht",
        "nein, dann nicht",
        "nein, lass es",
        "mach das nicht",
        "nicht machen",
    ] {
        assert_eq!(
            says_reject(words, asked.clone()).await,
            VoiceMeaning::Reject,
            "{words}"
        );
    }
    for words in ["no", "don't do it", "no thanks"] {
        assert_eq!(
            says_reject(words, en.clone()).await,
            VoiceMeaning::Reject,
            "{words}"
        );
    }
}

#[test]
fn not_like_that_asks_for_a_change() {
    let set = sentence_set();
    let card = &set.cards["de-asked"];
    for words in ["nicht so", "so nicht", "mach das so nicht", "not like that"] {
        let found = classify_by_rules(&VoiceCommandInput {
            transcript: words,
            language: "de",
            pieces: &card.pieces,
            current_piece_id: Some(&card.current_piece_id),
            question: None,
        })
        .map(|classified| classified.command.meaning);
        assert!(
            matches!(found, None | Some(VoiceMeaning::Change)),
            "{words}: {found:?}"
        );
    }
}

/// Card-correctness re-check N1: on its own "nicht so" asks for a change;
/// in a question or a remark to the voice the model decides, in both
/// languages alike.
#[test]
fn not_like_that_is_a_change_only_on_its_own() {
    let set = sentence_set();
    let rules = |words: &str, card: &str| {
        let card = &set.cards[card];
        classify_by_rules(&VoiceCommandInput {
            transcript: words,
            language: "de",
            pieces: &card.pieces,
            current_piece_id: Some(&card.current_piece_id),
            question: None,
        })
        .map(|classified| classified.command.meaning)
    };
    for (words, card) in [
        ("nicht so", "de-asked"),
        ("nicht so.", "de-asked"),
        ("so nicht", "de-asked"),
        ("nein, nicht so", "de-asked"),
        ("also so nicht", "de-asked"),
        ("mach das nicht so", "de-asked"),
        ("nicht so machen", "de-asked"),
        ("not like that", "en-asked"),
        ("no, not like that", "en-asked"),
    ] {
        assert_eq!(rules(words, card), Some(VoiceMeaning::Change), "{words}");
    }
    for (words, card) in [
        ("nicht so schnell", "de-asked"),
        ("nicht so laut", "de"),
        ("ist das nicht so?", "de-asked"),
        ("warum nicht so", "de-asked"),
        ("ja, ist nicht so schlimm, mach", "de-asked"),
        ("passt schon, nicht so wichtig", "de-asked"),
        ("das ist nicht so wichtig", "de"),
        ("it's not like that", "en-asked"),
        ("is it not like that?", "en-asked"),
        ("not so fast", "en-asked"),
        ("not so loud", "en"),
    ] {
        assert_ne!(rules(words, card), Some(VoiceMeaning::Change), "{words}");
    }
}

#[test]
fn refusals_are_refusals_only_by_their_no() {
    let (pieces, _) = card();
    for words in ["ich will das", "ausführen", "will ich"] {
        assert!(
            !rules::Words::of(words).could_be_plain_decision(VoiceMeaning::Reject, &pieces),
            "{words}"
        );
    }
}

#[tokio::test]
async fn a_yes_before_the_card_asked_is_noise_whichever_stage_heard_it() {
    let set = sentence_set();
    let card = |name: &str| set.cards[name].clone();
    let (de, asked, en) = (card("de"), card("de-asked"), card("en-asked"));
    let answer = |words: &'static str, card: Card, meaning: VoiceMeaning| async move {
        let model = ScriptedModel::answering(meaning.wire_name(), None);
        let config = provider();
        classify(
            &VoiceCommandInput {
                transcript: words,
                language: "de",
                pieces: &card.pieces,
                current_piece_id: Some(&card.current_piece_id),
                question: None,
            },
            Some(VoiceModel {
                client: &model,
                config: &config,
                prompt: DEFAULT_PROMPT,
                timeout: Duration::from_millis(200),
            }),
        )
        .await
        .command
        .meaning
    };

    // Agreements that end in "so" or "then" are understood.
    for words in [
        "Ja passt, mach das so.",
        "das passt so",
        "ja, mach das bitte so",
    ] {
        assert_eq!(
            answer(words, asked.clone(), VoiceMeaning::Approve).await,
            VoiceMeaning::Approve,
            "{words}"
        );
        assert_eq!(
            answer(words, de.clone(), VoiceMeaning::Approve).await,
            VoiceMeaning::Noise,
            "{words}"
        );
    }
    assert_eq!(
        answer("go ahead then", en.clone(), VoiceMeaning::Approve).await,
        VoiceMeaning::Approve
    );
    assert_eq!(
        answer("use record 43 instead", en, VoiceMeaning::Change).await,
        VoiceMeaning::Change
    );
    // Before the card asked, only a clear yes or no is listening; anything
    // else the guards refuse gets an answer.
    assert_eq!(
        answer("ja", de.clone(), VoiceMeaning::Approve).await,
        VoiceMeaning::Noise
    );
    for (words, meaning) in [
        ("na gut, meinetwegen", VoiceMeaning::Approve),
        ("das reicht jetzt", VoiceMeaning::Approve),
        ("nein, das Datum", VoiceMeaning::Reject),
        ("wie spät ist es?", VoiceMeaning::Approve),
        ("Anna soll nicht dabei sein", VoiceMeaning::Reject),
    ] {
        assert_eq!(
            answer(words, de.clone(), meaning).await,
            VoiceMeaning::Unclear,
            "{words}"
        );
    }
    // An unfinished yes is never a yes. After the card asked it is not
    // understood; before, it is listening, unless it may ask for something.
    for words in [
        "ja, aber dann …",
        "ja, aber dann",
        "ja, und dann",
        "yes, but then …",
    ] {
        assert_eq!(
            answer(words, asked.clone(), VoiceMeaning::Approve).await,
            VoiceMeaning::Unclear,
            "{words}"
        );
    }
    for (words, before) in [
        ("ja, aber dann …", VoiceMeaning::Unclear),
        ("ja, aber dann", VoiceMeaning::Unclear),
        ("ja, und dann", VoiceMeaning::Unclear),
    ] {
        assert_eq!(
            answer(words, de.clone(), VoiceMeaning::Approve).await,
            before,
            "{words}"
        );
    }
}

#[test]
fn the_model_sees_roles_fields_and_words_and_answers_from_closed_lists() {
    let mut pieces = card().0;
    pieces[2].field = Some("Close\u{202e}date\n".into());
    let input = VoiceCommandInput {
        transcript: "  wie war das Datum?  ",
        language: "de",
        pieces: &pieces,
        current_piece_id: Some("p6"),
        question: None,
    };
    let request = model::build_request(DEFAULT_PROMPT, &input);
    let text = request
        .messages
        .last()
        .and_then(|message| message.content.first_text())
        .unwrap()
        .to_string();
    assert!(
        text.contains(r#"- "p3" detail, field "Closedate", heard"#),
        "{text}"
    );
    assert!(
        text.contains(r#"- "p6" text, field "Beschreibung", cut short, being spoken now"#),
        "{text}"
    );
    assert!(
        text.ends_with(r#"USER SAID: "wie war das Datum?""#),
        "{text}"
    );
    let schema = model::output_schema(&input);
    assert_eq!(
        schema["properties"]["piece_id"]["anyOf"][0]["enum"],
        serde_json::json!(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"])
    );
    assert_eq!(
        schema["properties"]["meaning"]["enum"]
            .as_array()
            .unwrap()
            .len(),
        VoiceMeaning::ALL.len()
    );
}

#[tokio::test]
async fn kinds_that_take_a_reply_schema_get_one() {
    let model = ScriptedModel::answering("rest", None);
    ask(&model, FREE_PLAIN).await;
    let (_, options) = model.request.lock().unwrap().clone().unwrap();
    assert!(options.response_format.is_some());
}

fn checked(
    transcript: &str,
    pieces: &[CardPiece],
    current: Option<&str>,
) -> Result<(), InputProblem> {
    check_input(&VoiceCommandInput {
        transcript,
        language: "de",
        pieces,
        current_piece_id: current,
        question: None,
    })
}

#[test]
fn requests_keep_their_limits() {
    let (pieces, _) = card();
    assert_eq!(checked("weiter", &pieces, Some("p6")), Ok(()));
    assert_eq!(checked("   ", &pieces, None), Err(InputProblem::Invalid));
    assert_eq!(
        checked("weiter", &pieces, Some("p42")),
        Err(InputProblem::Invalid)
    );
    assert_eq!(
        checked(&"weiter ".repeat(50), &pieces, None),
        Err(InputProblem::TooLarge)
    );
    let mut twice = pieces.clone();
    twice[1].id = "p1".into();
    assert_eq!(checked("weiter", &twice, None), Err(InputProblem::Invalid));
    let mut long_field = pieces.clone();
    long_field[2].field = Some("x".repeat(MAX_FIELD_CHARS + 1));
    assert_eq!(
        checked("weiter", &long_field, None),
        Err(InputProblem::TooLarge)
    );
    let many: Vec<CardPiece> = (0..=MAX_PIECES)
        .map(|index| CardPiece {
            id: format!("p{index}"),
            role: CardPieceRole::Detail,
            field: None,
            state: CardPieceState::NotSaid,
            must_say: false,
        })
        .collect();
    assert_eq!(checked("weiter", &many, None), Err(InputProblem::TooLarge));
}

/// ERMAIN-1241: with several texts on a card the voice asks which one;
/// naming a text's field answers it, and a read without a name stays open.
#[test]
fn naming_a_text_answers_which_text() {
    let pieces = vec![
        CardPiece {
            id: "what".into(),
            role: CardPieceRole::What,
            field: None,
            state: CardPieceState::Heard,
            must_say: false,
        },
        CardPiece {
            id: "text:summary".into(),
            role: CardPieceRole::Text,
            field: Some("Zusammenfassung".into()),
            state: CardPieceState::Heard,
            must_say: false,
        },
        CardPiece {
            id: "text:need".into(),
            role: CardPieceRole::Text,
            field: Some("Kundenbedarf".into()),
            state: CardPieceState::Heard,
            must_say: false,
        },
        CardPiece {
            id: "request".into(),
            role: CardPieceRole::Request,
            field: None,
            state: CardPieceState::Heard,
            must_say: false,
        },
    ];
    let rules = |words: &str, language: &str, question: Option<VoiceQuestion>| {
        classify_by_rules(&VoiceCommandInput {
            transcript: words,
            language,
            pieces: &pieces,
            current_piece_id: Some("request"),
            question,
        })
        .map(|classified| (classified.command.meaning, classified.command.piece_id))
    };
    let asked = Some(VoiceQuestion::WhichText);
    let read = |id: &str| Some((VoiceMeaning::ReadText, Some(id.to_string())));
    for (words, language, id) in [
        ("die Zusammenfassung", "de", "text:summary"),
        ("Zusammenfassung.", "de", "text:summary"),
        ("den Kundenbedarf bitte", "de", "text:need"),
        ("lies die Zusammenfassung vor", "de", "text:summary"),
        ("the Kundenbedarf", "en", "text:need"),
    ] {
        assert_eq!(rules(words, language, asked), read(id), "{words}");
    }
    // Already named before any question.
    assert_eq!(
        rules("lies die Zusammenfassung vor", "de", None),
        read("text:summary")
    );
    // Not named: no text is picked, so the voice can ask.
    assert_eq!(
        rules("lies den Text vor", "de", None),
        Some((VoiceMeaning::ReadText, None))
    );
    // A field named without the question is not taken as a read by the rules.
    assert_ne!(
        rules("die Zusammenfassung", "de", None),
        read("text:summary")
    );
    // "Nicht die Zusammenfassung" answers nothing.
    assert_ne!(
        rules("nicht die Zusammenfassung", "de", asked),
        read("text:summary")
    );
}

#[test]
fn the_model_hears_that_the_voice_asked_which_text() {
    let pieces = vec![CardPiece {
        id: "text:summary".into(),
        role: CardPieceRole::Text,
        field: Some("Summary".into()),
        state: CardPieceState::Heard,
        must_say: false,
    }];
    let input = |question| VoiceCommandInput {
        transcript: "the first one",
        language: "en",
        pieces: &pieces,
        current_piece_id: None,
        question,
    };
    let said = |question| {
        let request = model::build_request(DEFAULT_PROMPT, &input(question));
        format!(
            "{:?}",
            request.messages.last().map(|message| &message.content)
        )
    };
    assert!(said(Some(VoiceQuestion::WhichText)).contains("THE VOICE JUST ASKED"));
    assert!(!said(None).contains("THE VOICE JUST ASKED"));
}

mod deciding_by_voice {
    use super::super::decision::*;
    use super::super::phrase::*;
    use super::*;
    use crate::models::message::{
        ApprovalItem, ToolApprovalKind, ToolCallAction, ToolCallLabel, ToolDisplayMetadata,
        VoiceDecisionOutcome,
    };
    use serde_json::json;
    use uuid::Uuid;

    fn approves(words: &str) -> bool {
        match_phrase(words, &[]).is_some()
    }

    #[test]
    fn the_phrase_alone_or_with_its_listed_words_approves() {
        for words in [
            "Ich bestätige.",
            "ich bestätige",
            "Ich bestaetige!",
            "Ja, ich bestätige.",
            "Ich bestätige das.",
            "Ich bestätige, bitte.",
            "Äh, ich bestätige.",
            "I confirm.",
            "I confirm this.",
            "Yes, I confirm.",
            "I confirm, please.",
        ] {
            assert!(approves(words), "{words}");
        }
        assert_eq!(
            match_phrase("Ich bestätige.", &[]).unwrap().kind,
            PhraseMatchKind::Exact
        );
        assert_eq!(
            match_phrase("Ja, ich bestätige das", &[]).unwrap().kind,
            PhraseMatchKind::Variant
        );
        assert_eq!(
            match_phrase("I confirm this", &[]).unwrap().phrase.id,
            "en.i_confirm"
        );
    }

    #[test]
    fn near_misses_never_approve() {
        for words in [
            "ja",
            "Ja.",
            "ja, mach das",
            "Mach das.",
            "okay",
            "yes",
            "go ahead",
            "ich bestätige nicht",
            "Ich bestätige nicht.",
            "ich bestätige, aber morgen",
            "Ich bestätige das später.",
            "ich bestätige das nicht",
            "nein, ich bestätige",
            "ich bestätige?",
            "Bestätige.",
            "bestätigen",
            "ich bestätige es",
            "ja ja ich bestätige",
            "ich bestätige das bitte",
            "bitte ich bestätige",
            "I don't confirm",
            "I do not confirm.",
            "I confirm, but only tomorrow",
            "I confirm it",
            "confirm",
            "I can confirm",
            "Zum Ausführen bitte „Ich bestätige“ sagen.",
            "To go ahead, say: I confirm.",
            "Say I confirm to go ahead.",
            "Bitte noch einmal Ich bestätige sagen.",
            "„Ich bestätige“",
            "\"I confirm\"",
            "Ich bestätige？",
            "¿I confirm?",
            "Ich bestätige‽",
        ] {
            assert!(!approves(words), "{words}");
        }
    }

    #[test]
    fn no_sentence_of_either_set_says_the_phrase() {
        let mut checked = 0;
        for set in [sentence_set(), heldout_set()] {
            for sentence in &set.sentences {
                assert!(!approves(&sentence.text), "{}", sentence.id);
                checked += 1;
            }
        }
        assert!(checked > 600, "{checked}");
    }

    #[test]
    fn a_hesitation_word_never_hides_a_negation_condition_or_question() {
        let deployment = ["ne".to_string(), "nicht".to_string(), "aber".to_string()];
        for words in [
            "Ich bestätige, ne",
            "ich bestätige nicht",
            "aber ich bestätige",
            "Wie, ich bestätige",
        ] {
            assert!(match_phrase(words, &deployment).is_none(), "{words}");
        }
    }

    #[test]
    fn a_transcript_marked_as_unfinished_never_matches() {
        for words in ["Ich bestätige…", "ich bestätige ...", "I confirm..."] {
            assert!(match_phrase(words, &[]).is_none(), "{words}");
        }
    }

    #[test]
    fn the_deployments_hesitation_words_are_trimmed_too() {
        assert!(match_phrase("Euh, ich bestätige", &["euh".to_string()]).is_some());
        assert!(match_phrase("Euh, ich bestätige", &[]).is_none());
        assert!(match_phrase("ich euh bestätige", &["euh".to_string()]).is_none());
    }

    #[test]
    fn the_phrase_needs_speech_for_its_syllables() {
        assert_eq!(syllables(phrase_for("de-DE").unwrap()), 5);
        assert_eq!(syllables(phrase_for("en").unwrap()), 3);
        assert!(phrase_for("fr").is_none());
    }

    fn signals() -> VoiceSignals {
        VoiceSignals {
            voice_stopped_at_ms: 10_000,
            request_heard_at_ms: Some(9_000),
            recording_started_at_ms: 10_050,
            recording_ended_at_ms: 12_500,
            first_speech_at_ms: Some(10_600),
            speech_ms: 900,
            recorded_ms: 2_400,
            over_voice: false,
        }
    }

    #[test]
    fn only_a_recording_after_the_voice_with_enough_speech_decides() {
        let phrase = syllables(match_phrase("Ich bestätige", &[]).unwrap().phrase);
        let check =
            |signals: Option<VoiceSignals>| check_signals(&signals.unwrap(), phrase, 300, 80);
        assert_eq!(check(Some(signals())), Ok(()));
        // A refusal is one syllable: less speech is enough, the timing checks
        // are the same.
        let nein = VoiceSignals {
            speech_ms: 100,
            ..signals()
        };
        assert_eq!(check_signals(&nein, 1, 300, 80), Ok(()));
        assert_eq!(
            check_signals(
                &VoiceSignals {
                    speech_ms: 79,
                    ..nein
                },
                1,
                300,
                80
            ),
            Err(SignalProblem::TooLittleSpeech)
        );
        assert_eq!(
            check_signals(
                &VoiceSignals {
                    first_speech_at_ms: Some(10_100),
                    ..nein
                },
                1,
                300,
                80
            ),
            Err(SignalProblem::InEchoTail)
        );
        let over = VoiceSignals {
            over_voice: true,
            ..signals()
        };
        assert_eq!(check(Some(over)), Err(SignalProblem::OverVoice));
        let early = VoiceSignals {
            recording_started_at_ms: 9_900,
            ..signals()
        };
        assert_eq!(check(Some(early)), Err(SignalProblem::BeforeVoiceStopped));
        let echo = VoiceSignals {
            first_speech_at_ms: Some(10_200),
            ..signals()
        };
        assert_eq!(check(Some(echo)), Err(SignalProblem::InEchoTail));
        let short = VoiceSignals {
            speech_ms: 399,
            ..signals()
        };
        assert_eq!(check(Some(short)), Err(SignalProblem::TooLittleSpeech));
        let silent = VoiceSignals {
            first_speech_at_ms: None,
            ..signals()
        };
        assert_eq!(check(Some(silent)), Err(SignalProblem::TooLittleSpeech));
    }

    fn piece(id: &str, role: CardPieceRole, state: CardPieceState) -> CardPiece {
        CardPiece {
            id: id.to_string(),
            role,
            field: None,
            state,
            must_say: false,
        }
    }

    #[test]
    fn the_card_must_have_asked_with_nothing_owed() {
        use CardPieceRole::*;
        use CardPieceState::*;
        let heard = [
            piece("w", What, Heard),
            piece("c", Consequence, Heard),
            piece("r", Request, Heard),
        ];
        assert!(card_asked(&heard));
        let not_asked = [piece("w", What, Heard), piece("r", Request, CutShort)];
        assert!(!card_asked(&not_asked));
        let owed = [
            piece("w", What, Heard),
            piece("c", Consequence, NotSaid),
            piece("r", Request, Heard),
        ];
        assert!(!card_asked(&owed));
        assert!(super::super::request_heard(&owed) && only_points(&[piece("p", Pointer, Heard)]));
        let outside = [piece("o", Outside, CutShort), piece("r", Request, Heard)];
        assert!(!card_asked(&outside));
        assert!(!card_asked(&[piece("p", Pointer, Heard)]));
        assert!(!card_asked(&[piece("w", What, Heard)]));
        let loss = CardPiece {
            must_say: true,
            ..piece("d", Detail, CutShort)
        };
        assert!(!card_asked(&[loss, piece("r", Request, Heard)]));
        // What the call does and on which record is owed on every card, so a
        // device that skipped it cannot have the phrase count.
        assert!(!card_asked(&[
            piece("w", What, CutShort),
            piece("d", Detail, Heard),
            piece("r", Request, Heard)
        ]));
        assert!(!card_asked(&[
            piece("w", What, Heard),
            piece("i", Item, NotSaid),
            piece("r", Request, Heard)
        ]));
        // A detail skipped is not owed.
        assert!(card_asked(&[
            piece("d", Detail, NotSaid),
            piece("r", Request, Heard)
        ]));
    }

    fn label(action: ToolCallAction) -> ToolCallLabel {
        serde_json::from_value(json!({
            "action": serde_json::to_value(action).unwrap(),
            "object_kind": "task",
            "source": "rules",
        }))
        .unwrap()
    }

    fn item(approval_id: &str, label: Option<ToolCallLabel>) -> ApprovalItem {
        ApprovalItem {
            approval_id: approval_id.to_string(),
            tool_call_id: format!("call_{approval_id}"),
            tool_name: "update_task".to_string(),
            display: label.map(|label| ToolDisplayMetadata {
                label: Some(label),
                ..serde_json::from_value(
                    json!({"title": "Update task", "description_truncated": false}),
                )
                .unwrap()
            }),
            input: json!({"id": 7, "status": "done"}),
            child: None,
            replaces_approval_id: None,
        }
    }

    #[test]
    fn only_the_turns_single_own_call_is_decided_by_voice() {
        let one = [item("a1", Some(label(ToolCallAction::Update)))];
        assert!(!stop_is_screen_only(
            ToolApprovalKind::McpTool,
            &one,
            Some("a1")
        ));
        assert!(!stop_is_screen_only(
            ToolApprovalKind::ClientTool,
            &one,
            Some("a1")
        ));
        assert!(stop_is_screen_only(
            ToolApprovalKind::McpTool,
            &one,
            Some("a2")
        ));
        assert!(stop_is_screen_only(ToolApprovalKind::McpTool, &one, None));
        assert!(stop_is_screen_only(
            ToolApprovalKind::ToolCallLimit,
            &one,
            Some("a1")
        ));
        assert!(stop_is_screen_only(
            ToolApprovalKind::BuiltinTool,
            &one,
            Some("a1")
        ));
        let two = [one[0].clone(), item("a2", None)];
        assert!(stop_is_screen_only(
            ToolApprovalKind::McpTool,
            &two,
            Some("a1")
        ));
    }

    #[test]
    fn statements_warnings_big_batches_and_unlabelled_calls_are_approved_on_screen() {
        assert!(!approval_is_screen_only(&item(
            "a",
            Some(label(ToolCallAction::Update))
        )));
        assert!(!approval_is_screen_only(&item(
            "a",
            Some(label(ToolCallAction::Delete))
        )));
        assert!(approval_is_screen_only(&item("a", None)));
        assert!(approval_is_screen_only(&item(
            "a",
            Some(label(ToolCallAction::Run))
        )));
        assert!(approval_is_screen_only(&item(
            "a",
            Some(label(ToolCallAction::Other))
        )));
        let mut generic = label(ToolCallAction::Update);
        generic.source = crate::models::message::ToolCallLabelSource::Generic;
        assert!(label_is_screen_only(&generic));
        let mut omitted = label(ToolCallAction::Update);
        omitted.change = Some(crate::models::message::ToolCallChange {
            opaque_omitted: 1,
            ..Default::default()
        });
        assert!(label_is_screen_only(&omitted));
        let mut warned = label(ToolCallAction::Update);
        warned.warnings = serde_json::from_value(json!(["hidden_characters"])).unwrap();
        assert!(label_is_screen_only(&warned));
        let mut opaque = label(ToolCallAction::Update);
        opaque.change = Some(crate::models::message::ToolCallChange {
            opaque: vec![
                serde_json::from_value(json!({
                    "kind": "sql", "name": "Query", "raw_name": "query", "path": "query",
                    "text": "UPDATE t SET x = 1", "lines": 1,
                }))
                .unwrap(),
            ],
            ..Default::default()
        });
        assert!(label_is_screen_only(&opaque));
        let batch = |total: u32| -> ToolCallLabel {
            let mut batched = label(ToolCallAction::Delete);
            batched.change = Some(crate::models::message::ToolCallChange {
                batch: Some(
                    serde_json::from_value(json!({
                        "path": "ids", "name": "ids", "total": total,
                    }))
                    .unwrap(),
                ),
                ..Default::default()
            });
            batched
        };
        assert!(!label_is_screen_only(&batch(20)));
        assert!(label_is_screen_only(&batch(21)));
        let ids = |count: usize| -> ToolCallLabel {
            let mut many = label(ToolCallAction::Delete);
            many.items = vec![
                serde_json::from_value(json!({
                    "id": {
                        "pointer": "/ids/*",
                        "values": (0..count).map(|n| json!({"path": format!("/ids/{n}"), "text": format!("id-{n}"), "truncated": false})).collect::<Vec<_>>(),
                    },
                }))
                .unwrap(),
            ];
            many
        };
        assert!(!label_is_screen_only(&ids(20)));
        assert!(label_is_screen_only(&ids(21)));
    }

    fn receipt(item: &ApprovalItem, outcome: VoiceDecisionOutcome) -> TakenReceipt {
        let pieces = [piece("r", CardPieceRole::Request, CardPieceState::Heard)];
        TakenReceipt {
            receipt: VoiceReceipt {
                user_id: Uuid::from_u128(1),
                message_id: Uuid::nil(),
                approval_id: item.approval_id.clone(),
                card_digest: card_digest(item),
                outcome,
                record: record(RecordInput {
                    user_id: "user",
                    item,
                    language: "de",
                    pieces: &pieces,
                    required_phrase: Some("de.ich_bestaetige"),
                    matched_words: "ich bestaetige",
                    match_kind: Some(PhraseMatchKind::Exact),
                    signals: &signals(),
                    outcome,
                }),
            },
            expired: false,
        }
    }

    #[test]
    fn a_receipt_lets_through_only_its_own_decision_on_the_card_as_heard() {
        let user = Uuid::from_u128(1);
        let card = item("a1", Some(label(ToolCallAction::Update)));
        let approved = receipt(&card, VoiceDecisionOutcome::Approved);
        let check = |taken: Option<&TakenReceipt>, user: Uuid, item: &ApprovalItem, outcome| {
            check_receipt(taken, user, Uuid::nil(), item, outcome)
        };
        let approve = VoiceDecisionOutcome::Approved;
        assert_eq!(check(Some(&approved), user, &card, approve), Ok(()));
        assert_eq!(
            check(None, user, &card, approve),
            Err(ReceiptProblem::Unknown)
        );
        assert_eq!(
            check(Some(&approved), Uuid::from_u128(2), &card, approve),
            Err(ReceiptProblem::OtherCard)
        );
        let changed = ApprovalItem {
            input: json!({"id": 8, "status": "done"}),
            ..card.clone()
        };
        assert_eq!(
            check(Some(&approved), user, &changed, approve),
            Err(ReceiptProblem::OtherCard)
        );
        let refused = receipt(&card, VoiceDecisionOutcome::Refused);
        assert_eq!(
            check(Some(&refused), user, &card, approve),
            Err(ReceiptProblem::OtherDecision)
        );
        let old = TakenReceipt {
            expired: true,
            ..approved.clone()
        };
        assert_eq!(
            check(Some(&old), user, &card, approve),
            Err(ReceiptProblem::Expired)
        );
        assert_eq!(
            check_receipt(Some(&approved), user, Uuid::new_v4(), &card, approve),
            Err(ReceiptProblem::OtherCard)
        );
    }

    #[test]
    fn the_record_keeps_the_signals_for_a_later_decision_model() {
        let card = item("a1", Some(label(ToolCallAction::Update)));
        let kept = receipt(&card, VoiceDecisionOutcome::Approved)
            .receipt
            .record;
        assert_eq!(kept.speech_ms, 900);
        assert_eq!(kept.speech_frames_permille, 375);
        assert_eq!(kept.answer_latency_ms, Some(1_600));
        assert_eq!(kept.card_digest, card_digest(&card));
        assert_eq!(kept.pieces[0].role, CardPieceRole::Request);
        assert_eq!(kept.pieces[0].state, CardPieceState::Heard);
        assert_eq!(kept.required_phrase.as_deref(), Some("de.ich_bestaetige"));
        assert!(kept.voice_stopped_at.starts_with("1970-01-01T00:00:10"));
    }
}

/// The web app decides from the same label whether a card names the phrase
/// (`voiceApprovable` in spokenCard.ts); both check this table, made from the
/// labelled call set the spoken cards are written against.
///
/// Regenerate with `VOICE_APPROVAL_TABLE_WRITE=1 cargo nextest run -p erato voice_approval_table`.
#[test]
fn voice_approval_table_matches_the_labelled_call_set() {
    use crate::models::message::ToolCallLabel;
    const CALLS: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/lib/toolCallGist/fixtures/spokenCards/calls.json"
    ));
    const TABLE_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/lib/toolCallGist/fixtures/spokenCards/voiceApprovals.json"
    );
    let calls: serde_json::Value = serde_json::from_str(CALLS).unwrap();
    let table: BTreeMap<String, bool> = calls["calls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|call| {
            let label: Option<ToolCallLabel> =
                serde_json::from_value(call["display"]["label"].clone()).ok();
            let approvable = label.is_some_and(|label| !decision::label_is_screen_only(&label));
            (call["id"].as_str().unwrap().to_string(), approvable)
        })
        .collect();
    let written = serde_json::to_string_pretty(&table).unwrap() + "\n";
    if std::env::var_os("VOICE_APPROVAL_TABLE_WRITE").is_some() {
        std::fs::write(TABLE_PATH, &written).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(TABLE_PATH).unwrap_or_default(),
        written,
        "regenerate with VOICE_APPROVAL_TABLE_WRITE=1"
    );
}
