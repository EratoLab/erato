//! Asking a waiting card for one field again: the visit report
//! create card from MS staging on 2026-11-23, five fields on screen and four
//! behind "more", read with three details and "six more fields".

use super::tests::{ScriptedModel, field_question_set, provider};
use super::*;

fn piece(id: &str, role: CardPieceRole, field: Option<&str>, state: CardPieceState) -> CardPiece {
    CardPiece {
        id: id.into(),
        role,
        field: field.map(str::to_string),
        state,
        must_say: matches!(
            role,
            CardPieceRole::What | CardPieceRole::Item | CardPieceRole::Consequence
        ),
        names: Vec::new(),
        on_request: false,
    }
}

fn asked(id: &str, field: &str, names: &[&str]) -> CardPiece {
    CardPiece {
        names: names.iter().map(|name| name.to_string()).collect(),
        on_request: true,
        ..piece(
            id,
            CardPieceRole::Detail,
            Some(field),
            CardPieceState::NotSaid,
        )
    }
}

/// The card as the web app sends it once it was read to its request. The
/// lab's fields have no vocabulary on staging: `names` stays empty there.
fn visit_report(names: bool) -> Vec<CardPiece> {
    use CardPieceRole::*;
    use CardPieceState::*;
    let n = |list: &'static [&'static str]| if names { list } else { &[] };
    vec![
        piece("what", What, None, Heard),
        piece("item", Item, None, Heard),
        piece("detail:Opportunity", Detail, Some("Opportunity"), Heard),
        piece("detail:Account", Detail, Some("Account"), Heard),
        piece("detail:Visitedon", Detail, Some("Visitedon"), Heard),
        piece("more", More, None, Heard),
        piece("consequence", Consequence, None, Heard),
        piece("request", Request, None, Heard),
        asked("detail:Summary", "Summary", n(&["Zusammenfassung"])),
        asked("detail:Customerneed", "Customerneed", n(&["Kundenbedarf"])),
        asked(
            "detail:Competitionnotes",
            "Competitionnotes",
            n(&["Wettbewerb"]),
        ),
        asked("detail:Nextsteps", "Nextsteps", n(&["Nächste Schritte"])),
        asked("detail:Followupdate", "Followupdate", n(&["Nachfassdatum"])),
        asked("detail:Site ID", "Site ID", n(&["Standort"])),
    ]
}

fn update_card() -> Vec<CardPiece> {
    use CardPieceRole::*;
    use CardPieceState::*;
    vec![
        piece("what", What, None, Heard),
        CardPiece {
            names: vec!["Budget amount".into()],
            ..piece("detail:Budget amount", Detail, Some("Budget"), Heard)
        },
        piece(
            "detail:Erato customerdecisiondate",
            Detail,
            Some("Erato customerdecisiondate"),
            Heard,
        ),
        piece("request", Request, None, Heard),
    ]
}

fn rules_on(
    pieces: &[CardPiece],
    words: &str,
    language: &str,
    question: Option<VoiceQuestion>,
) -> Option<VoiceCommand> {
    let input = VoiceCommandInput {
        transcript: words,
        language,
        pieces,
        current_piece_id: None,
        question,
    };
    assert!(check_input(&input).is_ok(), "{words}");
    classify_by_rules(&input, CommandWords::base()).map(|found| found.command)
}

fn repeat_of(command: &Option<VoiceCommand>) -> Option<&str> {
    command
        .as_ref()
        .filter(|command| command.meaning == VoiceMeaning::Repeat)
        .and_then(|command| command.piece_id.as_deref())
}

#[test]
fn a_field_behind_more_is_said_again_when_named() {
    let card = visit_report(false);
    for (words, language, field) in [
        ("what was the summary again?", "en", "detail:Summary"),
        ("What's the summary?", "en", "detail:Summary"),
        ("tell me the summary once more", "en", "detail:Summary"),
        ("read me the summary", "en", "detail:Summary"),
        ("what was the customer need?", "en", "detail:Customerneed"),
        ("what are the next steps?", "en", "detail:Nextsteps"),
        (
            "what did you say about the follow up date?",
            "en",
            "detail:Followupdate",
        ),
        (
            "und die competition notes nochmal",
            "de",
            "detail:Competitionnotes",
        ),
        ("was steht bei Next steps?", "de", "detail:Nextsteps"),
        ("Summary nochmal", "de", "detail:Summary"),
        ("ja, die Summary nochmal", "de", "detail:Summary"),
        ("wie war die Site ID?", "de", "detail:Site ID"),
        ("what was the account again?", "en", "detail:Account"),
    ] {
        assert_eq!(
            repeat_of(&rules_on(&card, words, language, None)),
            Some(field),
            "{words}"
        );
    }
}

#[test]
fn a_field_named_in_the_listeners_language_is_found_by_its_vocabulary_name() {
    let card = visit_report(true);
    for (words, field) in [
        ("was stand in der Zusammenfassung?", "detail:Summary"),
        ("die Zusammenfassung nochmal", "detail:Summary"),
        ("lies mir die Zusammenfassung vor", "detail:Summary"),
        ("was war der Kundenbedarf?", "detail:Customerneed"),
        ("die nächsten Schritte nochmal", "detail:Nextsteps"),
        ("was steht beim Standort?", "detail:Site ID"),
    ] {
        assert_eq!(
            repeat_of(&rules_on(&card, words, "de", None)),
            Some(field),
            "{words}"
        );
    }
    // Without the vocabulary the German name is the model's to match.
    let bare = visit_report(false);
    assert_eq!(
        rules_on(&bare, "was stand in der Zusammenfassung?", "de", None),
        None
    );
}

#[test]
fn words_that_fit_two_fields_ask_which_one() {
    let mut card = visit_report(true);
    card[4].names = vec!["Besuchsdatum".into()];
    let command = rules_on(&card, "das Datum nochmal", "de", None).expect("rules");
    assert_eq!(command.meaning, VoiceMeaning::Repeat);
    assert_eq!(command.piece_id, None);
    assert_eq!(
        command.candidates,
        vec!["detail:Visitedon".to_string(), "detail:Followupdate".into()]
    );
    // One more word that fits only one of them settles it.
    assert_eq!(
        repeat_of(&rules_on(&card, "das Nachfassdatum nochmal", "de", None)),
        Some("detail:Followupdate")
    );
    // The answer to "which field" names one.
    for words in ["Nachfassdatum", "das Nachfassdatum"] {
        assert_eq!(
            repeat_of(&rules_on(
                &card,
                words,
                "de",
                Some(VoiceQuestion::WhichField)
            )),
            Some("detail:Followupdate"),
            "{words}"
        );
    }
    assert_eq!(
        rules_on(&card, "das zweite", "de", Some(VoiceQuestion::WhichField)),
        None
    );
}

#[test]
fn words_about_a_value_or_a_field_the_card_lacks_are_left_to_the_model() {
    let card = visit_report(false);
    for (words, language) in [
        ("was war mit dem Budget?", "de"),
        ("what did you say about the decision date?", "en"),
        ("das zweite nochmal", "de"),
        ("was stand in der Zusammenfassung?", "de"),
    ] {
        assert_eq!(rules_on(&card, words, language, None), None, "{words}");
    }
}

#[test]
fn the_update_card_worked_because_its_fields_are_said() {
    let card = update_card();
    for (words, language, field) in [
        ("what was the budget again?", "en", "detail:Budget amount"),
        ("wie war das Budget?", "de", "detail:Budget amount"),
        ("what was the budget amount?", "en", "detail:Budget amount"),
        (
            "what was the decision date again?",
            "en",
            "detail:Erato customerdecisiondate",
        ),
    ] {
        assert_eq!(
            repeat_of(&rules_on(&card, words, language, None)),
            Some(field),
            "{words}"
        );
    }
}

#[test]
fn asking_for_a_field_never_decides_or_changes_the_card() {
    let card = visit_report(true);
    for (words, language) in [
        ("ja, die Zusammenfassung nochmal", "de"),
        ("yes, what was the summary?", "en"),
        ("okay, read me the next steps", "en"),
        ("ja ja, wie war der Kundenbedarf", "de"),
    ] {
        let command = rules_on(&card, words, language, None).expect("rules");
        assert_eq!(command.meaning, VoiceMeaning::Repeat, "{words}");
    }
    // The phrase with a field after it is not the phrase.
    for words in ["I confirm the summary", "ich bestätige die Zusammenfassung"] {
        assert!(
            phrase::match_phrase(words, CommandWords::base()).is_none(),
            "{words}"
        );
    }
    // A field and a value to set it to is a change, never a repeat.
    assert_eq!(
        rules_on(&card, "nimm als Nachfassdatum den 2. Oktober", "de", None)
            .map(|command| command.meaning),
        Some(VoiceMeaning::Change)
    );
}

#[tokio::test]
async fn the_model_sees_every_name_of_a_field_and_that_it_is_said_on_request() {
    let card = visit_report(true);
    let input = VoiceCommandInput {
        transcript: "was hast du zum Budget gesagt?",
        language: "de",
        pieces: &card,
        current_piece_id: None,
        question: None,
    };
    let text = format!(
        "{:?}",
        model::build_request(DEFAULT_PROMPT, &input).messages
    );
    assert!(
        text.contains(
            r#"\"detail:Summary\" detail, field \"Summary\" (also \"Zusammenfassung\"), not yet said, said only when asked"#
        ),
        "{text}"
    );
    let which = VoiceCommandInput {
        question: Some(VoiceQuestion::WhichField),
        ..input.clone()
    };
    assert!(
        format!(
            "{:?}",
            model::build_request(DEFAULT_PROMPT, &which).messages
        )
        .contains("which of several fields to say")
    );
}

#[tokio::test]
async fn every_answer_the_model_can_give_about_a_field_is_checked() {
    let card = visit_report(false);
    let config = provider();
    let ask = |words: &'static str, model: &'static ScriptedModel| {
        let card = &card;
        let config = &config;
        async move {
            let input = VoiceCommandInput {
                transcript: words,
                language: "de",
                pieces: card,
                current_piece_id: None,
                question: None,
            };
            classify_by_model(
                &input,
                CommandWords::base(),
                &VoiceModel {
                    client: model,
                    config,
                    prompt: DEFAULT_PROMPT,
                    timeout: Duration::from_millis(500),
                },
            )
            .await
            .command
        }
    };
    let repeat = Box::leak(Box::new(ScriptedModel::answering(
        "repeat",
        Some("detail:Summary"),
    )));
    let command = ask("was stand in der Zusammenfassung?", repeat).await;
    assert_eq!(
        (command.meaning, command.piece_id.as_deref()),
        (VoiceMeaning::Repeat, Some("detail:Summary"))
    );
    // A field that is no long text, read out, is that field said.
    let read = Box::leak(Box::new(ScriptedModel::answering(
        "read_text",
        Some("detail:Summary"),
    )));
    let command = ask("lies die Zusammenfassung vor", read).await;
    assert_eq!(
        (command.meaning, command.piece_id.as_deref()),
        (VoiceMeaning::Repeat, Some("detail:Summary"))
    );
    // Reading something that is not a field stays unclear.
    let what = Box::leak(Box::new(ScriptedModel::answering(
        "read_text",
        Some("what"),
    )));
    assert_eq!(
        ask("lies das vor", what).await.meaning,
        VoiceMeaning::Unclear
    );
    // A piece the card does not have.
    let wrong = Box::leak(Box::new(ScriptedModel::answering(
        "repeat",
        Some("detail:Nichtda"),
    )));
    assert_eq!(
        ask("was stand bei Nichtda?", wrong).await.meaning,
        VoiceMeaning::Unclear
    );
    // A yes about a field, or a field question taken for one, decides nothing.
    for words in [
        "die Zusammenfassung passt",
        "ja, was stand in der Zusammenfassung?",
    ] {
        for meaning in ["approve", "reject"] {
            let model = Box::leak(Box::new(ScriptedModel::answering(meaning, None)));
            let command = ask(words, model).await;
            assert!(
                !matches!(
                    command.meaning,
                    VoiceMeaning::Approve | VoiceMeaning::Reject
                ),
                "{words}: {meaning} became {:?}",
                command.meaning
            );
        }
    }
}

#[test]
fn whatever_the_rules_match_in_the_field_questions_they_match_right() {
    let set = field_question_set();
    let mut wrong = Vec::new();
    for sentence in &set.sentences {
        assert!(check_input(&set.input(sentence)).is_ok(), "{}", sentence.id);
        let Some(found) = classify_by_rules(&set.input(sentence), CommandWords::base()) else {
            continue;
        };
        let right = found.command.meaning == sentence.meaning
            && (sentence.meaning != VoiceMeaning::Repeat
                || found.command.piece_id == sentence.piece_id);
        if !right {
            wrong.push(format!(
                "{} {:?}: {:?}",
                sentence.id, sentence.text, found.command
            ));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}
