import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createCanonicalWavBytesFromPcm,
  resampleMonoFloat32ToPcm16,
} from "@/hooks/audio/audio-pcm-codec";
import {
  analyzeMicQuality,
  type MicQualityAssessment,
  type MicQualityIssue,
} from "@/hooks/audio/micQualityAnalysis";
import { transcribeClipOnce } from "@/hooks/audio/transcribeClipOnce";
import { useGuidedAudioCapture } from "@/hooks/audio/useGuidedAudioCapture";

import { ClipWaveform } from "./ClipWaveform";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";

interface GuidedMicCheckProps {
  /** Selected device id; "" means the browser's default microphone. */
  deviceId: string;
  /**
   * False when the panel is not visible (dialog closed or another tab
   * active). Forwarded to the capture hook to release the microphone.
   */
  isAvailable: boolean;
}

type VerdictTone = "good" | "fair" | "poor";

/** Localized read-aloud sentence — sibilant/fricative-rich for clipping + bandwidth. */
function useReadAloudSentence(): string {
  return t({
    id: "preferences.dialog.audio.miccheck.sentence",
    message:
      "She sells fresh fish and chips by the sunny seashore each Saturday.",
  });
}

function verdictLabel(tone: VerdictTone): string {
  switch (tone) {
    case "good":
      return t({ id: "preferences.dialog.audio.miccheck.verdict.good", message: "Good" });
    case "fair":
      return t({ id: "preferences.dialog.audio.miccheck.verdict.fair", message: "Fair" });
    case "poor":
      return t({ id: "preferences.dialog.audio.miccheck.verdict.poor", message: "Poor" });
  }
}

/** Plain-language headline + concrete fix for the single primary issue. */
function issueCopy(issue: MicQualityIssue | null): {
  headline: string;
  fix: string;
} {
  switch (issue) {
    case "clipping":
      return {
        headline: t({
          id: "preferences.dialog.audio.miccheck.issue.clipping.headline",
          message: "Your microphone is too loud and distorting.",
        }),
        fix: t({
          id: "preferences.dialog.audio.miccheck.issue.clipping.fix",
          message:
            "Lower the input level or move back a little. Distortion can make dictation less accurate.",
        }),
      };
    case "background-noise":
      return {
        headline: t({
          id: "preferences.dialog.audio.miccheck.issue.noise.headline",
          message: "Background noise is high.",
        }),
        fix: t({
          id: "preferences.dialog.audio.miccheck.issue.noise.fix",
          message:
            "Try a quieter room or a headset. This can make dictation less accurate.",
        }),
      };
    case "low-level":
      return {
        headline: t({
          id: "preferences.dialog.audio.miccheck.issue.level.headline",
          message: "Your microphone is very quiet.",
        }),
        fix: t({
          id: "preferences.dialog.audio.miccheck.issue.level.fix",
          message:
            "Move closer or raise the input level so dictation can hear you clearly.",
        }),
      };
    case null:
      return {
        headline: t({
          id: "preferences.dialog.audio.miccheck.issue.none.headline",
          message: "Your microphone sounds good.",
        }),
        fix: t({
          id: "preferences.dialog.audio.miccheck.issue.none.fix",
          message: "Clear audio with low background noise — good for dictation.",
        }),
      };
  }
}

const TONE_CLASSES: Record<VerdictTone, string> = {
  good: "bg-[var(--theme-success-bg)] border-[var(--theme-success-border)] text-[var(--theme-success-fg)]",
  fair: "bg-[var(--theme-warning-bg)] border-[var(--theme-warning-border)] text-[var(--theme-warning-fg)]",
  poor: "bg-[var(--theme-error-bg)] border-[var(--theme-error-border)] text-[var(--theme-error-fg)]",
};

const TONE_DOT: Record<VerdictTone, string> = {
  good: "bg-[var(--theme-success-fg)]",
  fair: "bg-[var(--theme-warning-fg)]",
  poor: "bg-[var(--theme-error-fg)]",
};

/** SVG progress ring with the whole-second countdown in the center. */
function CountdownRing({
  seconds,
  progress,
}: {
  seconds: number;
  progress: number;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, progress)));
  return (
    <span
      className="relative inline-flex size-16 items-center justify-center"
      role="timer"
      aria-live="off"
    >
      <svg className="size-16 -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="var(--theme-fg-muted)"
          strokeOpacity="0.25"
          strokeWidth="4"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="var(--theme-fg-accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="absolute text-lg font-semibold text-theme-fg-primary">
        {seconds}
      </span>
    </span>
  );
}

export function GuidedMicCheck({ deviceId, isAvailable }: GuidedMicCheckProps) {
  const sentence = useReadAloudSentence();

  const capture = useGuidedAudioCapture({ deviceId, enabled: isAvailable });
  const { result } = capture;

  // Slices reused by analysis, replay, and transcription.
  const speechSamples = useMemo(() => {
    if (!result) {
      return null;
    }
    return result.samples.subarray(
      result.speechRange.startSample,
      result.speechRange.endSample,
    );
  }, [result]);

  const assessment = useMemo<MicQualityAssessment | null>(() => {
    if (!result || !speechSamples) {
      return null;
    }
    const quietSamples = result.samples.subarray(
      result.quietRange.startSample,
      result.quietRange.endSample,
    );
    return analyzeMicQuality({
      quietSamples,
      speechSamples,
      sampleRate: result.sampleRate,
    });
  }, [result, speechSamples]);

  // Replay WAV blob for the captured speech.
  const replayUrl = useMemo(() => {
    if (!result || !speechSamples || speechSamples.length === 0) {
      return null;
    }
    const pcm = resampleMonoFloat32ToPcm16(speechSamples, result.sampleRate);
    const wav = createCanonicalWavBytesFromPcm(pcm);
    // MIME type — programmatic, not user-facing.
    // eslint-disable-next-line lingui/no-unlocalized-strings
    const blob = new Blob([wav], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  }, [result, speechSamples]);

  useEffect(() => {
    return () => {
      if (replayUrl) {
        URL.revokeObjectURL(replayUrl);
      }
    };
  }, [replayUrl]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState<number | null>(null);

  const stopProgressLoop = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => stopProgressLoop, [stopProgressLoop]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    const tick = () => {
      const audio = audioRef.current;
      if (audio && audio.duration > 0) {
        setPlayProgress(audio.currentTime / audio.duration);
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }, []);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    stopProgressLoop();
    setPlayProgress(null);
  }, [stopProgressLoop]);

  // Transcript proof (display-only, explicit action).
  const [transcriptStatus, setTranscriptStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const transcriptAbortRef = useRef<AbortController | null>(null);

  // Reset transient UI whenever a fresh capture result arrives or clears.
  useEffect(() => {
    handleStop();
    setTranscriptStatus("idle");
    setTranscriptText("");
    setTranscriptError(null);
    transcriptAbortRef.current?.abort();
    transcriptAbortRef.current = null;
  }, [result, handleStop]);

  useEffect(() => {
    return () => transcriptAbortRef.current?.abort();
  }, []);

  const checkTranscript = useCallback(async () => {
    if (!result || !speechSamples) {
      return;
    }
    transcriptAbortRef.current?.abort();
    const controller = new AbortController();
    transcriptAbortRef.current = controller;
    setTranscriptStatus("loading");
    setTranscriptError(null);
    try {
      const transcript = await transcribeClipOnce({
        samples: speechSamples,
        sampleRate: result.sampleRate,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      setTranscriptText(transcript);
      setTranscriptStatus("done");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setTranscriptError(
        error instanceof Error
          ? error.message
          : t`Could not transcribe the clip.`,
      );
      setTranscriptStatus("error");
    }
  }, [result, speechSamples]);

  const privacyNote = t({
    id: "preferences.dialog.audio.miccheck.privacy",
    message:
      "This recording stays on your device. The only thing sent is the short clip you choose to check, and it isn't stored.",
  });

  // ---- Render ----

  if (capture.phase === "error") {
    return (
      <div className="space-y-3" data-testid="mic-check-panel">
        <Alert type="error" data-testid="mic-check-error">
          {capture.error}
        </Alert>
        <Button variant="secondary" size="sm" onClick={capture.start}>
          {t({
            id: "preferences.dialog.audio.miccheck.retry",
            message: "Try again",
          })}
        </Button>
      </div>
    );
  }

  if (capture.phase === "preparing") {
    return (
      <div className="space-y-3" data-testid="mic-check-panel">
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.audio.miccheck.preparing",
            message: "Getting ready…",
          })}
        </p>
      </div>
    );
  }

  if (capture.phase === "quiet" || capture.phase === "reading") {
    const isReading = capture.phase === "reading";
    return (
      <div
        className="flex flex-col items-center gap-3 py-2 text-center"
        data-testid="mic-check-panel"
      >
        <CountdownRing
          seconds={capture.secondsRemaining}
          progress={capture.phaseProgress}
        />
        {isReading ? (
          <>
            <p className="text-sm font-medium text-theme-fg-primary">
              {t({
                id: "preferences.dialog.audio.miccheck.read.instruction",
                message: "Read this aloud:",
              })}
            </p>
            <p
              className="max-w-sm text-base font-medium text-theme-fg-primary"
              data-testid="mic-check-read-sentence"
            >
              {sentence}
            </p>
          </>
        ) : (
          <p className="text-sm font-medium text-theme-fg-primary">
            {t({
              id: "preferences.dialog.audio.miccheck.quiet.instruction",
              message: "Stay quiet for a moment…",
            })}
          </p>
        )}
        <Button variant="secondary" size="sm" onClick={capture.cancel}>
          {t({
            id: "preferences.dialog.audio.miccheck.cancel",
            message: "Cancel",
          })}
        </Button>
      </div>
    );
  }

  if (capture.phase === "complete" && result && assessment) {
    const tone: VerdictTone = assessment.verdict;
    const copy = issueCopy(assessment.primaryIssue);
    return (
      <div className="space-y-4" data-testid="mic-check-panel">
        {/* Traffic-light verdict (acoustic metrics only). */}
        <div
          className={clsx(
            "flex items-start gap-3 rounded-[var(--theme-radius-input)] border p-3",
            TONE_CLASSES[tone],
          )}
          data-testid="mic-check-verdict"
          data-verdict={tone}
        >
          <span
            className={clsx("mt-1 size-3 shrink-0 rounded-full", TONE_DOT[tone])}
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              {verdictLabel(tone)} — {copy.headline}
            </p>
            <p className="text-sm">{copy.fix}</p>
          </div>
        </div>

        {/* Replay with clip markers. */}
        {replayUrl ? (
          <div className="space-y-2">
            <ClipWaveform
              samples={speechSamples ?? new Float32Array(0)}
              clipEvents={assessment.metrics.clipping.events}
              progress={isPlaying ? playProgress : null}
            />
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={togglePlayback}>
                {isPlaying
                  ? t({
                      id: "preferences.dialog.audio.miccheck.replay.pause",
                      message: "Pause",
                    })
                  : t({
                      id: "preferences.dialog.audio.miccheck.replay.play",
                      message: "Hear yourself",
                    })}
              </Button>
              {assessment.metrics.clipping.events.length > 0 ? (
                <span className="text-xs text-theme-fg-muted">
                  {t({
                    id: "preferences.dialog.audio.miccheck.replay.clipmarkers",
                    message: "Red marks show where the audio distorted.",
                  })}
                </span>
              ) : null}
            </div>
            <audio
              ref={audioRef}
              src={replayUrl}
              onPlay={handlePlay}
              onPause={handleStop}
              onEnded={handleStop}
              className="hidden"
            >
              {/* User's own mic recording — no captions exist for it. */}
              <track kind="captions" />
            </audio>
          </div>
        ) : null}

        {/* Transcript proof — display only. */}
        <div className="space-y-2">
          {transcriptStatus === "idle" ? (
            <Button variant="secondary" size="sm" onClick={() => void checkTranscript()}>
              {t({
                id: "preferences.dialog.audio.miccheck.transcript.check",
                message: "Check what we heard",
              })}
            </Button>
          ) : null}
          {transcriptStatus === "loading" ? (
            <p className="text-sm text-theme-fg-secondary">
              {t({
                id: "preferences.dialog.audio.miccheck.transcript.loading",
                message: "Transcribing…",
              })}
            </p>
          ) : null}
          {transcriptStatus === "error" ? (
            <Alert type="warning">{transcriptError}</Alert>
          ) : null}
          {transcriptStatus === "done" ? (
            <div
              className="space-y-1 rounded-[var(--theme-radius-input)] border border-[var(--theme-border-subtle)] p-3"
              data-testid="mic-check-transcript"
            >
              <p className="text-sm text-theme-fg-secondary">
                <span className="font-medium text-theme-fg-primary">
                  {t({
                    id: "preferences.dialog.audio.miccheck.transcript.read",
                    message: "You read:",
                  })}
                </span>{" "}
                {sentence}
              </p>
              <p className="text-sm text-theme-fg-secondary">
                <span className="font-medium text-theme-fg-primary">
                  {t({
                    id: "preferences.dialog.audio.miccheck.transcript.heard",
                    message: "We heard:",
                  })}
                </span>{" "}
                {transcriptText
                  ? transcriptText
                  : t({
                      id: "preferences.dialog.audio.miccheck.transcript.empty",
                      message:
                        "(We couldn't make out clear speech — this doesn't necessarily mean your mic is bad.)",
                    })}
              </p>
            </div>
          ) : null}
        </div>

        <Button variant="secondary" size="sm" onClick={capture.start}>
          {t({
            id: "preferences.dialog.audio.miccheck.again",
            message: "Run again",
          })}
        </Button>
      </div>
    );
  }

  // idle
  return (
    <div className="space-y-3" data-testid="mic-check-panel">
      <p className="text-sm text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.audio.miccheck.intro",
          message:
            "Run a quick check: stay quiet briefly, then read one short sentence aloud. Takes about 10 seconds.",
        })}
      </p>
      <p className="text-xs text-theme-fg-muted">{privacyNote}</p>
      <Button
        variant="primary"
        size="sm"
        onClick={capture.start}
        disabled={!isAvailable}
        data-testid="mic-check-start"
      >
        {t({
          id: "preferences.dialog.audio.miccheck.start",
          message: "Check microphone quality",
        })}
      </Button>
    </div>
  );
}
