import { describe, expect, it } from "vitest";

import {
  audioTranscriptExcerpt,
  audioTranscriptionDuration,
  audioTranscriptionOutcomeText,
  audioTranscriptionPhase,
  audioTranscriptionTileStatus,
  getDisplayTranscript,
  isAudioTranscriptionComplete,
} from "./audioTranscriptionStatus";

const rec = (audio_transcription?: Record<string, unknown>) => ({
  filename: "audio-recording-20261020-1200.wav",
  ...(audio_transcription ? { audio_transcription } : {}),
});

const chunk = (status: string, endMs: number | null, transcript?: string) => ({
  status,
  end_ms: endMs,
  transcript,
});

describe("audioTranscriptionTileStatus", () => {
  it("is null for a file that is no recording", () => {
    expect(audioTranscriptionTileStatus(rec())).toBeNull();
  });

  it.each([
    ["recording", "recording", true, "Recording…"],
    ["uploading", "uploading", true, "Uploading…"],
    ["transcribing", "transcribing", true, "Transcribing…"],
    ["processing", "transcribing", true, "Transcribing…"],
    ["pending", "transcribing", true, "Transcribing…"],
    ["something-new", "transcribing", true, "Transcribing…"],
    ["COMPLETED", "completed", false, "Transcript ready"],
    ["failed", "failed", false, "Couldn't transcribe"],
    ["canceled", "canceled", false, "Transcription canceled"],
  ])("draws %s as %s", (status, phase, busy, meta) => {
    const result = audioTranscriptionTileStatus(rec({ status }));
    expect(result).toMatchObject({ phase, busy, metaLabel: meta });
    expect(result?.tone).toBe(phase === "failed" ? "error" : undefined);
  });

  it("adds the length the chunks reach, dropping the phase word's ellipsis", () => {
    const chunks = [chunk("completed", 20_000), chunk("pending", 42_300)];
    expect(
      audioTranscriptionTileStatus(rec({ status: "processing", chunks }))
        ?.metaLabel,
    ).toBe("Transcribing · 0:42");
    expect(
      audioTranscriptionTileStatus(rec({ status: "uploading", chunks }))
        ?.metaLabel,
    ).toBe("Uploading · 0:42");
    expect(
      audioTranscriptionTileStatus(rec({ status: "completed", chunks }))
        ?.metaLabel,
    ).toBe("Transcript ready · 0:42");
    // A failure states itself; the error is the title.
    expect(
      audioTranscriptionTileStatus(
        rec({ status: "failed", chunks, error: " Provider timed out. " }),
      ),
    ).toMatchObject({
      metaLabel: "Couldn't transcribe",
      title: "Provider timed out.",
    });
  });

  it("shows the recorded length once the recording stopped, as transcribing", () => {
    const chunks = [chunk("completed", 30_000)];
    expect(
      audioTranscriptionTileStatus(
        rec({ status: "recording", chunks, recorded_duration_ms: 38_290 }),
      ),
    ).toMatchObject({
      phase: "transcribing",
      busy: true,
      metaLabel: "Transcribing · 0:38",
    });
    expect(
      audioTranscriptionTileStatus(
        rec({ status: "completed", chunks, recorded_duration_ms: 38_290 }),
      )?.metaLabel,
    ).toBe("Transcript ready · 0:38");
    expect(
      audioTranscriptionTileStatus(rec({ status: "recording", chunks }))
        ?.metaLabel,
    ).toBe("Recording · 0:30");
  });

  it("counts a running recording by the recorder's clock, not the chunks' 30-second steps", () => {
    const chunks = [chunk("completed", 30_000, "First half.")];
    expect(
      audioTranscriptionTileStatus(
        rec({ status: "recording", chunks, recording_elapsed_ms: 41_400 }),
      ),
    ).toMatchObject({
      phase: "recording",
      busy: true,
      metaLabel: "Recording · 0:41",
    });
    expect(
      audioTranscriptionTileStatus(
        rec({ status: "recording", chunks: [], recording_elapsed_ms: 1_300 }),
      )?.metaLabel,
    ).toBe("Recording · 0:01");
  });

  it("draws the composer's recordings by their first words, uploaded audio by its name", () => {
    const chunks = [
      chunk("completed", 30_000, "Hello team."),
      chunk("completed", 41_000, "Here is the update."),
    ];
    expect(
      audioTranscriptionTileStatus(
        rec({ status: "recording", chunks, recording_elapsed_ms: 44_000 }),
      )?.transcript,
    ).toEqual({
      excerpt: "Hello team. Here is the update.",
      more: {
        label: "More",
        name: "More: audio-recording-20261020-1200.wav",
      },
    });
    expect(
      audioTranscriptionTileStatus(
        rec({
          status: "completed",
          chunks,
          transcript: "Hello team. Here is the update, in full.",
          recorded_duration_ms: 41_000,
        }),
      )?.transcript?.excerpt,
    ).toBe("Hello team. Here is the update, in full.");
    // No words yet: a placeholder holds their place while they may come.
    expect(
      audioTranscriptionTileStatus(
        rec({ status: "recording", chunks: [], recording_elapsed_ms: 3_000 }),
      )?.transcript,
    ).toEqual({ placeholder: "The transcript appears here…" });
    expect(
      audioTranscriptionTileStatus(
        rec({
          status: "transcribing",
          chunks: [],
          recorded_duration_ms: 3_000,
        }),
      )?.transcript,
    ).toEqual({ placeholder: "The transcript appears here…" });
    // Settled without words, the meta line stands alone.
    for (const status of ["completed", "failed", "canceled"]) {
      expect(
        audioTranscriptionTileStatus(
          rec({ status, chunks: [], recorded_duration_ms: 3_000 }),
        )?.transcript,
      ).toEqual({});
    }
    expect(
      audioTranscriptionTileStatus(rec({ status: "completed", chunks }))
        ?.transcript,
    ).toBeUndefined();
  });

  it("offers the cancel only on a busy recording the composer can cancel", () => {
    const cancelable = { retryable: false, retrying: false, cancelable: true };
    expect(
      audioTranscriptionTileStatus(rec({ status: "transcribing" }), cancelable)
        ?.cancel,
    ).toEqual({
      label: "Cancel transcription",
      name: "Cancel transcription: audio-recording-20261020-1200.wav",
    });
    expect(
      audioTranscriptionTileStatus(rec({ status: "transcribing" }))?.cancel,
    ).toBeUndefined();
    for (const status of ["completed", "failed", "canceled"]) {
      expect(
        audioTranscriptionTileStatus(rec({ status }), cancelable)?.cancel,
      ).toBeUndefined();
    }
  });

  it("calls a recording failed once nothing is left to work on and a chunk failed", () => {
    expect(
      audioTranscriptionPhase({
        status: "transcribing",
        chunks: [chunk("failed", 30_000), chunk("completed", 38_000)],
      }),
    ).toBe("failed");
    expect(
      audioTranscriptionPhase({
        status: "transcribing",
        chunks: [chunk("failed", 30_000), chunk("transcribing", 38_000)],
      }),
    ).toBe("transcribing");
    expect(
      audioTranscriptionPhase({
        status: "recording",
        chunks: [chunk("failed", 30_000), chunk("completed", 38_000)],
      }),
    ).toBe("recording");
  });

  it("reads the phase from the chunks when the status is missing", () => {
    expect(
      audioTranscriptionPhase({ chunks: [chunk("completed", 1000)] }),
    ).toBe("completed");
    expect(
      audioTranscriptionPhase({
        chunks: [chunk("completed", 1000), chunk("transcribing", 2000)],
      }),
    ).toBe("transcribing");
    expect(audioTranscriptionPhase({})).toBe("transcribing");
  });

  it("offers a retry only for a failed recording the recorder holds", () => {
    const failed = rec({ status: "failed" });
    expect(
      audioTranscriptionTileStatus(failed, {
        retryable: false,
        retrying: false,
      })?.action,
    ).toBeUndefined();
    expect(
      audioTranscriptionTileStatus(rec({ status: "processing" }), {
        retryable: true,
        retrying: false,
      })?.action,
    ).toBeUndefined();
    expect(
      audioTranscriptionTileStatus(failed, { retryable: true, retrying: false })
        ?.action,
    ).toEqual({
      label: "Retry transcription",
      name: "Retry transcription: audio-recording-20261020-1200.wav",
      disabled: false,
    });
    expect(
      audioTranscriptionTileStatus(failed, { retryable: true, retrying: true })
        ?.action,
    ).toEqual({
      label: "Retrying…",
      name: "Retrying… audio-recording-20261020-1200.wav",
      disabled: true,
    });
    expect(
      audioTranscriptionTileStatus(failed, {
        retryable: true,
        retrying: false,
        locked: true,
      })?.action?.disabled,
    ).toBe(true);
  });
});

describe("audioTranscriptExcerpt", () => {
  it("keeps a short transcript whole, on one line of spaces", () => {
    expect(audioTranscriptExcerpt("  Hello\n  team. ")).toBe("Hello team.");
  });

  it("keeps the first words of a long one, ending at a word", () => {
    const words = Array.from({ length: 80 }, (_, index) => `word${index}`);
    const excerpt = audioTranscriptExcerpt(words.join(" "));
    expect(excerpt.startsWith("word0 word1 ")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(201);
    expect(words).toContain(excerpt.slice(0, -1).split(" ").at(-1));
  });

  it("cuts a single overlong word at the limit", () => {
    expect(audioTranscriptExcerpt("a".repeat(300))).toBe(`${"a".repeat(200)}…`);
  });
});

describe("audioTranscriptionDuration", () => {
  it.each([
    [[chunk("completed", 42_000)], "0:42"],
    [[chunk("completed", 300_000), chunk("pending", 725_400)], "12:05"],
    [[chunk("pending", null)], null],
    [[], null],
  ])("reads %j as %s", (chunks, expected) => {
    expect(audioTranscriptionDuration(chunks)).toBe(expected);
  });
});

describe("transcript and completion", () => {
  it("prefers the transcript, then the completed chunks in order", () => {
    expect(getDisplayTranscript("Whole text.", [])).toBe("Whole text.");
    expect(
      getDisplayTranscript("  ", [
        chunk("completed", 1000, "Hello"),
        chunk("pending", 2000, "ignored"),
        chunk("completed", 3000, "team."),
      ]),
    ).toBe("Hello team.");
    expect(getDisplayTranscript(null, [chunk("pending", 1)])).toBeUndefined();
  });

  it("is complete only once completed", () => {
    expect(isAudioTranscriptionComplete("completed")).toBe(true);
    expect(isAudioTranscriptionComplete("failed")).toBe(false);
    expect(isAudioTranscriptionComplete("canceled")).toBe(false);
    expect(
      isAudioTranscriptionComplete(undefined, [chunk("completed", 1)]),
    ).toBe(true);
    expect(isAudioTranscriptionComplete(undefined, [])).toBe(false);
  });

  it("says only the end states", () => {
    expect(audioTranscriptionOutcomeText("a.wav", "completed")).toBe(
      "a.wav: transcript ready.",
    );
    expect(audioTranscriptionOutcomeText("a.wav", "failed")).toBe(
      "a.wav: couldn't transcribe.",
    );
    expect(audioTranscriptionOutcomeText("a.wav", "canceled")).toBe(
      "a.wav: transcription canceled.",
    );
    expect(audioTranscriptionOutcomeText("a.wav", "transcribing")).toBeNull();
  });
});
