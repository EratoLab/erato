#[cfg(test)]
mod test_cases {
    use super::super::traits::{FileResolver, MessageRepository, PromptProvider};
    use super::super::transforms::{build_abstract_sequence, resolve_sequence};
    use super::super::types::{AbstractChatSequencePart, PromptSpec};
    use crate::config::{ChatProviderConfig, ExperimentalFacetsConfig, PromptSourceSpecification};
    use crate::db::entity::{chats, messages};
    use crate::models::assistant::{AssistantWithFiles, FileInfo};
    use crate::models::message::{ContentPart, ContentPartText, MessageRole, MessageSchema};
    use crate::server::api::v1beta::message_streaming::{FileContent, FileContentsForGeneration};
    use async_trait::async_trait;
    use eyre::{OptionExt, Report, eyre};
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

        // Update a message's generation_input_messages field to simulate persistence
        fn update_generation_input_messages(
            &mut self,
            message_id: Uuid,
            gen_input: &crate::models::message::GenerationInputMessages,
        ) {
            if let Some(message) = self.messages.get_mut(&message_id) {
                message.generation_input_messages = Some(serde_json::to_value(gen_input).unwrap());
            }
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
                        content: FileContent::Text(content.clone()),
                    });
                }
            }
            Ok(result)
        }

        async fn is_image_file(&self, file_id: Uuid) -> Result<bool, Report> {
            let filename = self
                .files
                .get(&file_id)
                .map(|(filename, _)| filename.as_str())
                .ok_or_eyre("File not found")?;

            let is_image = if let Some(extension) = filename.rsplit('.').next() {
                matches!(
                    extension.to_lowercase().as_str(),
                    "jpg" | "jpeg" | "png" | "gif"
                )
            } else {
                false
            };

            Ok(is_image)
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

        async fn resolve_prompt_source(
            &self,
            spec: &PromptSourceSpecification,
        ) -> Result<String, Report> {
            match spec {
                PromptSourceSpecification::Static { content } => Ok(content.clone()),
                PromptSourceSpecification::Langfuse { prompt_name, .. } => Err(eyre!(
                    "Langfuse prompt '{}' not supported in MockPromptProvider",
                    prompt_name
                )),
            }
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
            &ExperimentalFacetsConfig::default(),
            &[],
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
            &ExperimentalFacetsConfig::default(),
            &[],
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
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await;

        assert!(result.is_ok());
        let seq = result.unwrap();

        // Should have previous messages
        let user_messages: Vec<_> = seq
            .parts
            .iter()
            .filter(|p| matches!(p, AbstractChatSequencePart::CurrentUserContent { .. }))
            .collect();
        let assistant_messages: Vec<_> = seq
            .parts
            .iter()
            .filter(|p| matches!(p, AbstractChatSequencePart::PreviousAssistantMessage { .. }))
            .collect();

        assert_eq!(user_messages.len(), 1); // msg3 (current)
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
            &ExperimentalFacetsConfig::default(),
            &[],
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
            &ExperimentalFacetsConfig::default(),
            &[],
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
        let new_file_ids = vec![file_id];

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        let result = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            new_file_ids,
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await;

        assert!(result.is_ok());
        let seq = result.unwrap();

        // Should have user file
        let user_files: Vec<_> = seq
            .parts
            .iter()
            .filter(|p| matches!(p, AbstractChatSequencePart::UserFile { .. }))
            .collect();

        assert_eq!(user_files.len(), 1);
        match user_files[0] {
            AbstractChatSequencePart::UserFile { file_id: id } => {
                assert_eq!(*id, file_id);
            }
            _ => panic!("Expected user file"),
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
        let message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();

        let mut seq = super::super::types::AbstractChatSequence::new();
        seq.push(AbstractChatSequencePart::CurrentUserContent {
            content: "Test message".to_string(),
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

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // First user message turn: Add user message and assistant message, and resolve.
        message_repo.add_message(msg1_id, None, MessageRole::User, "What is Rust?");
        message_repo.add_message(
            msg2_id,
            Some(msg1_id),
            MessageRole::Assistant,
            "Rust is a systems programming language.",
        );

        // Simulate production: build the generation input for msg1 and persist it on msg2.
        let abstract_seq_for_msg2 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg1_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build abstract sequence for assistant response");

        let (_, unresolved_for_msg2) =
            resolve_sequence(abstract_seq_for_msg2, &message_repo, &file_resolver)
                .await
                .expect("Failed to resolve sequence for assistant response");

        message_repo.update_generation_input_messages(msg2_id, &unresolved_for_msg2);

        // Second user message turn
        message_repo.add_message(msg3_id, Some(msg2_id), MessageRole::User, "Tell me more.");

        // Execute: Build abstract sequence
        let abstract_seq = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg3_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build abstract sequence");

        // Verify abstract sequence structure
        assert!(!abstract_seq.is_empty());

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
        assert!(matches!(resolved.messages[2].role, MessageRole::Assistant));
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
            &ExperimentalFacetsConfig::default(),
            &[],
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

        let new_file_ids = vec![user_file_id];

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Execute
        let abstract_seq = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            new_file_ids,
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
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
    async fn test_full_chat_request_with_assistant_and_user_files() {
        // Setup: Assistant with files, plus user uploads additional file to chat
        let mut message_repo = MockMessageRepository::new();
        let mut file_resolver = MockFileResolver::new();

        // Assistant file
        let assistant_file_id = Uuid::new_v4();
        file_resolver.add_file(
            assistant_file_id,
            "assistant_context.txt",
            "This is assistant-provided context",
        );

        let now: DateTimeWithTimeZone = chrono::Utc::now().into();
        let assistant_file_info = FileInfo {
            id: assistant_file_id,
            filename: "assistant_context.txt".to_string(),
            file_storage_provider_id: "test".to_string(),
            file_storage_path: "/assistant_context.txt".to_string(),
            created_at: now,
            updated_at: now,
        };

        // User-uploaded file (chat-specific)
        let user_file_id = Uuid::new_v4();
        file_resolver.add_file(
            user_file_id,
            "user_data.csv",
            "name,value\nAlice,100\nBob,200",
        );

        let prompt_provider = MockPromptProvider::new()
            .with_system_prompt("You are a data analyst.")
            .with_assistant(
                "AnalystBot",
                "Use both the assistant context and user-provided data.",
                vec![assistant_file_info],
            );

        // First message in chat with user-uploaded file
        let msg_id = Uuid::new_v4();
        message_repo.add_message(msg_id, None, MessageRole::User, "Analyze this dataset");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Execute full pipeline
        let abstract_seq = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg_id,
            vec![user_file_id],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build abstract sequence");

        let (resolved, _) = resolve_sequence(abstract_seq, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence");

        // Verify:
        // Should have:
        // 1. System prompt (general)
        // 2. System prompt (assistant)
        // 3. User message with assistant file pointer
        // 4. User message (actual user input)
        // 5. User message with user-uploaded file pointer
        assert_eq!(resolved.messages.len(), 5);

        // First two should be system messages
        assert!(matches!(resolved.messages[0].role, MessageRole::System));
        assert!(matches!(resolved.messages[1].role, MessageRole::System));

        // Verify system prompt content
        match &resolved.messages[0].content {
            ContentPart::Text(text) => {
                assert_eq!(text.text, "You are a data analyst.");
            }
            _ => panic!("Expected text content for system prompt"),
        }

        match &resolved.messages[1].content {
            ContentPart::Text(text) => {
                assert_eq!(
                    text.text,
                    "Use both the assistant context and user-provided data."
                );
            }
            _ => panic!("Expected text content for assistant prompt"),
        }

        // Third should be user message with assistant file pointer
        assert!(matches!(resolved.messages[2].role, MessageRole::User));
        match &resolved.messages[2].content {
            ContentPart::TextFilePointer(ptr) => {
                assert_eq!(ptr.file_upload_id, assistant_file_id);
            }
            _ => panic!("Expected text file pointer for assistant file"),
        }

        // Fourth should be the actual user message
        assert!(matches!(resolved.messages[3].role, MessageRole::User));
        match &resolved.messages[3].content {
            ContentPart::Text(text) => {
                assert_eq!(text.text, "Analyze this dataset");
            }
            _ => panic!("Expected text content for user message"),
        }

        // Fifth should be user message with user-uploaded file pointer
        assert!(matches!(resolved.messages[4].role, MessageRole::User));
        match &resolved.messages[4].content {
            ContentPart::TextFilePointer(ptr) => {
                assert_eq!(ptr.file_upload_id, user_file_id);
            }
            _ => panic!("Expected text file pointer for user file"),
        }
    }

    #[tokio::test]
    async fn test_full_chat_request_empty_history() {
        // Setup: First message in a new chat
        let mut message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new().with_system_prompt("You are helpful.");

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
            &ExperimentalFacetsConfig::default(),
            &[],
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
        let mut file_resolver = MockFileResolver::new();

        let jpg_id = Uuid::new_v4();
        let png_id = Uuid::new_v4();
        let gif_id = Uuid::new_v4();
        let pdf_id = Uuid::new_v4();
        let csv_id = Uuid::new_v4();
        let noext_id = Uuid::new_v4();

        file_resolver.add_file(jpg_id, "photo.jpg", "");
        file_resolver.add_file(png_id, "IMAGE.PNG", "");
        file_resolver.add_file(gif_id, "diagram.gif", "");
        file_resolver.add_file(pdf_id, "document.pdf", "");
        file_resolver.add_file(csv_id, "data.csv", "");
        file_resolver.add_file(noext_id, "noextension", "");

        assert!(file_resolver.is_image_file(jpg_id).await.unwrap());
        assert!(file_resolver.is_image_file(png_id).await.unwrap());
        assert!(file_resolver.is_image_file(gif_id).await.unwrap());
        assert!(!file_resolver.is_image_file(pdf_id).await.unwrap());
        assert!(!file_resolver.is_image_file(csv_id).await.unwrap());
        assert!(!file_resolver.is_image_file(noext_id).await.unwrap());
    }

    #[tokio::test]
    async fn test_assistant_file_persists_across_messages() {
        // Bug test: Assistant files should persist across the entire conversation,
        // not just appear on the first message
        let mut message_repo = MockMessageRepository::new();
        let mut file_resolver = MockFileResolver::new();

        // Assistant file
        let assistant_file_id = Uuid::new_v4();
        file_resolver.add_file(
            assistant_file_id,
            "context.txt",
            "Important context information",
        );

        let now: DateTimeWithTimeZone = chrono::Utc::now().into();
        let file_info = FileInfo {
            id: assistant_file_id,
            filename: "context.txt".to_string(),
            file_storage_provider_id: "test".to_string(),
            file_storage_path: "/context.txt".to_string(),
            created_at: now,
            updated_at: now,
        };

        let prompt_provider = MockPromptProvider::new()
            .with_system_prompt("You are helpful.")
            .with_assistant("TestBot", "Use the context.", vec![file_info]);

        // First message in chat
        let msg1_id = Uuid::new_v4();
        message_repo.add_message(msg1_id, None, MessageRole::User, "What's in the report?");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Build first message request
        let abstract_seq1 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg1_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build first abstract sequence");

        let (resolved1, unresolved1) =
            resolve_sequence(abstract_seq1, &message_repo, &file_resolver)
                .await
                .expect("Failed to resolve first sequence");

        // Persist the generation_input_messages for the first message
        // This simulates what happens in the actual code when a message is stored
        message_repo.update_generation_input_messages(msg1_id, &unresolved1);

        // First message should have: system + assistant prompt + assistant file + user message
        assert_eq!(resolved1.messages.len(), 4);

        // Simulate an assistant response
        let msg2_id = Uuid::new_v4();
        message_repo.add_message(
            msg2_id,
            Some(msg1_id),
            MessageRole::Assistant,
            "The report contains sales data.",
        );

        // Second message in chat
        let msg3_id = Uuid::new_v4();
        message_repo.add_message(msg3_id, Some(msg2_id), MessageRole::User, "Tell me more");

        // Build second message request
        let abstract_seq2 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg3_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build second abstract sequence");

        let (resolved2, _) = resolve_sequence(abstract_seq2, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve second sequence");

        // Second message should have:
        // - system prompt
        // - assistant prompt
        // - assistant file (THIS IS THE BUG - it's missing!)
        // - first user message
        // - first assistant response
        // - second user message

        eprintln!("DEBUG: Second message count: {}", resolved2.messages.len());
        for (i, msg) in resolved2.messages.iter().enumerate() {
            eprintln!(
                "DEBUG: Message {}: role={:?}, content={:?}",
                i, msg.role, msg.content
            );
        }

        // The assistant file should still be present
        let has_assistant_file = resolved2
            .messages
            .iter()
            .any(|m| matches!(&m.content, ContentPart::TextFilePointer(ptr) if ptr.file_upload_id == assistant_file_id));

        assert!(
            has_assistant_file,
            "Assistant file should persist across messages but was not found"
        );
    }

    #[tokio::test]
    async fn test_user_file_persists_across_messages() {
        // Bug test: User-provided files should persist in the conversation history
        let mut message_repo = MockMessageRepository::new();
        let mut file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new();

        // User-uploaded file
        let user_file_id = Uuid::new_v4();
        file_resolver.add_file(user_file_id, "data.csv", "col1,col2\n1,2");

        // First message with file
        let msg1_id = Uuid::new_v4();
        message_repo.add_message(msg1_id, None, MessageRole::User, "Analyze this data");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Build first message request
        let abstract_seq1 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg1_id,
            vec![user_file_id],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build first abstract sequence");

        let (resolved1, unresolved1) =
            resolve_sequence(abstract_seq1, &message_repo, &file_resolver)
                .await
                .expect("Failed to resolve first sequence");

        // Persist the generation_input_messages for the first message
        message_repo.update_generation_input_messages(msg1_id, &unresolved1);

        // First message should have: user message + file pointer
        assert_eq!(resolved1.messages.len(), 2);

        // Simulate an assistant response
        let msg2_id = Uuid::new_v4();
        message_repo.add_message(
            msg2_id,
            Some(msg1_id),
            MessageRole::Assistant,
            "I see the data.",
        );

        // Second message in chat (no new files)
        let msg3_id = Uuid::new_v4();
        message_repo.add_message(msg3_id, Some(msg2_id), MessageRole::User, "Tell me more");

        // Build second message request
        let abstract_seq2 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg3_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build second abstract sequence");

        let (resolved2, _) = resolve_sequence(abstract_seq2, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve second sequence");

        eprintln!("DEBUG: Second message count: {}", resolved2.messages.len());
        for (i, msg) in resolved2.messages.iter().enumerate() {
            eprintln!(
                "DEBUG: Message {}: role={:?}, content={:?}",
                i, msg.role, msg.content
            );
        }

        // The user file should still be present in the conversation history
        let has_user_file = resolved2
            .messages
            .iter()
            .any(|m| matches!(&m.content, ContentPart::TextFilePointer(ptr) if ptr.file_upload_id == user_file_id));

        assert!(
            has_user_file,
            "User file should persist in conversation history but was not found"
        );
    }

    #[tokio::test]
    async fn test_multi_turn_user_file_with_assistant_gen_inputs() {
        // Bug repro: multi-turn chat with an initial file and assistant gen inputs after each user turn
        // should retain assistant messages in history.
        let mut message_repo = MockMessageRepository::new();
        let mut file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new().with_system_prompt("You are helpful.");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // User-uploaded file on first message
        let user_file_id = Uuid::new_v4();
        file_resolver.add_file(
            user_file_id,
            "Acme_Inc_Organizational_Data.xlsx",
            "Revenue_2000_2025, Headcount_2000_2025",
        );

        // Conversation: user1 (with file) -> assistant1 -> user2 -> assistant2 -> user3
        let msg1_id = Uuid::new_v4();
        message_repo.add_message(
            msg1_id,
            None,
            MessageRole::User,
            "What can you tell me about the company?",
        );

        // Build input for assistant1 and persist on msg2
        let abstract_seq1 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg1_id,
            vec![user_file_id],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build abstract sequence for assistant1");

        let (_, unresolved1) = resolve_sequence(abstract_seq1, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence for assistant1");

        let msg2_id = Uuid::new_v4();
        message_repo.add_message(
            msg2_id,
            Some(msg1_id),
            MessageRole::Assistant,
            "ACME INC is a multi-national organization with steady growth.",
        );
        message_repo.update_generation_input_messages(msg2_id, &unresolved1);

        let msg3_id = Uuid::new_v4();
        message_repo.add_message(
            msg3_id,
            Some(msg2_id),
            MessageRole::User,
            "What's on the first sheet?",
        );

        // Build input for assistant2 and persist on msg4
        let abstract_seq2 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg3_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build abstract sequence for assistant2");

        let (_, unresolved2) = resolve_sequence(abstract_seq2, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence for assistant2");

        let msg4_id = Uuid::new_v4();
        message_repo.add_message(
            msg4_id,
            Some(msg3_id),
            MessageRole::Assistant,
            "The first sheet contains revenue data.",
        );
        message_repo.update_generation_input_messages(msg4_id, &unresolved2);

        let msg5_id = Uuid::new_v4();
        message_repo.add_message(
            msg5_id,
            Some(msg4_id),
            MessageRole::User,
            "What's on the last sheet?",
        );

        // Build final request (for user3)
        eprintln!("DEBUG: === Third resolution");
        let abstract_seq3 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg5_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build abstract sequence for user3");

        let (resolved3, _) = resolve_sequence(abstract_seq3, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve sequence for user3");

        eprintln!("DEBUG: Final message count: {}", resolved3.messages.len());
        for (i, msg) in resolved3.messages.iter().enumerate() {
            eprintln!(
                "DEBUG: Message {}: role={:?}, content={:?}",
                i, msg.role, msg.content
            );
        }

        // Expect full history with both assistant replies present.
        let assistant_count = resolved3
            .messages
            .iter()
            .filter(|m| matches!(m.role, MessageRole::Assistant))
            .count();
        assert_eq!(
            assistant_count, 2,
            "Expected 2 assistant messages in history, found {}",
            assistant_count
        );

        // File pointer should still be present in history
        let has_user_file = resolved3.messages.iter().any(|m| {
            matches!(
                &m.content,
                ContentPart::TextFilePointer(ptr) if ptr.file_upload_id == user_file_id
            )
        });
        assert!(
            has_user_file,
            "User file should persist in conversation history but was not found"
        );

        assert!(matches!(resolved3.messages[0].role, MessageRole::System));
        assert!(matches!(resolved3.messages[1].role, MessageRole::User)); // Initial user message
        assert!(matches!(resolved3.messages[2].role, MessageRole::User)); // File pointer
        assert!(matches!(resolved3.messages[3].role, MessageRole::Assistant)); // Response to first message
        assert!(matches!(resolved3.messages[4].role, MessageRole::User)); // First follow up
        assert!(matches!(resolved3.messages[5].role, MessageRole::Assistant)); // Response to first follow up
        assert!(matches!(resolved3.messages[6].role, MessageRole::User)); // Second follow up
    }

    #[tokio::test]
    async fn test_system_prompts_not_duplicated_with_generation_input_messages() {
        // Bug test: System prompts should not be duplicated when previous message
        // has generation_input_messages stored
        let mut message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new().with_system_prompt("You are helpful.");

        // First message
        let msg1_id = Uuid::new_v4();
        message_repo.add_message(msg1_id, None, MessageRole::User, "Hello");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Build first message request
        let abstract_seq1 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg1_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build first abstract sequence");

        let (resolved1, unresolved1) =
            resolve_sequence(abstract_seq1, &message_repo, &file_resolver)
                .await
                .expect("Failed to resolve first sequence");

        // First message should have: system prompt + user message
        assert_eq!(resolved1.messages.len(), 2);

        // Persist the generation_input_messages for the first message
        message_repo.update_generation_input_messages(msg1_id, &unresolved1);

        // Simulate an assistant response
        let msg2_id = Uuid::new_v4();
        message_repo.add_message(msg2_id, Some(msg1_id), MessageRole::Assistant, "Hi there!");

        // Set generation_input_messages for the assistant message
        // In production, this would contain the full context used to generate the response
        let assistant_gen_input = crate::models::message::GenerationInputMessages {
            messages: resolved1.messages.clone(),
        };
        message_repo.update_generation_input_messages(msg2_id, &assistant_gen_input);

        // Second message in chat
        let msg3_id = Uuid::new_v4();
        message_repo.add_message(msg3_id, Some(msg2_id), MessageRole::User, "How are you?");

        // Build second message request
        let abstract_seq2 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg3_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build second abstract sequence");

        let (resolved2, _) = resolve_sequence(abstract_seq2, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve second sequence");

        eprintln!("DEBUG: Second message count: {}", resolved2.messages.len());
        for (i, msg) in resolved2.messages.iter().enumerate() {
            eprintln!(
                "DEBUG: Message {}: role={:?}, content={:?}",
                i, msg.role, msg.content
            );
        }

        // Count system messages
        let system_count = resolved2
            .messages
            .iter()
            .filter(|m| matches!(m.role, MessageRole::System))
            .count();

        // Should only have ONE system prompt, not duplicates
        assert_eq!(
            system_count, 1,
            "Expected 1 system prompt, found {}. System prompts are being duplicated!",
            system_count
        );

        // Should have exactly 4 messages total: system + user1 + assistant + user2
        assert_eq!(
            resolved2.messages.len(),
            4,
            "Expected 4 messages (system + user1 + assistant + user2), found {}",
            resolved2.messages.len()
        );
    }

    #[tokio::test]
    async fn test_generation_input_messages_not_duplicated_with_assistant_response() {
        // Bug test: When the first message has generation_input_messages,
        // and there's an assistant response, we should get:
        // - generation_input_messages (system + user1 + assistant)
        // - new user message
        // WITHOUT duplicating any messages
        let mut message_repo = MockMessageRepository::new();
        let file_resolver = MockFileResolver::new();
        let prompt_provider = MockPromptProvider::new().with_system_prompt("You are helpful.");

        // First message
        let msg1_id = Uuid::new_v4();
        message_repo.add_message(msg1_id, None, MessageRole::User, "Hello");

        let chat = create_test_chat();
        let config = create_test_chat_provider_config();

        // Build first message request
        let abstract_seq1 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg1_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build first abstract sequence");

        let (resolved1, unresolved1) =
            resolve_sequence(abstract_seq1, &message_repo, &file_resolver)
                .await
                .expect("Failed to resolve first sequence");

        // First message should have: system prompt + user message
        assert_eq!(resolved1.messages.len(), 2);

        // Persist the generation_input_messages for the first message
        message_repo.update_generation_input_messages(msg1_id, &unresolved1);

        // Simulate an assistant response
        let msg2_id = Uuid::new_v4();
        message_repo.add_message(msg2_id, Some(msg1_id), MessageRole::Assistant, "Hi there!");

        // Set generation_input_messages for the assistant message
        // In production, this would contain the full context including the assistant's response
        let mut assistant_messages = resolved1.messages.clone();
        assistant_messages.push(crate::models::message::InputMessage {
            role: MessageRole::Assistant,
            content: crate::models::message::ContentPart::Text(
                crate::models::message::ContentPartText {
                    text: "Hi there!".to_string(),
                },
            ),
        });
        let assistant_gen_input = crate::models::message::GenerationInputMessages {
            messages: assistant_messages,
        };
        message_repo.update_generation_input_messages(msg2_id, &assistant_gen_input);

        // Second message in chat
        let msg3_id = Uuid::new_v4();
        message_repo.add_message(msg3_id, Some(msg2_id), MessageRole::User, "How are you?");

        // Build second message request
        let abstract_seq2 = build_abstract_sequence(
            &message_repo,
            &prompt_provider,
            &chat,
            &msg3_id,
            vec![],
            &config,
            &ExperimentalFacetsConfig::default(),
            &[],
            None,
        )
        .await
        .expect("Failed to build second abstract sequence");

        let (resolved2, _) = resolve_sequence(abstract_seq2, &message_repo, &file_resolver)
            .await
            .expect("Failed to resolve second sequence");

        eprintln!("DEBUG: Second message count: {}", resolved2.messages.len());
        for (i, msg) in resolved2.messages.iter().enumerate() {
            eprintln!(
                "DEBUG: Message {}: role={:?}, content={:?}",
                i, msg.role, msg.content
            );
        }

        // Should have exactly 4 messages total: system + user1 + assistant + user2
        assert_eq!(
            resolved2.messages.len(),
            4,
            "Expected 4 messages (system + user1 + assistant + user2), found {}",
            resolved2.messages.len()
        );

        // Check message order
        assert!(matches!(resolved2.messages[0].role, MessageRole::System));
        assert!(matches!(resolved2.messages[1].role, MessageRole::User));
        assert!(matches!(resolved2.messages[2].role, MessageRole::Assistant));
        assert!(matches!(resolved2.messages[3].role, MessageRole::User));

        // Check content
        match &resolved2.messages[1].content {
            ContentPart::Text(text) => {
                assert_eq!(text.text, "Hello");
            }
            _ => panic!("Expected text content for user1"),
        }

        match &resolved2.messages[2].content {
            ContentPart::Text(text) => {
                assert_eq!(text.text, "Hi there!");
            }
            _ => panic!("Expected text content for assistant"),
        }

        match &resolved2.messages[3].content {
            ContentPart::Text(text) => {
                assert_eq!(text.text, "How are you?");
            }
            _ => panic!("Expected text content for user2"),
        }

        // Count that "Hello" appears only once
        let hello_count = resolved2
            .messages
            .iter()
            .filter(|m| matches!(&m.content, ContentPart::Text(text) if text.text == "Hello"))
            .count();
        assert_eq!(
            hello_count, 1,
            "Expected 'Hello' to appear once, but it appears {} times",
            hello_count
        );
    }
}
