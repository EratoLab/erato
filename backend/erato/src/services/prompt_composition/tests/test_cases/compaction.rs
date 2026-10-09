use super::*;
use crate::models::message::{ContentPartCompactionMarker, ContentPartTextFilePointer};

fn checkpoint(
    repo: &mut MockMessageRepository,
    previous: Uuid,
    summary: &str,
    file: Option<Uuid>,
) -> Uuid {
    let id = Uuid::new_v4();
    let marker = ContentPartCompactionMarker {
        version: 1,
        mode: "summarize".into(),
        operation_id: id,
        summarizer_chat_provider_id: "summarizer".into(),
        target_chat_provider_id: "conversation".into(),
        before_tokens: 1000,
        after_tokens: 100,
        before_files: usize::from(file.is_some()),
        after_files: usize::from(file.is_some()),
        retained_file_ids: file.into_iter().collect(),
        dropped_file_ids: vec![],
    };
    repo.add_message_with_content(
        id,
        Some(previous),
        MessageRole::Assistant,
        vec![
            ContentPart::CompactionMarker(marker),
            ContentPart::Text(ContentPartText {
                text: summary.into(),
            }),
        ],
    );
    let mut messages = vec![
        InputMessage {
            role: MessageRole::System,
            content: ContentPart::Text(ContentPartText {
                text: "persistent instructions".into(),
            }),
        },
        InputMessage {
            role: MessageRole::Assistant,
            content: ContentPart::Text(ContentPartText {
                text: summary.into(),
            }),
        },
    ];
    if let Some(file_upload_id) = file {
        messages.push(InputMessage {
            role: MessageRole::User,
            content: ContentPart::TextFilePointer(ContentPartTextFilePointer { file_upload_id }),
        });
    }
    repo.update_generation_input_messages(id, &GenerationInputMessages { messages });
    id
}

async fn compose(
    repo: &MockMessageRepository,
    tip: Uuid,
    files: &MockFileResolver,
) -> (ResolvedChatSequence, GenerationInputMessages) {
    let sequence = build_abstract_sequence(
        repo,
        &MockPromptProvider::new().with_system_prompt("current system"),
        &create_test_chat(),
        &tip,
        vec![],
        &create_test_chat_provider_config(),
        &FacetsConfig::default(),
        &[],
        None,
    )
    .await
    .unwrap();
    resolve_sequence(sequence, repo, files).await.unwrap()
}

#[tokio::test]
async fn checkpoint_replay_does_not_resurrect_old_turns_or_duplicate_summary() {
    let mut repo = MockMessageRepository::new();
    let files = MockFileResolver::new();
    let old = Uuid::new_v4();
    repo.add_message(old, None, MessageRole::User, "FORBIDDEN original turn");
    let marker = checkpoint(&mut repo, old, "durable summary", None);
    let user = Uuid::new_v4();
    repo.add_message(user, Some(marker), MessageRole::User, "continuation");
    let (resolved, snapshot) = compose(&repo, user, &files).await;
    let payload = serde_json::to_string(&snapshot).unwrap();
    assert!(!payload.contains("FORBIDDEN"));
    assert!(!payload.contains("compaction_marker"));
    assert_eq!(
        resolved
            .messages
            .iter()
            .filter(|m| m.full_text() == "durable summary")
            .count(),
        1
    );
    assert_eq!(
        resolved.messages.last().unwrap().full_text(),
        "continuation"
    );
    // A later ordinary assistant persists the effective snapshot, carrying the boundary forward.
    let assistant = Uuid::new_v4();
    repo.add_message(
        assistant,
        Some(user),
        MessageRole::Assistant,
        "post-checkpoint answer",
    );
    repo.update_generation_input_messages(assistant, &snapshot);
    let next = Uuid::new_v4();
    repo.add_message(next, Some(assistant), MessageRole::User, "next turn");
    let (_, next_snapshot) = compose(&repo, next, &files).await;
    let payload = serde_json::to_string(&next_snapshot).unwrap();
    assert!(!payload.contains("FORBIDDEN"));
    assert_eq!(
        next_snapshot
            .messages
            .iter()
            .filter(|m| m.full_text() == "durable summary")
            .count(),
        1
    );
    assert!(payload.contains("post-checkpoint answer"));
}

#[tokio::test]
async fn nearest_checkpoint_wins_and_branch_before_checkpoint_keeps_original_context() {
    let mut repo = MockMessageRepository::new();
    let files = MockFileResolver::new();
    let original = Uuid::new_v4();
    repo.add_message(original, None, MessageRole::Assistant, "original goal");
    let first = checkpoint(&mut repo, original, "first summary", None);
    let second = checkpoint(&mut repo, first, "second summary", None);
    let next = Uuid::new_v4();
    repo.add_message(next, Some(second), MessageRole::User, "next");
    let (_, snapshot) = compose(&repo, next, &files).await;
    let text = serde_json::to_string(&snapshot).unwrap();
    assert!(text.contains("second summary"));
    assert!(!text.contains("first summary"));
    assert!(!text.contains("original goal"));
    let branch = Uuid::new_v4();
    repo.add_message(branch, Some(original), MessageRole::User, "branch");
    let (_, snapshot) = compose(&repo, branch, &files).await;
    let text = serde_json::to_string(&snapshot).unwrap();
    assert!(text.contains("original goal"));
    assert!(!text.contains("summary"));
}

#[tokio::test]
async fn retained_file_is_resolved_and_checkpoint_is_found_beyond_ten_rows() {
    let mut repo = MockMessageRepository::new();
    let mut files = MockFileResolver::new();
    let file = Uuid::new_v4();
    files.add_file(file, "knowledge.txt", "RETAINED FILE PREVIEW");
    let original = Uuid::new_v4();
    repo.add_message(original, None, MessageRole::User, "FORBIDDEN source");
    let mut tip = checkpoint(&mut repo, original, "retained summary", Some(file));
    for index in 0..20 {
        let id = Uuid::new_v4();
        repo.add_message(
            id,
            Some(tip),
            MessageRole::Assistant,
            &format!("answer {index}"),
        );
        tip = id;
    }
    let user = Uuid::new_v4();
    repo.add_message(user, Some(tip), MessageRole::User, "continue");
    let (resolved, snapshot) = compose(&repo, user, &files).await;
    assert!(
        !serde_json::to_string(&snapshot)
            .unwrap()
            .contains("FORBIDDEN")
    );
    assert_eq!(
        snapshot
            .messages
            .iter()
            .filter(|m| matches!(m.content, ContentPart::TextFilePointer(_)))
            .count(),
        1
    );
    assert!(resolved.messages.iter().any(
        |m| matches!(&m.content, ContentPart::TextFilePointer(p) if p.file_upload_id == file)
    ));
}

#[tokio::test]
async fn malformed_checkpoint_and_cycles_fail_closed() {
    let mut repo = MockMessageRepository::new();
    let old = Uuid::new_v4();
    repo.add_message(old, None, MessageRole::User, "goal");
    let cp = checkpoint(&mut repo, old, "summary", None);
    repo.messages
        .get_mut(&cp)
        .unwrap()
        .generation_input_messages = None;
    assert!(
        build_abstract_sequence(
            &repo,
            &MockPromptProvider::new(),
            &create_test_chat(),
            &cp,
            vec![],
            &create_test_chat_provider_config(),
            &FacetsConfig::default(),
            &[],
            None
        )
        .await
        .is_err()
    );
    repo.messages.remove(&cp);
    repo.messages.get_mut(&old).unwrap().previous_message_id = Some(old);
    assert!(
        build_abstract_sequence(
            &repo,
            &MockPromptProvider::new(),
            &create_test_chat(),
            &old,
            vec![],
            &create_test_chat_provider_config(),
            &FacetsConfig::default(),
            &[],
            None
        )
        .await
        .is_err()
    );
}
