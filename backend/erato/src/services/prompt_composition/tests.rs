#[cfg(test)]
mod tests {
    use super::super::traits::{FileResolver, MessageRepository, PromptProvider};
    use super::super::transforms::{build_abstract_sequence, resolve_sequence};
    use super::super::types::{AbstractChatSequencePart, PromptSpec};
    use crate::config::ChatProviderConfig;
    use crate::db::entity::{chats, messages};
    use crate::models::assistant::{AssistantWithFiles, FileInfo};
    use crate::models::message::{ContentPart, ContentPartText, MessageRole, MessageSchema};
    use crate::server::api::v1beta::message_streaming::FileContentsForGeneration;
    use async_trait::async_trait;
    use eyre::{OptionExt, Report};
    use sea_orm::prelude::{DateTimeWithTimeZone, Uuid};
    use std::collections::HashMap;

    // ============================================================================
    // Mock Implementations
    // ============================================================================

    struct MockMessageRepository {
        messages: HashMap<Uuid, messages::Model>,
    }

    impl MockMessageRepository {
        fn new() -> Self {
            Self {
                messages: HashMap::new(),
            }
        }

        fn add_message(
            &mut self,
            id: Uuid,
            previous_id: Option<Uuid>,
            role: MessageRole,
            text: &str,
        ) {
            let content = vec![ContentPart::Text(ContentPartText {
                text: text.to_string(),
            })];
            let message_schema = MessageSchema {
                role,
                content,
                name: None,
                additional_fields: HashMap::new(),
            };

            let raw_message = serde_json::to_value(message_schema).unwrap();

            self.messages.insert(
                id,
                messages::Model {
                    id,
                    chat_id: Uuid::new_v4(),
                    raw_message,
                    generation_input_messages: None,
                    generation_parameters: None,
                    generation_metadata: None,
                    previous_message_id: previous_id,
                    sibling_message_id: None,
                    is_message_in_active_thread: true,
                    input_file_uploads: None,
                    created_at: chrono::Utc::now().into(),
                    updated_at: chrono::Utc::now().into(),
                },
            );
        }
    }

    #[async_trait]
    impl MessageRepository for MockMessageRepository {
        async fn get_message_by_id(&self, message_id: &Uuid) -> Result<messages::Model, Report> {
            self.messages
                .get(message_id)
                .cloned()
                .ok_or_eyre("Message not found")
        }

        async fn get_generation_input_messages(
            &self,
            previous_message_id: &Uuid,
            num_messages: usize,
        ) -> Result<Vec<messages::Model>, Report> {
            let mut messages_vec = Vec::new();
            let mut current_message_id = Some(*previous_message_id);
            let mut count = 0;

            while let Some(msg_id) = current_message_id {
                if count >= num_messages {
                    break;
                }

                if let Some(message) = self.messages.get(&msg_id) {
                    current_message_id = message.previous_message_id;
                    messages_vec.push(message.clone());
                    count += 1;
                } else {
                    break;
                }
            }

            messages_vec.reverse();
            Ok(messages_vec)
        }
    }

    struct MockFileResolver {
        files: HashMap<Uuid, (String, String)>, // id -> (filename, content)
    }

    impl MockFileResolver {
        fn new() -> Self {
            Self {
                files: HashMap::new(),
            }
        }

        fn add_file(&mut self, id: Uuid, filename: &str, content: &str) {
            self.files
                .insert(id, (filename.to_string(), content.to_string()));
        }
    }

    #[async_trait]
    impl FileResolver for MockFileResolver {
        async fn resolve_text_file(&self, file_id: Uuid) -> Result<String, Report> {
            self.files
                .get(&file_id)
                .map(|(filename, content)| {
                    format!(
                        "File:\nfile name: {}\nfile_id: erato_file_id:{}\nFile contents\n{}",
                        filename, file_id, content
                    )
                })
                .ok_or_eyre("File not found")
        }

        async fn resolve_image_file(
            &self,
            _file_id: Uuid,
        ) -> Result<crate::models::message::ContentPartImage, Report> {
            Err(eyre::eyre!("Image resolution not implemented in mock"))
        }

        async fn get_assistant_files(
            &self,
            file_ids: &[Uuid],
            _access_token: Option<&str>,
        ) -> Result<Vec<FileContentsForGeneration>, Report> {
            let mut result = Vec::new();
            for file_id in file_ids {
                if let Some((filename, content)) = self.files.get(file_id) {
                    result.push(FileContentsForGeneration {
                        id: *file_id,
                        filename: filename.clone(),
                        contents_as_text: content.clone(),
                    });
                }
            }
            Ok(result)
        }

        fn is_image_file(&self, filename: &str) -> bool {
            if let Some(extension) = filename.rsplit('.').next() {
                matches!(
                    extension.to_lowercase().as_str(),
                    "jpg" | "jpeg" | "png" | "gif"
                )
            } else {
                false
            }
        }
    }

    struct MockPromptProvider {
        system_prompt: Option<String>,
        assistant_config: Option<AssistantWithFiles>,
    }

    impl MockPromptProvider {
        fn new() -> Self {
            Self {
                system_prompt: None,
                assistant_config: None,
            }
        }

        fn with_system_prompt(mut self, prompt: &str) -> Self {
            self.system_prompt = Some(prompt.to_string());
            self
        }

        fn with_assistant(mut self, name: &str, prompt: &str, files: Vec<FileInfo>) -> Self {
            let now: DateTimeWithTimeZone = chrono::Utc::now().into();
            self.assistant_config = Some(AssistantWithFiles {
                id: Uuid::new_v4(),
                owner_user_id: Uuid::new_v4(),
                name: name.to_string(),
                description: None,
                prompt: prompt.to_string(),
                mcp_server_ids: None,
                default_chat_provider: None,
                archived_at: None,
                created_at: now,
                updated_at: now,
                files,
            });
            self
        }
    }

    #[async_trait]
    impl PromptProvider for MockPromptProvider {
        async fn get_system_prompt(
            &self,
            _chat_provider_config: &ChatProviderConfig,
            _preferred_language: Option<&str>,
        ) -> Result<Option<String>, Report> {
            Ok(self.system_prompt.clone())
        }

        async fn get_assistant_config(
            &self,
            _chat: &chats::Model,
        ) -> Result<Option<AssistantWithFiles>, Report> {
            Ok(self.assistant_config.clone())
        }
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    fn create_test_chat() -> chats::Model {
        let now: DateTimeWithTimeZone = chrono::Utc::now().into();
        chats::Model {
            id: Uuid::new_v4(),
            owner_user_id: Uuid::new_v4().to_string(),
            created_at: now,
            updated_at: now,
            title_by_summary: Some("Test Chat".to_string()),
            archived_at: None,
            assistant_configuration: None,
            assistant_id: None,
        }
    }

    fn create_test_chat_provider_config() -> ChatProviderConfig {
        ChatProviderConfig {
            provider_kind: "openai".to_string(),
            model_name: "gpt-4".to_string(),
            model_display_name: Some("GPT-4".to_string()),
            model_name_langfuse: None,
            base_url: None,
            api_key: None,
            api_version: None,
            additional_request_parameters: None,
            additional_request_headers: None,
            system_prompt: None,
            system_prompt_langfuse: None,
            model_capabilities: crate::config::ModelCapabilities::default(),
            model_settings: crate::config::ModelSettings::default(),
        }
    }

    // ============================================================================
    // Unit Tests for build_abstract_sequence
    // ============================================================================

    #[tokio::test]
    async fn test_build_abstract_sequence_with_system_prompt() {
        let mut message_repo = MockMessageRepository::new();
        let _file_resolver = MockFileResolver::new();
        let prompt_provider =
            MockPromptProvider::new().with_system_prompt("You are a helpful assistant.");

        // Create a first message (no previous)
        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Hello");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        let result = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            vec![],
            &config,
            None,
        )
        .await;

        assert!(result.is_ok());
        let seq = result.unwrap();

        // Should have system prompt
        assert!(!seq.parts.is_empty());
        match &seq.parts[0] {
            AbstractChatSequencePart::SystemPrompt { spec } => match spec {
                PromptSpec::Static { content } => {
                    assert_eq!(content, "You are a helpful assistant.");
                }
                _ => panic!("Expected static prompt"),
            },
            _ => panic!("Expected system prompt as first part"),
        }
    }

    #[tokio::test]
    async fn test_build_abstract_sequence_with_assistant_prompt() {
        let mut message_repo = MockMessageRepository::new();
        let _file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new()
            .with_system_prompt("System prompt")
            .with_assistant("TestBot", "Assistant specific instructions", vec![]);

        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Hello");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        let result = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            vec![],
            &config,
            None,
        )
        .await;

        assert!(result.is_ok());
        let seq = result.unwrap();

        // Should have both system and assistant prompts
        assert!(seq.parts.len() >= 2);
        assert!(matches!(
            seq.parts[0],
            AbstractChatSequencePart::SystemPrompt { .. }
        ));
        assert!(matches!(
            seq.parts[1],
            AbstractChatSequencePart::AssistantPrompt { .. }
        ));
    }

    #[tokio::test]
    async fn test_build_abstract_sequence_with_message_history() {
        let mut message_repo = MockMessageRepository::new();
        let _file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new();

        // Create a conversation chain
        let msg1_id = Uuid::new_v4();
        let msg2_id = Uuid::new_v4();
        let msg3_id = Uuid::new_v4();

        message_repo.add_message(msg1_id, None, MessageRole::User, "Hello");
        message_repo.add_message(msg2_id, Some(msg1_id), MessageRole::Assistant, "Hi there!");
        message_repo.add_message(msg3_id, Some(msg2_id), MessageRole::User, "How are you?");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        let result = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg3_id,
            vec![],
            &config,
            None,
        )
        .await;

        assert!(result.is_ok());
        let seq = result.unwrap();

        // Should have previous messages
        let user_messages: Vec<_> = seq
            .parts
            .iter()
            .filter(|p| matches!(p, AbstractChatSequencePart::PreviousUserMessage { .. }))
            .collect();
        let assistant_messages: Vec<_> = seq
            .parts
            .iter()
            .filter(|p| {
                matches!(
                    p,
                    AbstractChatSequencePart::PreviousAssistantMessage { .. }
                )
            })
            .collect();

        assert_eq!(user_messages.len(), 2); // msg1 and msg3
        assert_eq!(assistant_messages.len(), 1); // msg2
    }

    #[tokio::test]
    async fn test_build_abstract_sequence_with_assistant_files_on_first_message() {
        let mut message_repo = MockMessageRepository::new();
        let _file_resolver = MockFileResolver::new();

        let file_id = Uuid::new_v4();
        let now: DateTimeWithTimeZone = chrono::Utc::now().into();
        let file_info = FileInfo {
            id: file_id,
            filename: "assistant_file.txt".to_string(),
            file_storage_provider_id: "test".to_string(),
            file_storage_path: "/test".to_string(),
            created_at: now,
            updated_at: now,
        };

        let prompt_provider =
            MockPromptProvider::new().with_assistant("TestBot", "Be helpful", vec![file_info]);

        // First message (no previous)
        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Hello");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        let result = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            vec![],
            &config,
            None,
        )
        .await;

        assert!(result.is_ok());
        let seq = result.unwrap();

        // Should have assistant file
        let assistant_files: Vec<_> = seq
            .parts
            .iter()
            .filter(|p| matches!(p, AbstractChatSequencePart::AssistantFile { .. }))
            .collect();

        assert_eq!(assistant_files.len(), 1);
        match assistant_files[0] {
            AbstractChatSequencePart::AssistantFile { file_id: id, .. } => {
                assert_eq!(*id, file_id);
            }
            _ => panic!("Expected assistant file"),
        }
    }

    #[tokio::test]
    async fn test_build_abstract_sequence_no_assistant_files_on_second_message() {
        let mut message_repo = MockMessageRepository::new();
        let _file_resolver = MockFileResolver::new();

        let file_id = Uuid::new_v4();
        let now: DateTimeWithTimeZone = chrono::Utc::now().into();
        let file_info = FileInfo {
            id: file_id,
            filename: "assistant_file.txt".to_string(),
            file_storage_provider_id: "test".to_string(),
            file_storage_path: "/test".to_string(),
            created_at: now,
            updated_at: now,
        };

        let prompt_provider =
            MockPromptProvider::new().with_assistant("TestBot", "Be helpful", vec![file_info]);

        // Second message (has previous)
        let msg1_id = Uuid::new_v4();
        let msg2_id = Uuid::new_v4();
        message_repo.add_message(msg1_id, None, MessageRole::User, "Hello");
        message_repo.add_message(msg2_id, Some(msg1_id), MessageRole::Assistant, "Hi!");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        let result = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg2_id,
            vec![],
            &config,
            None,
        )
        .await;

        assert!(result.is_ok());
        let seq = result.unwrap();

        // Should NOT have assistant files (not first message)
        let assistant_files: Vec<_> = seq
            .parts
            .iter()
            .filter(|p| matches!(p, AbstractChatSequencePart::AssistantFile { .. }))
            .collect();

        assert_eq!(assistant_files.len(), 0);
    }

    #[tokio::test]
    async fn test_build_abstract_sequence_with_new_input_files() {
        let mut message_repo = MockMessageRepository::new();
        let _file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new();

        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Hello");

        let file_id = Uuid::new_v4();
        let new_files = vec![FileContentsForGeneration {
            id: file_id,
            filename: "user_file.txt".to_string(),
            contents_as_text: "File content".to_string(),
        }];

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        let result = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            new_files,
            &config,
            None,
        )
        .await;

        assert!(result.is_ok());
        let seq = result.unwrap();

        // Should have current user input with file
        let current_inputs: Vec<_> = seq
            .parts
            .iter()
            .filter(|p| matches!(p, AbstractChatSequencePart::CurrentUserInput { .. }))
            .collect();

        assert_eq!(current_inputs.len(), 1);
        match current_inputs[0] {
            AbstractChatSequencePart::CurrentUserInput { file_ids, .. } => {
                assert_eq!(file_ids.len(), 1);
                assert_eq!(file_ids[0], file_id);
            }
            _ => panic!("Expected current user input"),
        }
    }

    // ============================================================================
    // Unit Tests for resolve_sequence
    // ============================================================================

    #[tokio::test]
    async fn test_resolve_sequence_with_prompts() {
        let message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();

        let mut seq = super::super::types::AbstractChatSequence::new();
        seq.push(AbstractChatSequencePart::SystemPrompt {
            spec: PromptSpec::Static {
                content: "You are helpful".to_string(),
            },
        });
        seq.push(AbstractChatSequencePart::AssistantPrompt {
            spec: PromptSpec::Static {
                content: "Be concise".to_string(),
            },
        });

        let result = resolve_sequence(seq, &message_repo, &file_resolver).await;

        assert!(result.is_ok());
        let (resolved, unresolved) = result.unwrap();

        // Should have 2 system messages
        assert_eq!(resolved.messages.len(), 2);
        assert_eq!(unresolved.messages.len(), 2);

        assert!(matches!(resolved.messages[0].role, MessageRole::System));
        assert!(matches!(resolved.messages[1].role, MessageRole::System));
    }

    #[tokio::test]
    async fn test_resolve_sequence_with_previous_messages() {
        let mut message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();

        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Test message");

        let mut seq = super::super::types::AbstractChatSequence::new();
        seq.push(AbstractChatSequencePart::PreviousUserMessage {
            message_id: msg_id,
        });

        let result = resolve_sequence(seq, &message_repo, &file_resolver).await;

        assert!(result.is_ok());
        let (resolved, _) = result.unwrap();

        assert_eq!(resolved.messages.len(), 1);
        assert!(matches!(resolved.messages[0].role, MessageRole::User));

        match &resolved.messages[0].content {
            ContentPart::Text(text) => {
                assert_eq!(text.text, "Test message");
            }
            _ => panic!("Expected text content"),
        }
    }

    // ============================================================================
    // Integration-Style Tests
    // ============================================================================

    #[tokio::test]
    async fn test_full_chat_request_composition_simple_conversation() {
        // Setup: Create a simple conversation history
        let mut message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();
        let prompt_provider =
            MockPromptProvider::new().with_system_prompt("You are a helpful AI assistant.");

        // Create conversation: User -> Assistant -> User
        let msg1_id = Uuid::new_v4();
        let msg2_id = Uuid::new_v4();
        let msg3_id = Uuid::new_v4();

        message_repo.add_message(msg1_id, None, MessageRole::User, "What is Rust?");
        message_repo.add_message(
            msg2_id,
            Some(msg1_id),
            MessageRole::Assistant,
            "Rust is a systems programming language.",
        );
        message_repo.add_message(
            msg3_id,
            Some(msg2_id),
            MessageRole::User,
            "Tell me more.",
        );

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Execute: Build abstract sequence
        let abstract_seq = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg3_id,
            vec![],
            &config,
            None,
        )
        .await
        .expect("Failed to build abstract sequence");

        // Verify abstract sequence structure
        assert!(abstract_seq.len() > 0);

        // Execute: Resolve sequence
        let (resolved, unresolved) = resolve_sequence(abstract_seq, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence");

        // Verify resolved sequence
        // Should have: 1 system + 3 conversation messages = 4 total
        assert_eq!(resolved.messages.len(), 4);
        assert_eq!(unresolved.messages.len(), 4);

        // Verify message order and roles
        assert!(matches!(resolved.messages[0].role, MessageRole::System));
        assert!(matches!(resolved.messages[1].role, MessageRole::User));
        assert!(matches!(
            resolved.messages[2].role,
            MessageRole::Assistant
        ));
        assert!(matches!(resolved.messages[3].role, MessageRole::User));
    }

    #[tokio::test]
    async fn test_full_chat_request_with_assistant_and_files() {
        // Setup: Assistant with files on first message
        let mut message_repo = MockMessageRepository::new();
        let mut file_resolver = MockFileResolver::new();

        let assistant_file_id = Uuid::new_v4();
        let now: DateTimeWithTimeZone = chrono::Utc::now().into();

        file_resolver.add_file(
            assistant_file_id,
            "context.txt",
            "Important context information",
        );

        let file_info = FileInfo {
            id: assistant_file_id,
            filename: "context.txt".to_string(),
            file_storage_provider_id: "test".to_string(),
            file_storage_path: "/context.txt".to_string(),
            created_at: now,
            updated_at: now,
        };

        let prompt_provider = MockPromptProvider::new()
            .with_system_prompt("You are an expert.")
            .with_assistant("ExpertBot", "Use the provided context.", vec![file_info]);

        // First message in chat
        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Analyze this data");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Execute full pipeline
        let abstract_seq = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            vec![],
            &config,
            None,
        )
        .await
        .expect("Failed to build abstract sequence");

        let (resolved, _) = resolve_sequence(abstract_seq, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence");

        // Verify:
        // Should have: system prompt + assistant prompt + assistant file + previous user message
        assert_eq!(resolved.messages.len(), 4);

        // First two should be system messages
        assert!(matches!(resolved.messages[0].role, MessageRole::System));
        assert!(matches!(resolved.messages[1].role, MessageRole::System));

        // Third should be user message with file pointer (assistant file)
        assert!(matches!(resolved.messages[2].role, MessageRole::User));

        // Fourth should be the actual user message
        assert!(matches!(resolved.messages[3].role, MessageRole::User));
    }

    #[tokio::test]
    async fn test_full_chat_request_with_user_uploaded_files() {
        // Setup: User uploads files with their message
        let mut message_repo = MockMessageRepository::new();
        let mut file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new();

        let user_file_id = Uuid::new_v4();
        file_resolver.add_file(user_file_id, "data.csv", "col1,col2\n1,2\n3,4");

        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Previous message");

        let new_files = vec![FileContentsForGeneration {
            id: user_file_id,
            filename: "data.csv".to_string(),
            contents_as_text: "col1,col2\n1,2\n3,4".to_string(),
        }];

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Execute
        let abstract_seq = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            new_files,
            &config,
            None,
        )
        .await
        .expect("Failed to build abstract sequence");

        let (resolved, _) = resolve_sequence(abstract_seq, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence");

        // Verify: Should have previous user message + new file as file pointer
        assert_eq!(resolved.messages.len(), 2);
        assert!(matches!(resolved.messages[0].role, MessageRole::User));
        assert!(matches!(resolved.messages[1].role, MessageRole::User));

        // Second message should be a file pointer
        match &resolved.messages[1].content {
            ContentPart::TextFilePointer(ptr) => {
                assert_eq!(ptr.file_upload_id, user_file_id);
            }
            _ => panic!("Expected text file pointer"),
        }
    }

    #[tokio::test]
    async fn test_full_chat_request_respects_message_limit() {
        // Setup: Long conversation history (more than 10 messages)
        let mut message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new();

        // Create 15 messages in a chain
        let mut message_ids = vec![];
        for i in 0..15 {
            let msg_id = Uuid::new_v4();
            let prev_id = if i == 0 { None } else { Some(message_ids[i - 1]) };
            let role = if i % 2 == 0 {
                MessageRole::User
            } else {
                MessageRole::Assistant
            };
            message_repo.add_message(msg_id, prev_id, role, &format!("Message {}", i + 1));
            message_ids.push(msg_id);
        }

        let last_msg_id = message_ids[14];
        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Execute
        let abstract_seq = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &last_msg_id,
            vec![],
            &config,
            None,
        )
        .await
        .expect("Failed to build abstract sequence");

        let (resolved, _) = resolve_sequence(abstract_seq, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence");

        // Verify: Should have at most 10 previous messages (limit in get_generation_input_messages)
        // The traversal includes the message at previous_message_id, so we should have exactly 10
        let message_count = resolved.messages.len();
        assert!(
            message_count <= 10,
            "Expected at most 10 messages, got {}",
            message_count
        );
    }

    #[tokio::test]
    async fn test_full_chat_request_empty_history() {
        // Setup: First message in a new chat
        let mut message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();
        let prompt_provider =
            MockPromptProvider::new().with_system_prompt("You are helpful.");

        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Hello!");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Execute
        let abstract_seq = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            vec![],
            &config,
            None,
        )
        .await
        .expect("Failed to build abstract sequence");

        let (resolved, _) = resolve_sequence(abstract_seq, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence");

        // Verify: Should have system prompt + the one user message
        assert_eq!(resolved.messages.len(), 2);
        assert!(matches!(resolved.messages[0].role, MessageRole::System));
        assert!(matches!(resolved.messages[1].role, MessageRole::User));
    }

    #[tokio::test]
    async fn test_image_file_detection() {
        let file_resolver = MockFileResolver::new();

        assert!(file_resolver.is_image_file("photo.jpg"));
        assert!(file_resolver.is_image_file("IMAGE.PNG"));
        assert!(file_resolver.is_image_file("diagram.gif"));
        assert!(!file_resolver.is_image_file("document.pdf"));
        assert!(!file_resolver.is_image_file("data.csv"));
        assert!(!file_resolver.is_image_file("noextension"));
    }
}
