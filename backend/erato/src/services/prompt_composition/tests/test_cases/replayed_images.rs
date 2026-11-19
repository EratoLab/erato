use super::facet_placement::provider_body;
use super::*;
use crate::models::message::ContentPartImage;
use genai::adapter::AdapterKind;

const IMAGE_BASE64: &str = "aW1hZ2UtbWFya2Vy";

fn request_with_image(image_role: MessageRole) -> genai::chat::ChatRequest {
    let text = |text: &str| ContentPart::Text(ContentPartText { text: text.into() });
    let messages = vec![
        InputMessage {
            role: MessageRole::User,
            content: text("Fetch the picture"),
        },
        InputMessage {
            role: image_role.clone(),
            content: text("file name: picture.png"),
        },
        InputMessage {
            role: image_role,
            content: ContentPart::Image(ContentPartImage {
                content_type: "image/png".into(),
                base64_data: IMAGE_BASE64.into(),
            }),
        },
        InputMessage {
            role: MessageRole::User,
            content: text("What does it show?"),
        },
    ];
    GenerationInputMessages { messages }.into_chat_request()
}

// A file a tool returned replays in later turns, and after a parked turn,
// inside the assistant's message. Of the adapters the backend can select,
// only Ollama sends an image from there, so elsewhere the model no longer
// sees it. A change here changes what `ResultDelivery`'s notices may claim.
#[tokio::test]
async fn only_ollama_sends_an_image_replayed_in_an_assistant_message() {
    for kind in [
        AdapterKind::OpenAI,
        AdapterKind::OpenAIResp,
        AdapterKind::Gemini,
        AdapterKind::Ollama,
    ] {
        let as_user = provider_body(kind, request_with_image(MessageRole::User))
            .await
            .to_string();
        assert!(as_user.contains(IMAGE_BASE64), "{kind:?}: {as_user}");

        let replayed = provider_body(kind, request_with_image(MessageRole::Assistant))
            .await
            .to_string();
        assert!(
            replayed.contains("file name: picture.png"),
            "{kind:?}: {replayed}"
        );
        assert_eq!(
            replayed.contains(IMAGE_BASE64),
            kind == AdapterKind::Ollama,
            "{kind:?}: {replayed}"
        );
    }
}
