use super::*;
use crate::services::genai::GenAIChatStreamResponse;
use async_trait::async_trait;
use genai::chat::{ChatOptions, ChatRequest, ChatResponse, MessageContent};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

/// The requests the app sends for the scenario set: per scenario, per
/// language, one list of pieces per card. Written by the frontend's
/// `SPOKEN_CARD_EXPECT_WRITE=1 pnpm vitest run spokenCard`.
const REWORDING_SET: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../frontend/src/lib/toolCallGist/fixtures/spokenCards/rewording.json"
));

pub(super) struct Card {
    pub scenario: String,
    pub language: String,
    pub pieces: Vec<RewordPiece>,
}

pub(super) fn card_set() -> Vec<Card> {
    let set: BTreeMap<String, BTreeMap<String, Vec<Vec<RewordPiece>>>> =
        serde_json::from_str(REWORDING_SET).unwrap();
    set.into_iter()
        .flat_map(|(scenario, languages)| {
            languages.into_iter().flat_map(move |(language, cards)| {
                let scenario = scenario.clone();
                cards.into_iter().map(move |pieces| Card {
                    scenario: scenario.clone(),
                    language: language.clone(),
                    pieces,
                })
            })
        })
        .collect()
}

fn input(card: &Card) -> RewordInput<'_> {
    RewordInput {
        language: &card.language,
        pieces: &card.pieces,
    }
}

fn allowed(language: &str) -> BTreeSet<String> {
    check::allowed_words(language, &[])
}

fn wordings(
    card: &Card,
    word: impl Fn(&RewordPiece) -> Option<String>,
) -> BTreeMap<String, String> {
    card.pieces
        .iter()
        .filter_map(|piece| Some((piece.id.clone(), word(piece)?)))
        .collect()
}

/// Ids, roles' order and count are the card's; a consequence and a request
/// are the precise sentences byte for byte.
fn assert_shape(card: &Card, outcome: &Outcome) {
    let where_ = format!("{} {}", card.scenario, card.language);
    let ids = |pieces: &[RewordedPiece]| {
        pieces
            .iter()
            .map(|piece| piece.id.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        ids(&outcome.reworded.pieces),
        card.pieces
            .iter()
            .map(|piece| piece.id.clone())
            .collect::<Vec<_>>(),
        "{where_}"
    );
    for (piece, said) in card.pieces.iter().zip(&outcome.reworded.pieces) {
        if !rewordable(piece.role) {
            assert_eq!(said.text, piece.text, "{where_} {}", piece.id);
            assert!(!said.natural, "{where_} {}", piece.id);
        }
    }
}

#[test]
fn the_set_covers_both_languages_and_every_rewordable_role() {
    let cards = card_set();
    assert!(cards.len() >= 100, "{}", cards.len());
    for language in ["de", "en"] {
        assert!(cards.iter().any(|card| card.language == language));
    }
    for card in &cards {
        check_input(&input(card))
            .unwrap_or_else(|problem| panic!("{} {}: {problem:?}", card.scenario, card.language));
    }
}

/// The facts the app sends are words the precise piece says, so the precise
/// piece passes its own check: every rewordable piece of every card.
#[test]
fn every_precise_piece_passes_its_own_check() {
    for card in card_set() {
        let outcome = apply(
            &input(&card),
            wordings(&card, |piece| Some(piece.text.clone())),
            &allowed(&card.language),
        );
        assert_shape(&card, &outcome);
        assert!(
            outcome.rejected.is_empty(),
            "{} {}: {:?}",
            card.scenario,
            card.language,
            outcome.rejected
        );
    }
}

/// Whatever the model answers, also for the consequence and the request,
/// the card keeps its ids and count and those two pieces stay precise.
#[test]
fn any_answer_keeps_ids_and_the_precise_consequence_and_request() {
    for card in card_set() {
        type Answer = Box<dyn Fn(&RewordPiece) -> Option<String>>;
        let answers: [Answer; 4] = [
            Box::new(|_| Some("Etwas ganz anderes.".into())),
            Box::new(|piece| Some(piece.text.to_uppercase())),
            Box::new(|piece| Some(format!("{} {}", piece.text, piece.text))),
            Box::new(|_| None),
        ];
        for answer in &answers {
            let outcome = apply(
                &input(&card),
                wordings(&card, answer),
                &allowed(&card.language),
            );
            assert_shape(&card, &outcome);
        }
    }
}

/// Generated from the set: a wording that drops, alters or adds a fact, or
/// drops or adds a negation, is rejected for every piece that has one.
#[test]
fn generated_unfaithful_wordings_are_rejected() {
    let mut tried = 0;
    for card in card_set() {
        let allowed = allowed(&card.language);
        let negation = if card.language == "de" {
            "nicht"
        } else {
            "not"
        };
        for piece in card.pieces.iter().filter(|piece| rewordable(piece.role)) {
            let mut wrong: Vec<(&str, String)> = Vec::new();
            for fact in &piece.facts {
                let fact_words = check::tokens(fact);
                if fact_words.is_empty() {
                    continue;
                }
                // Dropped: unless the piece says the same words twice.
                if piece.text.matches(fact.as_str()).count() == 1 {
                    wrong.push(("dropped", piece.text.replacen(fact.as_str(), "", 1)));
                }
                // Altered: every digit moved by one.
                if piece.text.contains(fact.as_str()) && fact.chars().any(|c| c.is_ascii_digit()) {
                    let altered: String = fact
                        .chars()
                        .map(|c| {
                            c.to_digit(10)
                                .map_or(c, |d| char::from_digit((d + 1) % 10, 10).unwrap())
                        })
                        .collect();
                    if !check::tokens(&piece.text)
                        .join(" ")
                        .contains(&check::tokens(&altered).join(" "))
                    {
                        wrong.push(("altered", piece.text.replacen(fact.as_str(), &altered, 1)));
                    }
                }
            }
            // Added: a name, a number and a negation the piece does not have.
            let said = check::tokens(&piece.text);
            if !said.iter().any(|word| word == "zacharias") {
                wrong.push(("added name", format!("{} Zacharias", piece.text)));
            }
            if !said.iter().any(|word| word == "17") {
                wrong.push(("added number", format!("{} 17", piece.text)));
            }
            if !said.iter().any(|word| word == negation) {
                wrong.push(("added negation", format!("{} {negation}", piece.text)));
            } else {
                wrong.push((
                    "dropped negation",
                    piece.text.replacen(&format!(" {negation}"), "", 1),
                ));
            }
            for (how, wording) in wrong {
                tried += 1;
                let precise = check::Precise {
                    text: &piece.text,
                    facts: &piece.facts,
                };
                assert!(
                    check::check(&precise, &wording, &card.language, &allowed).is_err(),
                    "{} {} {}: {how}: {wording}",
                    card.scenario,
                    card.language,
                    piece.id
                );
            }
        }
    }
    assert!(tried > 500, "{tried}");
}

#[test]
fn input_bounds() {
    let piece = |id: &str, text: &str| RewordPiece {
        id: id.into(),
        role: CardPieceRole::Detail,
        text: text.into(),
        facts: vec![],
    };
    let check = |language: &str, pieces: Vec<RewordPiece>| {
        check_input(&RewordInput {
            language,
            pieces: &pieces,
        })
    };
    assert_eq!(check("de", vec![piece("a", "Text.")]), Ok(()));
    assert_eq!(check("de", vec![]), Err(InputProblem::Invalid));
    assert_eq!(
        check("Deutsch", vec![piece("a", "Text.")]),
        Err(InputProblem::Invalid)
    );
    assert_eq!(
        check("de", vec![piece("a", "Text."), piece("a", "Text.")]),
        Err(InputProblem::Invalid)
    );
    assert_eq!(
        check("de", vec![piece(" ", "Text.")]),
        Err(InputProblem::Invalid)
    );
    assert_eq!(
        check(
            "de",
            (0..17)
                .map(|index| piece(&index.to_string(), "Text."))
                .collect()
        ),
        Err(InputProblem::TooLarge)
    );
    assert_eq!(
        check("de", vec![piece("a", &"x".repeat(401))]),
        Err(InputProblem::TooLarge)
    );
    assert_eq!(
        check(
            "de",
            (0..6)
                .map(|index| piece(&index.to_string(), &"x".repeat(390)))
                .collect()
        ),
        Err(InputProblem::TooLarge)
    );
    let mut many_facts = piece("a", "Text.");
    many_facts.facts = vec!["Text".into(); MAX_FACTS + 1];
    assert_eq!(check("de", vec![many_facts]), Err(InputProblem::TooLarge));
    let mut long_fact = piece("a", "Text.");
    long_fact.facts = vec!["x".repeat(MAX_FACT_CHARS + 1)];
    assert_eq!(check("de", vec![long_fact]), Err(InputProblem::TooLarge));
}

enum Script {
    Reply(String),
    Fail,
    Sleep(Duration),
}

struct ScriptedModel {
    script: Script,
    calls: AtomicUsize,
    request: Mutex<Option<ChatRequest>>,
}

impl ScriptedModel {
    fn new(script: Script) -> Self {
        Self {
            script,
            calls: AtomicUsize::new(0),
            request: Mutex::new(None),
        }
    }
}

#[async_trait]
impl GenAIClient for ScriptedModel {
    async fn exec_chat(
        &self,
        _model: &str,
        request: ChatRequest,
        _options: Option<&ChatOptions>,
    ) -> genai::Result<ChatResponse> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.request.lock().unwrap() = Some(request);
        let text = match &self.script {
            Script::Reply(text) => text.clone(),
            Script::Fail => return Err(genai::Error::Internal("forced failure".into())),
            Script::Sleep(duration) => {
                tokio::time::sleep(*duration).await;
                r#"{"pieces":[]}"#.into()
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
        panic!("rewording uses the non-streaming chat API")
    }
}

fn provider() -> ChatProviderConfig {
    ChatProviderConfig {
        provider_kind: "openai".into(),
        model_name: "test-model".into(),
        ..Default::default()
    }
}

fn update_card() -> Card {
    card_set()
        .into_iter()
        .find(|card| card.scenario == "delete-01-task-created-earlier" && card.language == "de")
        .expect("the set has delete-01-task-created-earlier")
}

async fn run(card: &Card, client: &ScriptedModel, timeout: Duration) -> Outcome {
    let config = provider();
    let allowed = allowed(&card.language);
    let model = RewordModel {
        client,
        config: &config,
        prompt: DEFAULT_PROMPT,
        allowed: &allowed,
        timeout,
    };
    reword(&input(card), &model).await
}

#[tokio::test]
async fn a_slow_failing_or_unreadable_model_leaves_the_card_precise() {
    let card = update_card();
    let precise = precise(&input(&card), "");
    for (script, outcome) in [
        (Script::Sleep(Duration::from_millis(200)), "timeout"),
        (Script::Fail, "provider_error"),
        (Script::Reply("not json".into()), "invalid_reply"),
        (
            Script::Reply(
                r#"{"pieces":[{"id":"what","text":"a"},{"id":"what","text":"b"}]}"#.into(),
            ),
            "invalid_reply",
        ),
        (
            Script::Reply(format!(
                r#"{{"pieces":[{{"id":"what","text":"{}"}}]}}"#,
                "x".repeat(model::MAX_REPLY_BYTES)
            )),
            "invalid_reply",
        ),
    ] {
        let client = ScriptedModel::new(script);
        let got = run(&card, &client, Duration::from_millis(50)).await;
        assert_eq!(got.outcome, outcome);
        assert_eq!(got.reworded, precise.reworded);
        assert_eq!(client.calls.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn a_checked_wording_replaces_only_its_piece() {
    let card = update_card();
    let what = card
        .pieces
        .iter()
        .find(|piece| piece.role == CardPieceRole::What)
        .unwrap();
    let consequence = card
        .pieces
        .iter()
        .find(|piece| piece.role == CardPieceRole::Consequence)
        .expect("a delete says its consequence");
    let reply = serde_json::json!({"pieces": [
        {"id": what.id, "text": what.text.replace("Ich möchte", "Ich würde gern")},
        {"id": consequence.id, "text": "Das ist kein Problem."},
    ]});
    let client = ScriptedModel::new(Script::Reply(reply.to_string()));
    let got = run(&card, &client, Duration::from_secs(1)).await;
    assert_shape(&card, &got);
    let said = |id: &str| {
        got.reworded
            .pieces
            .iter()
            .find(|piece| piece.id == id)
            .unwrap()
    };
    assert!(said(&what.id).natural, "{:?}", got.rejected);
    assert!(said(&what.id).text.starts_with("Ich würde gern"));
    assert_eq!(said(&consequence.id).text, consequence.text);

    // The model saw only the pieces it may reword.
    let request = client.request.lock().unwrap().take().unwrap();
    let shown = format!("{:?}", request.messages);
    assert!(!shown.contains(&consequence.text));
    assert!(shown.contains(&what.text));
}

#[tokio::test]
async fn a_card_with_nothing_to_reword_asks_no_model() {
    let card = Card {
        scenario: "pointer".into(),
        language: "de".into(),
        pieces: vec![RewordPiece {
            id: "pointer".into(),
            role: CardPieceRole::Pointer,
            text: "Auf dem Bildschirm wartet eine Entscheidung.".into(),
            facts: vec![],
        }],
    };
    let client = ScriptedModel::new(Script::Fail);
    let got = run(&card, &client, Duration::from_secs(1)).await;
    assert_eq!(got.outcome, "nothing_to_reword");
    assert_eq!(client.calls.load(Ordering::SeqCst), 0);
}
