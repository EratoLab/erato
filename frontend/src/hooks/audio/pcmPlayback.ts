import { createLogger } from "@/utils/debugLogger";

import {
  closeShellVoiceAudio,
  createShellVoiceQueue,
  openShellVoiceAudio,
  settledShellVoiceAudio,
  ShellVoiceAudio,
  shellVoiceAudio,
} from "./shellVoiceAudio";
import { reviveStandingClock } from "./useAudioContextInterruptionRecovery";

const logger = createLogger("HOOK", "pcmPlayback");

let context: AudioContext | undefined;
/** Resuming waits for it, or a voice right after unlocking stays silent. */
let revival: Promise<void> | undefined;
/** A suspend or resume that never settles must not hold every voice back. */
const REVIVAL_MAX_MS = 2000;
/**
 * The last revival left the clock standing, at this time. A revival right
 * after unlocking does not always take; the next voices try again, a few
 * times per return to the page.
 */
let standingSince: number | undefined;
const REVIVAL_RETRY_MS = 2000;
const REVIVAL_RETRIES = 5;
let retriesLeft = REVIVAL_RETRIES;
/** Until it settles, past the cap too: two revivals must not overlap. */
let reviving = false;

/**
 * Where speech plays: the page's own context, or the app shell's voice audio
 * while that has the conversation.
 */
export type VoicePlayback = AudioContext | ShellVoiceAudio;

/**
 * Where all speech playback plays: the app shell's voice audio while it has
 * the conversation, otherwise the one AudioContext all speech playback
 * shares. Browsers keep a context suspended until it is resumed from a user
 * gesture, so the first call has to come from a click.
 */
export async function resumePlaybackContext(): Promise<VoicePlayback> {
  const settled = settledShellVoiceAudio();
  const shell = settled instanceof Promise ? await settled : settled;
  if (shell) return shell;
  if (!context) {
    context = new AudioContext();
    reviveOnReturn(context);
  }
  // Before any await: the element may only start within the gesture.
  followMicrophones();
  retryIfStanding(context, 0);
  if (revival) await revival;
  await context.resume();
  return context;
}

/** A tap asks for the voice now; voices arriving on their own wait a gap. */
function retryIfStanding(playback: AudioContext, gapMs = REVIVAL_RETRY_MS) {
  if (
    reviving ||
    playback.state !== "running" ||
    standingSince === undefined ||
    Date.now() - standingSince < gapMs ||
    retriesLeft <= 0
  )
    return;
  retriesLeft -= 1;
  revive(playback);
}

function revive(playback: AudioContext) {
  if (reviving) return;
  reviving = true;
  const settled = reviveStandingClock(playback)
    .then((stands) => {
      standingSince = stands ? Date.now() : undefined;
    })
    .finally(() => {
      reviving = false;
    });
  const capped = Promise.race([
    settled,
    new Promise<void>((resolve) => setTimeout(resolve, REVIVAL_MAX_MS)),
  ]).finally(() => {
    if (revival === capped) revival = undefined;
  });
  revival = capped;
}

/**
 * After a phone lock the context can stay silent for good while it says
 * "running"; every voice, wait line and card plays on this one context.
 */
function reviveOnReturn(playback: AudioContext) {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    retriesLeft = REVIVAL_RETRIES;
    revive(playback);
    followMicrophones();
  });
}

/**
 * The voice as conversation audio: a media stream played in an audio
 * element. Browsers take such streams as the echo canceller's reference;
 * WebKit plays Web Audio's own output past its canceller and only turns it
 * down, so the microphone heard the voice as loud as a person (iPhone 15,
 * iOS 27.2.1, 2026-11-28). Only while a microphone with echo cancellation is
 * open: an element that has played holds a media session that silences other
 * apps' audio, and WebKit kept it after the element paused, so it is released
 * once no such microphone is left. Otherwise, and while the element does not
 * play, the voice plays through the context's own output.
 */
type VoiceStream = {
  node: MediaStreamAudioDestinationNode;
  element: HTMLAudioElement;
  playing: boolean;
};
let stream: VoiceStream | undefined;
let mediaStreamOutput = true;

let shellOutput = true;

/**
 * The deployment's `AUDIO_CONVERSATIONAL_VOICE_MEDIA_STREAM_OUTPUT` and
 * `AUDIO_CONVERSATIONAL_SHELL_VOICE`.
 */
export function configureVoiceOutput(settings: {
  mediaStream?: boolean;
  shellVoice?: boolean;
}) {
  mediaStreamOutput = settings.mediaStream !== false;
  shellOutput = settings.shellVoice !== false;
  followMicrophones();
}

/**
 * A spoken conversation starts: where the app shell offers its voice audio,
 * the conversation's voice and microphone go through it, and the page plays
 * and records nothing of its own until it closes. Called before anything of
 * the conversation plays; null keeps the page's own audio.
 */
export function openConversationAudio(): Promise<ShellVoiceAudio | null> {
  if (!shellOutput) return Promise.resolve(null);
  const opening = openShellVoiceAudio(voiceStart);
  void opening
    .then(async (shell) => {
      if (!shell) return;
      releaseStream();
      // Two owners of the phone's audio interrupt each other.
      if (context?.state === "running") await context.suspend();
    })
    .catch(() => undefined);
  return opening;
}

let conversations = 0;
let closing: ReturnType<typeof setTimeout> | undefined;

/**
 * A composer has the conversation; returns its release. The app shell's
 * voice audio closes once none has it: a composer shown anew for the same
 * conversation takes it on before then.
 */
export function holdConversationAudio(): () => void {
  conversations += 1;
  clearTimeout(closing);
  closing = undefined;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    conversations -= 1;
    if (conversations > 0) return;
    clearTimeout(closing);
    closing = setTimeout(() => {
      closing = undefined;
      if (conversations === 0) closeShellVoiceAudio();
    }, 0);
  };
}

/** Microphones with echo cancellation that may hear the voice. */
const microphones = new Set<MediaStream>();
/** Only releases: a track can also end without the recorder seeing it. */
const MICROPHONE_CHECK_MS = 5000;
let microphoneCheck: ReturnType<typeof setInterval> | undefined;

function microphoneListens(): boolean {
  for (const microphone of microphones)
    if (
      !microphone.getAudioTracks().some((track) => track.readyState === "live")
    )
      microphones.delete(microphone);
  return microphones.size > 0;
}

/**
 * A microphone with echo cancellation is open: the voice plays as
 * conversation audio until {@link voiceNoLongerHeardBy}. Each call tries the
 * element again if the browser had paused it.
 */
export function voiceHeardBy(microphone: MediaStream) {
  microphones.add(microphone);
  microphoneCheck ??= setInterval(() => {
    if (!microphoneListens()) releaseStream();
  }, MICROPHONE_CHECK_MS);
  followMicrophones();
}

export function voiceNoLongerHeardBy(microphone: MediaStream) {
  microphones.delete(microphone);
  followMicrophones();
}

function followMicrophones() {
  if (mediaStreamOutput && !shellVoiceAudio() && microphoneListens()) {
    if (context) playAsStream(context);
    return;
  }
  releaseStream();
}

function playAsStream(playback: AudioContext) {
  if (!stream) {
    if (
      typeof document === "undefined" ||
      typeof playback.createMediaStreamDestination !== "function" ||
      typeof HTMLMediaElement === "undefined" ||
      !("srcObject" in HTMLMediaElement.prototype)
    )
      return;
    let node: MediaStreamAudioDestinationNode;
    try {
      node = playback.createMediaStreamDestination();
    } catch {
      return;
    }
    const element = document.createElement("audio");
    element.srcObject = node.stream;
    const created: VoiceStream = { node, element, playing: false };
    stream = created;
    // The browser pauses it on its own (a call, a lock, its autoplay rules).
    element.addEventListener("pause", () => streamPlays(created, false));
    element.addEventListener("error", () => streamPlays(created, false));
    element.addEventListener("playing", () => streamPlays(created, true));
  }
  const current = stream;
  if (current.playing) return;
  let started: Promise<void> | undefined;
  try {
    started = current.element.play();
  } catch {
    return;
  }
  void Promise.resolve(started).then(
    () => streamPlays(current, !current.element.paused),
    (error: unknown) => {
      logger.log("[VOICE] stream element may not play", error);
      streamPlays(current, false);
    },
  );
}

function streamPlays(current: VoiceStream, playing: boolean) {
  if (stream !== current || current.playing === playing) return;
  current.playing = playing;
  if (!output) return;
  output.disconnect();
  output.connect(voiceSink(output.context));
}

function releaseStream() {
  clearInterval(microphoneCheck);
  microphoneCheck = undefined;
  const released = stream;
  if (!released) return;
  stream = undefined;
  released.element.pause();
  released.element.srcObject = null;
  released.node.stream.getTracks().forEach((track) => track.stop());
  if (released.playing && output) {
    output.disconnect();
    output.connect(voiceSink(output.context));
  }
}

function voiceSink(playback: BaseAudioContext): AudioNode {
  return stream?.playing && stream.node.context === playback
    ? stream.node
    : playback.destination;
}

/** Where speech plays now, once a voice has been unlocked. */
export function playbackContext(): VoicePlayback | undefined {
  return shellVoiceAudio() ?? context;
}

/**
 * Whether audio queued on the context will be heard: it runs, or it is
 * suspended only for a moment while its clock is started again.
 */
export function playbackPlays(
  playback: VoicePlayback | undefined,
): playback is VoicePlayback {
  if (playback === undefined) return false;
  if (playback instanceof ShellVoiceAudio) return playback.state === "running";
  const plays =
    playback.state === "running" ||
    (revival !== undefined && playback === context);
  if (playback === context) retryIfStanding(playback);
  return plays;
}

/** About 10 dB down: still audible, clearly giving way. */
const LOWERED_VOICE_GAIN = 0.3;
let output: GainNode | undefined;

/** Where every voice plays, so that talking over it can lower it. */
function voiceOutput(context: AudioContext): GainNode {
  if (output?.context !== context) {
    output = context.createGain();
    output.connect(voiceSink(context));
  }
  return output;
}

/** Lowers the voice while the user may be starting to talk over it. */
export function lowerVoice(lowered: boolean) {
  const shell = shellVoiceAudio();
  if (shell) {
    shell.lower(lowered);
    return;
  }
  if (!output) return;
  output.gain.setTargetAtTime(
    lowered ? LOWERED_VOICE_GAIN : 1,
    output.context.currentTime,
    0.03,
  );
}

/** How much later than it is played the voice is heard, as far as known. */
export function playbackOutputDelayMs(): number {
  const shell = shellVoiceAudio();
  if (shell) return shell.outputDelayMs;
  // Safari reports no `outputLatency`; no browser reports what the voice's
  // media stream element adds.
  return context
    ? ((Number(context.outputLatency) || 0) +
        (Number(context.baseLatency) || 0)) *
        1000
    : 0;
}

/**
 * A voice that starts from silence waits until this much audio is there.
 * The speech stream sends about 200 ms first, then nothing for 0.3 to 0.7 s:
 * played at once, the first syllable stands alone before a gap.
 */
export const DEFAULT_START_BUFFER_MS = 400;
/**
 * It waits at most this long, so the first sound is never much later than
 * before; whatever has come by then plays. A pause up to this long leaves no
 * gap, a longer one a gap shorter by this much.
 */
export const DEFAULT_START_WAIT_MS = 350;

const voiceStart = {
  bufferMs: DEFAULT_START_BUFFER_MS,
  maxWaitMs: DEFAULT_START_WAIT_MS,
};

/**
 * Sets the start buffer for every voice from here on: the deployment's
 * `voice_start_buffer_ms` and `voice_start_max_wait_ms`. A value outside 0 to
 * 2000 keeps the default.
 */
export function configureVoiceStart(settings: {
  bufferMs?: number;
  maxWaitMs?: number;
}) {
  const inRange = (value: number | undefined, fallback: number) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 2000
      ? value
      : fallback;
  voiceStart.bufferMs = inRange(settings.bufferMs, DEFAULT_START_BUFFER_MS);
  voiceStart.maxWaitMs = inRange(settings.maxWaitMs, DEFAULT_START_WAIT_MS);
}

export interface PcmQueue {
  /**
   * Schedules one chunk of base64 signed 16-bit little-endian mono PCM right
   * after the chunks already queued. Returns false for a chunk that is not
   * valid PCM, without scheduling it. The app shell's voice audio takes the
   * chunk as it is and waits for its own start buffer.
   */
  enqueue(
    context: VoicePlayback,
    audio: string,
    sampleRate: number,
    /** What the voice says from this chunk on, on a passage's first chunk. */
    text?: string,
  ): boolean;
  /** Plays what waits for the start buffer now: nothing more is coming. */
  flush(): void;
  /** Silences and forgets everything queued; `onDrained` is not called. */
  stop(): void;
  /**
   * Silences everything queued like `stop`, and returns the chunks that had
   * not played to their end, the one playing first, to be queued again. On
   * the app shell's voice audio a chunk the shell then reports heard to its
   * end is taken out of the returned list.
   */
  pause(context: VoicePlayback): PcmChunk[];
  /** Whether a chunk is playing, scheduled, or waits for the start buffer. */
  readonly active: boolean;
}

export interface PcmChunk {
  audio: string;
  sampleRate: number;
  text?: string;
}

type OnScheduled = (
  text: string | undefined,
  startsAt: number,
  endsAt: number,
) => void;

/**
 * `onScheduled` hears each chunk as it is scheduled: its text, on a
 * passage's first chunk, and the context times it plays from and to. On the
 * app shell's voice audio it hears each chunk as it starts to be heard.
 */
export function createPcmQueue(
  onDrained: () => void,
  onScheduled?: OnScheduled,
): PcmQueue {
  const drained = () => {
    if (!onContext.active && !onShell.active) onDrained();
  };
  const onContext = createContextQueue(drained, onScheduled);
  const onShell = createShellVoiceQueue(drained, onScheduled);
  return {
    get active() {
      return onContext.active || onShell.active;
    },
    enqueue(playback, audio, sampleRate, text) {
      if (playback instanceof ShellVoiceAudio)
        return onShell.enqueue(playback, { audio, sampleRate, text });
      return onContext.enqueue(playback, audio, sampleRate, text);
    },
    flush() {
      onContext.flush();
    },
    stop() {
      onContext.stop();
      onShell.stop();
    },
    pause(playback) {
      if (playback instanceof ShellVoiceAudio) {
        onContext.stop();
        return onShell.pause();
      }
      onShell.stop();
      return onContext.pause(playback);
    },
  };
}

interface ContextQueue extends Omit<PcmQueue, "enqueue" | "pause"> {
  enqueue(
    context: AudioContext,
    audio: string,
    sampleRate: number,
    text?: string,
  ): boolean;
  pause(context: AudioContext): PcmChunk[];
}

function createContextQueue(
  onDrained: () => void,
  onScheduled?: OnScheduled,
): ContextQueue {
  let nextTime = 0;
  const sources = new Map<
    AudioBufferSourceNode,
    PcmChunk & { endsAt: number }
  >();
  /** Audio held back until the start buffer is full, and its context. */
  let waiting: {
    context: AudioContext;
    chunks: (PcmChunk & { buffer: AudioBuffer })[];
  } | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Nothing has played since the queue was created or stopped: the next
   * audio starts a voice. A voice that only ran dry in the middle goes on at
   * once, as it would without the buffer.
   */
  let fresh = true;

  const schedule = (
    context: AudioContext,
    chunk: PcmChunk & { buffer: AudioBuffer },
  ) => {
    const source = context.createBufferSource();
    source.buffer = chunk.buffer;
    source.connect(voiceOutput(context));
    const start = Math.max(context.currentTime + 0.03, nextTime);
    nextTime = start + chunk.buffer.duration;
    sources.set(source, {
      audio: chunk.audio,
      sampleRate: chunk.sampleRate,
      text: chunk.text,
      endsAt: nextTime,
    });
    onScheduled?.(chunk.text, start, nextTime);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      if (!sources.size && !waiting) onDrained();
    };
    source.start(start);
  };

  const release = () => {
    clearTimeout(waitTimer);
    waitTimer = undefined;
    const held = waiting;
    waiting = null;
    if (!held) return;
    fresh = false;
    for (const chunk of held.chunks) schedule(held.context, chunk);
  };

  const stop = () => {
    clearTimeout(waitTimer);
    waitTimer = undefined;
    waiting = null;
    fresh = true;
    for (const source of sources.keys()) {
      // A stopped source still fires `ended`; it must not report the queue
      // as drained to whatever started playing in the meantime.
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sources.clear();
    nextTime = 0;
  };
  return {
    get active() {
      return sources.size > 0 || waiting !== null;
    },
    enqueue(context, audio, sampleRate, text) {
      const raw = globalThis.atob(audio);
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      if (
        !bytes.length ||
        bytes.length % 2 !== 0 ||
        sampleRate < 8000 ||
        sampleRate > 192000
      )
        return false;
      const view = new DataView(bytes.buffer);
      const buffer = context.createBuffer(1, bytes.length / 2, sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = view.getInt16(i * 2, true) / 32768;
      const chunk = { audio, sampleRate, text, buffer };
      // Playing on, or running dry in the middle: the chunk plays at once.
      if (!waiting && (sources.size > 0 || !fresh)) {
        schedule(context, chunk);
        return true;
      }
      // From silence: wait for enough audio, or until it has had time to come.
      if (!waiting) {
        waiting = { context, chunks: [] };
        waitTimer = setTimeout(release, voiceStart.maxWaitMs);
      }
      waiting.chunks.push(chunk);
      const buffered = waiting.chunks.reduce(
        (sum, held) => sum + held.buffer.duration,
        0,
      );
      if (buffered * 1000 >= voiceStart.bufferMs) release();
      return true;
    },
    flush: release,
    stop,
    pause(context) {
      const unplayed = [...sources.values()]
        .filter((chunk) => chunk.endsAt > context.currentTime)
        .sort((a, b) => a.endsAt - b.endsAt)
        .map(({ audio, sampleRate, text }) => ({ audio, sampleRate, text }));
      const held = (waiting?.chunks ?? []).map(
        ({ audio, sampleRate, text }) => ({ audio, sampleRate, text }),
      );
      stop();
      return [...unplayed, ...held];
    },
  };
}
