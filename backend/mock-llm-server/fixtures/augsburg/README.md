# Augsburg conversational Audio-back capture

Captured on 2026-10-29 from a German Augsburg-history conversation using
`gemini_3_8_flash` with conversational Audio-back. The stream completed in
234.680 seconds: 36 text deltas and 1,372 audio deltas (222.390 seconds of
24 kHz, mono, signed 16-bit little-endian PCM).

The checked-in fixture is **losslessly compressed**, without a duplicate raw
SSE/WAV or Base64 audio copy:

- `capture.json.gz`: all 1,415 SSE events with original client-receipt timings,
  original chunk receipt offsets/timings, and the capture summary. Chunk offsets
  describe the original SSE bytes, not this normalized JSON representation.
  Runtime UUIDs are replaced and download/preview URLs removed. Authentication,
  request headers, and deployment configuration are not included.
- `audio.flac`: the original PCM, losslessly encoded. Each audio event contains
  `audio_offset` and `audio_length` into decoded PCM instead of Base64 `audio`.
  `pcm_sha256` in the JSON verifies the decoded audio against the capture.

Together these occupy about 6.7 MiB, versus 24 MiB for the raw SSE and WAV.
To inspect the trace: `gzip -dc capture.json.gz`. To obtain the original WAV:
`flac --decode audio.flac`. Never commit the decompressed files.

## Mock projections

`endpoints::augsburg` projects this application-level capture into upstream
services. This is not a recording of the original Google service traffic:

- `/fixtures/augsburg/v1/audio/transcriptions` accepts the microphone upload and
  returns the captured user question. The existing sales-summary microphone WAV
  supplies actual input samples; its spoken words are intentionally not used by
  this deterministic transcription mock.
- `/base-openai/v1/chat/completions` (the existing `Mock-LLM` provider) emits the exact captured text deltas
  every 40 ms. **It does not reproduce the captured 68/73-second text stalls**:
  those resulted from downstream backpressure and must not become mock latency.
- `/fixtures/augsburg/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`
  accepts Gemini Live setup and sequential passages on one connection. Audio
  retains its captured chunks, in order, with inter-chunk timing sped up 20x.
  The first audio starts after a deliberate five-second synthesis delay so a
  regression can assert that text finishes independently of speech.

The capture does not contain upstream synthesis request boundaries. Audio is
therefore assigned to new passages proportionally to their alphanumeric text
length, not by phoneme alignment. This preserves the complete audio bytes for
this response while allowing batching changes without rewriting the fixture.
Each WebSocket has its own cursor, so parallel tests cannot consume one
another's fixture state. Original timings remain available in the JSON for
manual debugging; E2E tests use the accelerated service projections.

The `many-models` scenario configures all three mocked services. The E2E test
checks microphone submission, text/audio ordering, audio completion, persisted
replay after reload, and the absence of a new generation on replay.
