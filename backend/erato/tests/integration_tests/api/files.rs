//! File upload and download API tests.

use axum::Router;
use axum::http;
use axum::http::StatusCode;
use axum_test::TestServer;
use axum_test::multipart::{MultipartForm, Part};
use erato::server::router::router;
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    MockLlmConfig, TEST_JWT_TOKEN, TestRequestAuthExt, hermetic_app_config,
    read_integration_test_file_bytes, setup_mock_llm_server,
};

const CANONICAL_AUDIO_SAMPLE_RATE_HZ: usize = 16_000;
const CANONICAL_AUDIO_CHANNELS: usize = 1;
const CANONICAL_AUDIO_BYTES_PER_SAMPLE: usize = 2;
const CANONICAL_WAV_HEADER_BYTES: usize = 44;

fn assert_download_url_contains_filename(download_url: &str, filename: &str) {
    assert!(
        download_url.contains("response-content-disposition="),
        "Download URL should override content disposition: {download_url}"
    );
    assert!(
        download_url.contains(&format!("filename%3D%22{filename}%22")),
        "Download URL should contain the original filename in content disposition: {download_url}"
    );
}

async fn create_chat(server: &TestServer) -> String {
    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({}))
        .await;

    create_chat_response.assert_status_ok();

    let create_chat_json: Value = create_chat_response.json();
    create_chat_json["chat_id"]
        .as_str()
        .expect("Expected chat_id in response")
        .to_string()
}

async fn upload_file_to_chat(
    server: &TestServer,
    chat_id: &str,
    file_bytes: Vec<u8>,
    filename: &str,
    mime_type: &str,
) -> Value {
    let multipart_form = MultipartForm::new().add_part(
        "file",
        Part::bytes(file_bytes)
            .file_name(filename)
            .mime_type(mime_type),
    );

    let upload_response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    upload_response.assert_status_ok();
    upload_response.json()
}

/// Test file upload to a chat.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-file-storage`
///
/// # Test Behavior
/// Verifies that users can upload multiple files to a chat and receive
/// proper response metadata including file IDs and download URLs.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_file_upload_endpoint(pool: Pool<Postgres>) {
    // Set up the test environment
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, create a chat by sending a message
    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for file upload"
    });

    // Send the message to create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response to get the chat ID
    let response_text = response.text();
    let lines: Vec<&str> = response_text.lines().collect();

    // Find the chat_created event and extract the chat ID
    let mut chat_id = String::new();
    for i in 0..lines.len() - 1 {
        if lines[i] == "event: chat_created" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse chat_created data");

                chat_id = data_json["chat_id"]
                    .as_str()
                    .expect("Expected chat_id to be a string")
                    .to_string();

                break;
            }
        }
    }

    assert!(
        !chat_id.is_empty(),
        "Failed to extract chat_id from response"
    );

    // Create temporary JSON files for testing
    let file1_content = json!({
        "name": "test1",
        "value": 123
    })
    .to_string();

    let file2_content = json!({
        "name": "test2",
        "value": 456,
        "nested": {
            "key": "value"
        }
    })
    .to_string();

    // Convert to owned Vec<u8> to satisfy 'static lifetime requirement
    let file1_bytes = file1_content.into_bytes();
    let file2_bytes = file2_content.into_bytes();

    // Create a multipart form with two files using axum_test::multipart
    let multipart_form = MultipartForm::new()
        .add_part(
            "file1",
            Part::bytes(file1_bytes)
                .file_name("test1.json")
                .mime_type("application/json"),
        )
        .add_part(
            "file2",
            Part::bytes(file2_bytes)
                .file_name("test2.json")
                .mime_type("application/json"),
        );

    // Make the request with the chat_id as a query parameter
    let response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Check that we got a response with two files
    let files = response_json["files"].as_array().unwrap();
    assert_eq!(files.len(), 2);

    // Check that each file has an id and filename
    for file in files {
        assert!(file["id"].as_str().is_some());
        assert!(file["filename"].as_str().is_some());

        // Check that the file has a download URL
        let download_url = file["download_url"].as_str().unwrap();
        assert!(!download_url.is_empty(), "Download URL should not be empty");
        assert!(
            download_url.starts_with("http"),
            "Download URL should be a valid URL"
        );

        // Check that the filenames match one of our test files
        let filename = file["filename"].as_str().unwrap();
        assert!(filename == "test1.json" || filename == "test2.json");
        assert_download_url_contains_filename(download_url, filename);
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_file_capabilities_endpoint_includes_email_support(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let response = server
        .get("/api/v1beta/me/file-capabilities")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    response.assert_status_ok();
    let capabilities: Value = response.json();
    let capabilities = capabilities
        .as_array()
        .expect("Expected capabilities array");

    let email_capability = capabilities
        .iter()
        .find(|cap| cap["id"].as_str() == Some("email"))
        .expect("Expected email capability");

    assert_eq!(email_capability["extensions"], json!(["eml"]));
    assert_eq!(email_capability["mime_types"], json!(["message/rfc822"]));
    assert_eq!(email_capability["operations"], json!(["extract_text"]));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_storage_helpers_support_eml_content_type(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let provider = app_state.default_file_storage_provider();
    let file_path = format!("eml-storage-test-{}", Uuid::new_v4());
    let filename = "storage_roundtrip.eml";

    let mut writer = provider
        .upload_file_writer(&file_path, Some("message/rfc822"))
        .await
        .expect("Failed to create upload writer for EML content type");
    writer
        .write(read_integration_test_file_bytes(
            "please_review_attached_draft.eml",
        ))
        .await
        .expect("Failed to write EML fixture to storage");
    writer
        .close()
        .await
        .expect("Failed to finalize EML upload to storage");

    provider
        .generate_presigned_download_url(&file_path, None, Some(filename))
        .await
        .expect("Failed to generate presigned download URL for EML file");
    let content_type = provider
        .get_file_content_type_with_context(&file_path, None)
        .await
        .expect("Failed to fetch stored EML content type");
    assert_eq!(content_type.as_deref(), Some("message/rfc822"));
    provider
        .generate_presigned_preview_url(&file_path, None, Some(filename))
        .await
        .expect("Failed to generate presigned preview URL for EML file");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_seaweedfs_resumable_audio_write_stream_roundtrip_with_resume_copy(
    pool: Pool<Postgres>,
) {
    let mut app_config = hermetic_app_config(None, None);
    app_config.audio_transcription.chunk_duration_seconds = 5;
    let app_state = test_app_state(app_config.clone(), pool).await;
    let provider = app_state.default_file_storage_provider();

    let wav_bytes = read_integration_test_file_bytes("audio_recordings/sales-summary-1-1.wav");
    let data_range = canonical_pcm_data_range(&wav_bytes);

    let chunk_data_bytes = app_config.audio_transcription.chunk_duration_seconds as usize
        * CANONICAL_AUDIO_SAMPLE_RATE_HZ
        * CANONICAL_AUDIO_CHANNELS
        * CANONICAL_AUDIO_BYTES_PER_SAMPLE;
    let data = &wav_bytes[data_range];
    let pcm_chunks = data.chunks(chunk_data_bytes).collect::<Vec<_>>();
    assert!(
        pcm_chunks.len() > 1,
        "Expected configured chunk duration to split fixture into multiple chunks"
    );

    let file_path = format!("audio-resumable-write-test-{}.wav", Uuid::new_v4());
    let interruption_after_chunks = 2usize;
    let mut writer = provider
        .upload_file_writer(&file_path, Some("audio/wav"))
        .await
        .expect("Failed to open initial SeaweedFS audio writer");
    for (chunk_index, pcm_chunk) in pcm_chunks
        .iter()
        .take(interruption_after_chunks)
        .enumerate()
    {
        let write_bytes = if chunk_index == 0 {
            build_canonical_wav_from_pcm(pcm_chunk)
        } else {
            pcm_chunk.to_vec()
        };
        writer
            .write(write_bytes)
            .await
            .expect("Failed to write initial audio chunk to SeaweedFS storage");
    }
    writer
        .close()
        .await
        .expect("Failed to close interrupted SeaweedFS audio writer");

    let committed_bytes = provider
        .read_file_to_bytes(&file_path)
        .await
        .expect("Failed to read committed interrupted audio object");
    assert_eq!(
        committed_bytes.len(),
        CANONICAL_WAV_HEADER_BYTES + chunk_data_bytes * interruption_after_chunks,
        "Committed interrupted object should contain one WAV header plus uploaded PCM chunks"
    );

    let mut resumed_writer = provider
        .upload_file_writer(&file_path, Some("audio/wav"))
        .await
        .expect("Failed to open resumed SeaweedFS audio writer");
    resumed_writer
        .write(committed_bytes)
        .await
        .expect("Failed to seed resumed SeaweedFS audio writer");
    for pcm_chunk in pcm_chunks.iter().skip(interruption_after_chunks) {
        resumed_writer
            .write(pcm_chunk.to_vec())
            .await
            .expect("Failed to write resumed audio chunk to SeaweedFS storage");
    }
    resumed_writer
        .close()
        .await
        .expect("Failed to close resumed SeaweedFS audio writer");

    provider
        .finalize_resumable_upload(&file_path)
        .await
        .expect("Failed to finalize resumable WAV upload");
    let stored_bytes = provider
        .read_file_to_bytes(&file_path)
        .await
        .expect("Failed to read finalized WAV from SeaweedFS storage");
    let expected_bytes = build_canonical_wav_from_pcm(data);
    assert_eq!(
        stored_bytes, expected_bytes,
        "Finalized multi-chunk SeaweedFS object should contain the fixture PCM data as canonical WAV"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_eml_upload_supports_rfc822_and_octet_stream_content_types(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let chat_id = create_chat(&server).await;
    let test_cases = [
        ("message/rfc822", "email_rfc822.eml"),
        ("application/octet-stream", "email_octet_stream.eml"),
        ("text/plain", "email_text_plain.eml"),
    ];

    for (mime_type, filename) in test_cases {
        let upload_json = upload_file_to_chat(
            &server,
            &chat_id,
            read_integration_test_file_bytes("please_review_attached_draft.eml"),
            filename,
            mime_type,
        )
        .await;

        let file = &upload_json["files"][0];
        let file_id = file["id"].as_str().expect("Expected uploaded file id");
        let download_url = file["download_url"]
            .as_str()
            .expect("Expected download URL");

        assert_eq!(file["filename"], json!(filename));
        assert_eq!(file["file_capability"]["id"], json!("email"));
        assert_eq!(
            file["file_capability"]["operations"],
            json!(["extract_text"])
        );
        assert!(
            file["preview_url"].as_str().is_some(),
            "Expected preview URL"
        );
        assert_download_url_contains_filename(download_url, filename);

        let get_file_response = server
            .get(&format!("/api/v1beta/files/{}", file_id))
            .with_bearer_token(TEST_JWT_TOKEN)
            .await;

        get_file_response.assert_status_ok();
        let file_json: Value = get_file_response.json();
        assert_eq!(file_json["filename"], json!(filename));
        assert_eq!(file_json["file_capability"]["id"], json!("email"));
        assert_eq!(
            file_json["file_capability"]["operations"],
            json!(["extract_text"])
        );
        assert!(
            file_json["preview_url"].as_str().is_some(),
            "Expected preview URL"
        );
    }
}

fn canonical_pcm_data_range(bytes: &[u8]) -> std::ops::Range<usize> {
    assert!(bytes.len() >= CANONICAL_WAV_HEADER_BYTES);
    assert_eq!(&bytes[0..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");

    let mut offset = 12usize;
    let mut data_range = None;
    let mut found_fmt = false;
    while offset + 8 <= bytes.len() {
        let chunk_id = &bytes[offset..offset + 4];
        let chunk_len =
            u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let chunk_start = offset + 8;
        let chunk_end = chunk_start + chunk_len;
        assert!(chunk_end <= bytes.len(), "Malformed WAV chunk length");

        if chunk_id == b"fmt " {
            assert_eq!(chunk_len, 16);
            assert_eq!(
                u16::from_le_bytes(bytes[chunk_start..chunk_start + 2].try_into().unwrap()),
                1
            );
            assert_eq!(
                u16::from_le_bytes(bytes[chunk_start + 2..chunk_start + 4].try_into().unwrap()),
                1
            );
            assert_eq!(
                u32::from_le_bytes(bytes[chunk_start + 4..chunk_start + 8].try_into().unwrap()),
                CANONICAL_AUDIO_SAMPLE_RATE_HZ as u32
            );
            assert_eq!(
                u16::from_le_bytes(
                    bytes[chunk_start + 14..chunk_start + 16]
                        .try_into()
                        .unwrap()
                ),
                (CANONICAL_AUDIO_BYTES_PER_SAMPLE * 8) as u16
            );
            found_fmt = true;
        } else if chunk_id == b"data" {
            data_range = Some(chunk_start..chunk_end);
        }

        offset = chunk_end + (chunk_len % 2);
    }

    assert!(found_fmt, "Expected WAV fmt chunk");
    let data_range = data_range.expect("Expected WAV data chunk");
    assert!(
        !data_range.is_empty(),
        "Expected WAV data chunk to contain PCM data"
    );
    data_range
}

fn build_canonical_wav_from_pcm(pcm: &[u8]) -> Vec<u8> {
    let data_len = pcm.len() as u32;
    let byte_rate = CANONICAL_AUDIO_SAMPLE_RATE_HZ as u32
        * CANONICAL_AUDIO_CHANNELS as u32
        * CANONICAL_AUDIO_BYTES_PER_SAMPLE as u32;
    let block_align = (CANONICAL_AUDIO_CHANNELS * CANONICAL_AUDIO_BYTES_PER_SAMPLE) as u16;
    let mut wav = Vec::with_capacity(CANONICAL_WAV_HEADER_BYTES + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&(CANONICAL_AUDIO_CHANNELS as u16).to_le_bytes());
    wav.extend_from_slice(&(CANONICAL_AUDIO_SAMPLE_RATE_HZ as u32).to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&((CANONICAL_AUDIO_BYTES_PER_SAMPLE * 8) as u16).to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(pcm);
    wav
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_audio_upload_initializes_transcription_metadata_with_mock_llm(pool: Pool<Postgres>) {
    let transcript = String::from_utf8(read_integration_test_file_bytes(
        "audio_recordings/sales-summary-1-1.script.md",
    ))
    .expect("Expected valid UTF-8 transcript fixture");
    let mock_config = MockLlmConfig {
        supports_audio_input: true,
        audio_transcription_enabled: true,
        audio_transcription_text: transcript.clone(),
        ..Default::default()
    };
    let (app_config, mock_server) = setup_mock_llm_server(Some(mock_config)).await;

    let transcription_response = reqwest::Client::new()
        .post(mock_server.url("/v1/audio/transcriptions").to_string())
        .multipart(
            reqwest::multipart::Form::new()
                .text("model", "gpt-3.5-turbo")
                .part(
                    "file",
                    reqwest::multipart::Part::bytes(read_integration_test_file_bytes(
                        "audio_recordings/sales-summary-1-1.mp3",
                    ))
                    .file_name("sales-summary-1-1.mp3")
                    .mime_str("audio/mpeg")
                    .expect("Expected valid audio MIME type"),
                ),
        )
        .send()
        .await
        .expect("Mock audio transcription request should succeed");
    assert!(
        transcription_response.status().is_success(),
        "Mock audio transcription endpoint should return success"
    );
    let transcription_json: Value = transcription_response
        .json()
        .await
        .expect("Expected JSON transcription response");
    assert_eq!(transcription_json["text"], json!(transcript));

    let app_state = test_app_state(app_config, pool).await;
    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");
    let chat_id = create_chat(&server).await;

    let upload_json = upload_file_to_chat(
        &server,
        &chat_id,
        read_integration_test_file_bytes("audio_recordings/sales-summary-1-1.mp3"),
        "sales-summary-1-1.mp3",
        "audio/mpeg",
    )
    .await;

    let file = &upload_json["files"][0];
    let file_id = file["id"].as_str().expect("Expected uploaded file id");
    assert_eq!(file["filename"], json!("sales-summary-1-1.mp3"));
    assert_eq!(file["file_capability"]["id"], json!("audio"));
    assert_eq!(
        file["file_capability"]["operations"],
        json!(["extract_text"])
    );
    assert_eq!(file["audio_transcription"]["status"], json!("processing"));
    assert_eq!(file["audio_transcription"]["progress"], json!(0.0));

    let get_file_response = server
        .get(&format!("/api/v1beta/files/{}", file_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    get_file_response.assert_status_ok();
    let file_json: Value = get_file_response.json();
    assert_eq!(
        file_json["audio_transcription"]["status"],
        json!("processing")
    );
    assert_eq!(file_json["audio_transcription"]["progress"], json!(0.0));
}

/// Test retrieving file information by ID.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-file-storage`
///
/// # Test Behavior
/// Verifies that the get file endpoint returns proper file metadata and handles
/// non-existent and invalid file IDs appropriately.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_get_file_by_id(pool: Pool<Postgres>) {
    // Set up the test environment
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, create a chat to attach the file to
    let chat_id = create_chat(&server).await;

    // Create a file to upload
    let file_content = json!({"test": "content"}).to_string();
    let file_bytes = file_content.into_bytes();
    let filename = "test_get_file.json";

    // Create a multipart form with the file
    let multipart_form = MultipartForm::new().add_part(
        "file",
        Part::bytes(file_bytes)
            .file_name(filename)
            .mime_type("application/json"),
    );

    // Upload the file
    let upload_response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    upload_response.assert_status_ok();
    let upload_json: Value = upload_response.json();

    // Get the file ID from the upload response
    let file_id = upload_json["files"][0]["id"]
        .as_str()
        .expect("Expected file id in response");

    // Test 1: Get file with valid ID
    let get_file_response = server
        .get(&format!("/api/v1beta/files/{}", file_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    get_file_response.assert_status_ok();
    let file_json: Value = get_file_response.json();

    // Verify the response has the correct file information
    assert_eq!(file_json["id"].as_str().unwrap(), file_id);
    assert_eq!(file_json["filename"].as_str().unwrap(), filename);

    // Verify the download URL is present and valid
    let download_url = file_json["download_url"].as_str().unwrap();
    assert!(!download_url.is_empty(), "Download URL should not be empty");
    assert!(
        download_url.starts_with("http"),
        "Download URL should be a valid URL"
    );
    assert_download_url_contains_filename(download_url, filename);

    // Test 2: Get file with non-existent ID
    let nonexistent_id = Uuid::new_v4().to_string();
    let get_nonexistent_response = server
        .get(&format!("/api/v1beta/files/{}", nonexistent_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 404 Not Found
    assert_eq!(
        get_nonexistent_response.status_code(),
        StatusCode::NOT_FOUND
    );

    // Test 3: Get file with invalid ID format
    let invalid_id = "not-a-uuid";
    let get_invalid_response = server
        .get(&format!("/api/v1beta/files/{}", invalid_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 400 Bad Request
    assert_eq!(get_invalid_response.status_code(), StatusCode::BAD_REQUEST);
}

/// Test the complete chat creation, file upload, and message flow.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-file-storage`
/// - `e2e-flow`
/// - `sse-streaming`
///
/// # Test Behavior
/// Verifies the end-to-end flow of creating a chat, uploading a file, and
/// submitting a message with the file attached, ensuring all events are
/// properly emitted and the message is saved with the file reference.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_create_chat_file_upload_message_flow(pool: Pool<Postgres>) {
    // Set up the test environment
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Step 1: Create a new chat without initial message
    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({}))
        .await;

    // Verify the response status is OK
    create_chat_response.assert_status_ok();

    let create_chat_json: Value = create_chat_response.json();
    let chat_id = create_chat_json["chat_id"]
        .as_str()
        .expect("Expected chat_id in response");

    assert!(
        !chat_id.is_empty(),
        "Failed to extract chat_id from response"
    );

    // Step 2: Upload a file for the chat
    // Create test file content
    let file_content = json!({
        "name": "test_document",
        "content": "This is a test file for the chat message flow."
    })
    .to_string();

    // Convert to owned Vec<u8> to satisfy 'static lifetime requirement
    let file_bytes = file_content.into_bytes();

    // Create a multipart form with the file
    let multipart_form = MultipartForm::new().add_part(
        "file",
        Part::bytes(file_bytes)
            .file_name("test_document.json")
            .mime_type("application/json"),
    );

    // Make the request with the chat_id as a query parameter
    let upload_response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    // Verify the response
    upload_response.assert_status_ok();
    let upload_json: Value = upload_response.json();

    // Check that we got a response with one file
    let files = upload_json["files"]
        .as_array()
        .expect("Expected files array in response");
    assert_eq!(files.len(), 1);

    // Get the file ID
    let file_id = files[0]["id"]
        .as_str()
        .expect("Expected file id in response");
    assert!(!file_id.is_empty());

    // Step 3: Send a message to the chat with the file attached
    let message_request = json!({
        "existing_chat_id": chat_id,
        "user_message": "Here's a test file I'm sending",
        "input_files_ids": [file_id]
    });

    let message_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    message_response.assert_status_ok();

    // Collect and analyze SSE messages
    let response_text = message_response.text();
    let lines: Vec<&str> = response_text.lines().collect();

    // Helper to parse SSE events
    let has_event = |event_type: &str| {
        lines
            .windows(2)
            .any(|w| w[0] == format!("event: {}", event_type) && w[1].starts_with("data: "))
    };

    // We should NOT see a chat_created event (since we used an existing chat)
    assert!(
        !has_event("chat_created"),
        "Should not have a chat_created event"
    );

    // We should see a user_message_saved event
    assert!(
        has_event("user_message_saved"),
        "Missing user_message_saved event"
    );

    // We should see a message_complete event for the assistant's response
    assert!(
        has_event("assistant_message_completed"),
        "Missing assistant_message_completed event"
    );

    // Step 4: Verify we can retrieve the chat messages with the API
    let messages_response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    messages_response.assert_status_ok();
    let messages_json: Value = messages_response.json();

    // Check we have both the user and assistant messages
    let message_list = messages_json["messages"]
        .as_array()
        .expect("Expected messages array");
    assert_eq!(
        message_list.len(),
        2,
        "Should have user and assistant messages"
    );
}

/// Test file upload with SharePoint integration enabled.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-file-storage`
/// - `sharepoint-integration`
///
/// # Test Behavior
/// Verifies that file uploads work correctly when SharePoint integration is enabled.
/// This tests that the default file storage provider can still be determined correctly
/// even when the SharePoint file storage provider is registered in the background.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_file_upload_with_sharepoint_enabled(pool: Pool<Postgres>) {
    // Set up the test environment with SharePoint integration enabled
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = crate::test_app_state_with_sharepoint(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, create a chat by sending a message
    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for file upload"
    });

    // Send the message to create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response to get the chat ID
    let response_text = response.text();
    let lines: Vec<&str> = response_text.lines().collect();

    // Find the chat_created event and extract the chat ID
    let mut chat_id = String::new();
    for i in 0..lines.len() - 1 {
        if lines[i] == "event: chat_created" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse chat_created data");

                chat_id = data_json["chat_id"]
                    .as_str()
                    .expect("Expected chat_id to be a string")
                    .to_string();

                break;
            }
        }
    }

    assert!(
        !chat_id.is_empty(),
        "Failed to extract chat_id from response"
    );

    // Create a test file for upload
    let file_content = json!({
        "name": "test_with_sharepoint",
        "value": 789
    })
    .to_string();

    let file_bytes = file_content.into_bytes();

    // Create a multipart form with the file
    let multipart_form = MultipartForm::new().add_part(
        "file",
        Part::bytes(file_bytes)
            .file_name("test_sharepoint.json")
            .mime_type("application/json"),
    );

    // Make the request with the chat_id as a query parameter
    let response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    // Verify the response - this should succeed even with SharePoint integration enabled
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Check that we got a response with one file
    let files = response_json["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);

    // Check that the file has an id and filename
    let file = &files[0];
    assert!(file["id"].as_str().is_some());
    assert_eq!(file["filename"].as_str().unwrap(), "test_sharepoint.json");

    // Check that the file has a download URL
    let download_url = file["download_url"].as_str().unwrap();
    assert!(!download_url.is_empty(), "Download URL should not be empty");
    assert!(
        download_url.starts_with("http"),
        "Download URL should be a valid URL"
    );
}
