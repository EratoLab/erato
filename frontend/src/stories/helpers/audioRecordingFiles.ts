import type {
  FileCapability,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const audioCapability: FileCapability = {
  id: "audio",
  extensions: ["wav"],
  mime_types: ["audio/wav"],
  operations: [],
};

/** 42 seconds recorded, so the tile reads "Transcribing · 0:42". */
const chunks = (status: string, transcript?: string) => [
  { index: 0, status, end_ms: 42_000, ...(transcript ? { transcript } : {}) },
];

export const AUDIO_STORY_TRANSCRIPT =
  "Quick summary of the sales call: the customer wants delivery in two batches, the first before the end of the quarter, and asks for 45 days payment terms instead of 30.";

export const AUDIO_STORY_PARTIAL_TRANSCRIPT =
  "Quick summary of the sales call: the customer wants delivery in two batches.";

/** What the API reports for a staged recording, one per phase. */
export const AUDIO_STORY_TRANSCRIPTIONS = {
  recording: { status: "recording", chunks: chunks("recording") },
  uploading: { status: "uploading", chunks: chunks("uploading") },
  transcribing: { status: "transcribing", chunks: chunks("processing") },
  completed: {
    status: "completed",
    transcript: AUDIO_STORY_TRANSCRIPT,
    chunks: chunks("completed", AUDIO_STORY_TRANSCRIPT),
  },
  failed: {
    status: "failed",
    error: "The transcription service did not answer in time.",
    chunks: chunks("failed"),
  },
  canceled: { status: "canceled", chunks: chunks("canceled") },
  /**
   * Stopped at 0:38 while the server has only taken up the first 30 s: the
   * composer adds the length the recorder measured.
   */
  stopped: {
    status: "recording",
    transcript: AUDIO_STORY_PARTIAL_TRANSCRIPT,
    chunks: [
      {
        index: 0,
        status: "completed",
        end_ms: 30_000,
        transcript: AUDIO_STORY_PARTIAL_TRANSCRIPT,
      },
    ],
    recorded_duration_ms: 38_000,
  },
} as const;

export type AudioStoryPhase = keyof typeof AUDIO_STORY_TRANSCRIPTIONS;

/** A staged recording as the composer holds it after the upload. */
export const recordingFile = (
  id: string,
  phase: AudioStoryPhase,
  filename = "audio-recording-20261020-0942.wav",
): FileUploadItem =>
  ({
    id,
    filename,
    download_url: `https://example.com/${id}`,
    file_contents_unavailable_missing_permissions: false,
    is_sharepoint_file: false,
    file_capability: audioCapability,
    audio_transcription: AUDIO_STORY_TRANSCRIPTIONS[phase],
  }) as unknown as FileUploadItem;
