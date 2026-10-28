use super::*;
/// audio.cpp must have a streaming model configured; its native sample rate is configured explicitly.
pub struct AudioCpp(pub SpeechProviderConfig);
#[async_trait]
impl SpeechProvider for AudioCpp {
    async fn stream(&self, text: &str) -> Result<SpeechAudio, Report> {
        openai::stream_compatible(&self.0, text, true).await
    }
}
