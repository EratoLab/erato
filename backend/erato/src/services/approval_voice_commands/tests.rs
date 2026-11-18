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
        })
        .collect();
    assert_eq!(checked("weiter", &many, None), Err(InputProblem::TooLarge));
}
