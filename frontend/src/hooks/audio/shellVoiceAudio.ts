/* eslint-disable lingui/no-unlocalized-strings -- the contract's capability, method and event names */
import { registerWorkInProgress } from "@/lib/chunkLoadRecovery";
import { hostShellWithCapability } from "@/lib/hostShell";
import { createLogger } from "@/utils/debugLogger";

import {
  CANONICAL_AUDIO_SAMPLE_RATE_HZ,
  decodePcm16,
  isPlayablePcm16,
  padPcm16,
  pcm16Bytes,
} from "./audio-pcm-codec";

import type { OnScheduled, PcmChunk } from "./pcmPlayback";
import type { HostShell } from "@/lib/hostShell";

const logger = createLogger("HOOK", "shellVoiceAudio");

const CAPABILITY = "voiceAudio";
/** The largest piece the shell plays. */
const MAX_PIECE_BYTES = 960_000;
/** A system buffer counted at most, and the frame gaps it is measured over. */
const MAX_BUFFER_MS = 100;
const BUFFER_GAPS = 8;

/** One frame of the processed microphone. */
export interface ShellVoiceInput {
  samples: Float32Array;
  /**
   * When the shell received the system buffer that completed the frame, in
   * Unix ms; the sound is older by `inputDelayMs` and up to one such buffer.
   */
  at: number;
}

interface Owner {
  /** Handed to the shell and not yet heard to their end, in play order. */
  pieces: Piece[];
  onDrained: () => void;
  onScheduled?: OnScheduled;
  pauses: number;
  /** Of the last pause's pieces, what the shell heard to its end, in order. */
  heard: { pause: number; audio: string[] } | null;
  /** The passage the next piece goes on with, and its audio so far. */
  passage: { text: string; seconds: number } | null;
}

interface Piece {
  id: string;
  chunk: PcmChunk;
  /** What the shell is sent: a piece too short for it ends in silence. */
  audio: string;
  seconds: number;
  owner: Owner;
  /** The owner's pause it was queued after. */
  pause: number;
  /** The passage it belongs to, and where in it it starts. */
  passage: { text: string; offset: number } | null;
  sent: boolean;
  logged: boolean;
}

const record = (payload: unknown): Record<string, unknown> =>
  typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

let line: Promise<unknown> = Promise.resolve();
/** Across sessions: a late event of an earlier one names no piece of this. */
let serial = 0;
/**
 * Runs `step` once every earlier voiceAudio request has been answered and
 * handled: the shell may handle requests sent together in any order.
 */
function inLine<T>(step: () => Promise<T>): Promise<T> {
  const turn = line.then(step);
  line = turn.catch(() => undefined);
  return turn;
}

/**
 * A spoken conversation's voice and microphone in the app shell's audio
 * engine (`voiceAudio: 1`), which cancels the voice's echo with the voice
 * itself as reference. The page keeps the conversation: when to listen, what
 * counts as speech, what to play. Times are seconds on the clock of the
 * shell's `at` values, Unix time, so that the said log and a pause compare.
 */
export class ShellVoiceAudio {
  state: "running" | "closed" = "running";
  /** Another app or a call has the audio; the shell keeps the voice queued. */
  interrupted = false;
  /** Closed by the shell for a reason after which it may open again at once. */
  reopens = false;
  /** How long a system buffer of the microphone is, as its frames show. */
  bufferMs: number;
  sampleRate = CANONICAL_AUDIO_SAMPLE_RATE_HZ;
  frameSamples = 512;
  outputDelayMs = 0;
  inputDelayMs = 0;
  private readonly pieces = new Map<string, Piece>();
  private readonly inputs = new Set<(input: ShellVoiceInput) => void>();
  private readonly watchers = new Set<() => void>();
  private detach: (() => void)[] = [];
  private lastInputAt: number | undefined;
  private readonly gaps: number[] = [];

  constructor(private readonly shell: HostShell) {
    this.bufferMs = (this.frameSamples / this.sampleRate) * 1000;
  }

  /** Now, on the clock the shell's events give. */
  get currentTime(): number {
    return Date.now() / 1000;
  }

  /**
   * Starts the engine; false when the shell would not. It hears the shell's
   * events from its own turn on, so that a `closed` of the engine closed
   * before it is not taken for its own.
   */
  async open(start: { bufferMs: number; maxWaitMs: number }): Promise<boolean> {
    const answer = await inLine(async () => {
      if (this.state === "closed") return undefined;
      this.listen();
      return this.request("open", {
        startBufferMs: start.bufferMs,
        startMaxWaitMs: start.maxWaitMs,
      });
    });
    if (answer === undefined) return false;
    const opened = record(answer);
    this.sampleRate = finite(opened.sampleRate) ?? this.sampleRate;
    this.frameSamples = finite(opened.frameSamples) ?? this.frameSamples;
    this.routed(opened);
    return true;
  }

  /** The microphone's frames, from now on. Returns the unsubscribe. */
  onInput(listener: (input: ShellVoiceInput) => void): () => void {
    this.inputs.add(listener);
    return () => this.inputs.delete(listener);
  }

  /** Hears an interruption, its end, and a close by the shell. */
  onStateChange(listener: () => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  lower(lowered: boolean) {
    if (this.state === "running") quietly(this.ask("lower", { lowered }));
  }

  /** What is queued plays now, without waiting for the start buffer. */
  flush() {
    if (this.state === "running") quietly(this.ask("flush"));
  }

  /** Queues `chunk` for `owner`; false for a piece the shell would refuse. */
  queue(owner: Owner, chunk: PcmChunk): boolean {
    const bytes = pcm16Bytes(chunk.audio);
    if (
      this.state === "closed" ||
      bytes > MAX_PIECE_BYTES ||
      !isPlayablePcm16(chunk.audio, chunk.sampleRate)
    )
      return false;
    const minSamples = Math.ceil(chunk.sampleRate / 100);
    const seconds = bytes / 2 / chunk.sampleRate;
    if (chunk.text !== undefined)
      owner.passage = { text: chunk.text, seconds: 0 };
    const passage = owner.passage && {
      text: owner.passage.text,
      offset: owner.passage.seconds,
    };
    if (owner.passage) owner.passage.seconds += seconds;
    const piece: Piece = {
      id: "",
      chunk,
      audio:
        bytes / 2 < minSamples
          ? padPcm16(chunk.audio, minSamples)
          : chunk.audio,
      seconds,
      owner,
      pause: owner.pauses,
      passage,
      sent: false,
      logged: false,
    };
    owner.pieces.push(piece);
    this.play(piece);
    return true;
  }

  /**
   * Silences what `owner` queued and returns it, the piece playing first.
   * After a pause, what the shell answers it heard to its end meanwhile is
   * not played again when it comes back; what the stop silenced of other
   * owners plays again before anything queued after the stop.
   */
  silence(owner: Owner, pausing: boolean): PcmChunk[] {
    const stopped = owner.pieces;
    if (stopped.length === 0) return [];
    owner.pieces = [];
    owner.pauses += 1;
    owner.heard = null;
    const first = stopped[0].passage;
    owner.passage = first && { text: first.text, seconds: first.offset };
    const pause = owner.pauses;
    for (const piece of stopped) this.pieces.delete(piece.id);
    const chunks = stopped.map((piece) => piece.chunk);
    if (!stopped.some((piece) => piece.sent)) return chunks;
    const stop = this.ask("stop", undefined, (answer) => {
      const ids = record(answer).unplayed;
      if (!Array.isArray(ids) || this.state === "closed") return;
      const unplayed = new Set<unknown>(ids);
      if (pausing && owner.pauses === pause) {
        const heard: string[] = [];
        for (const piece of stopped) {
          if (!piece.sent || unplayed.has(piece.id)) break;
          heard.push(piece.chunk.audio);
        }
        if (heard.length > 0) owner.heard = { pause, audio: heard };
      }
      const again = ids.flatMap((id) => {
        const piece = typeof id === "string" ? this.pieces.get(id) : undefined;
        return piece ? [piece] : [];
      });
      const later = [...this.pieces.values()].filter(
        (piece) => !piece.sent && !again.includes(piece),
      );
      for (const piece of [...again, ...later]) {
        this.pieces.delete(piece.id);
        this.play(piece);
      }
    });
    quietly(stop);
    return chunks;
  }

  /**
   * Gives the audio back to the system; `tell` false for an engine that
   * never opened. The page's own close reports no loss: whoever closes it
   * has stopped listening.
   */
  close(tell = true) {
    if (tell) quietly(this.ask("close"));
    if (this.state === "closed") return;
    this.watchers.clear();
    this.end();
  }

  private listen() {
    const on = (event: string, listener: (payload: unknown) => void) =>
      this.shell.on(`voiceAudio.${event}`, listener);
    this.detach = [
      on("input", (payload) => this.heard(payload)),
      on("started", (payload) => this.started(payload)),
      on("played", (payload) => this.played(payload)),
      on("route", (payload) => this.routed(payload)),
      on("interrupted", () => this.interrupt(true)),
      on("resumed", () => this.interrupt(false)),
      on("closed", (payload) => {
        logger.log("[VOICE] the shell closed its voice audio", payload);
        this.end(true, record(payload).reason);
      }),
    ];
  }

  private play(piece: Piece) {
    serial += 1;
    piece.id = `v${serial}`;
    piece.sent = false;
    this.pieces.set(piece.id, piece);
    const { id } = piece;
    const turn = inLine(async () => {
      if (this.pieces.get(id) !== piece || this.heardBefore(piece)) return;
      piece.sent = true;
      const answer = await this.request("play", {
        id,
        audio: piece.audio,
        sampleRate: piece.chunk.sampleRate,
      });
      // Refused: nothing of it will be heard.
      if (answer === undefined && this.pieces.get(id) === piece)
        this.done(piece);
    });
    quietly(turn);
  }

  /** The piece was heard to its end before a pause, and comes again. */
  private heardBefore(piece: Piece): boolean {
    const { owner } = piece;
    const heard = owner.heard;
    if (heard?.pause !== piece.pause) return false;
    if (heard.audio[0] !== piece.chunk.audio) {
      owner.heard = null;
      return false;
    }
    heard.audio.shift();
    if (heard.audio.length === 0) owner.heard = null;
    this.done(piece);
    return true;
  }

  /** In line with every other request; `handle` sees the answer first. */
  private ask(
    method: string,
    params?: unknown,
    handle?: (answer: unknown) => void,
  ): Promise<unknown> {
    return inLine(async () => {
      const answer = await this.request(method, params);
      handle?.(answer);
      return answer;
    });
  }

  /** Resolves to the answer, or undefined when the shell refused. */
  private request(method: string, params?: unknown): Promise<unknown> {
    try {
      return this.shell
        .request(`voiceAudio.${method}`, params)
        .then((answer) => answer ?? null)
        .catch((error: unknown) => {
          logger.log(`[VOICE] voiceAudio.${method} refused`, error);
          return undefined;
        });
    } catch (error) {
      logger.log(`[VOICE] voiceAudio.${method} threw`, error);
      return Promise.resolve(undefined);
    }
  }

  private done(piece: Piece) {
    this.pieces.delete(piece.id);
    const { owner } = piece;
    const at = owner.pieces.indexOf(piece);
    if (at < 0) return;
    owner.pieces.splice(at, 1);
    if (owner.pieces.length === 0) owner.onDrained();
  }

  /**
   * A piece the shell starts again from its start (after an interruption, on
   * a new route, or after another queue's stop) moves its passage on.
   */
  private log(piece: Piece, startsAt: number) {
    const { owner, passage } = piece;
    if (!piece.logged)
      owner.onScheduled?.(piece.chunk.text, startsAt, startsAt + piece.seconds);
    else if (passage)
      owner.onScheduled?.(
        passage.text,
        startsAt - passage.offset,
        startsAt + piece.seconds,
      );
    piece.logged = true;
  }

  private heard(payload: unknown) {
    const { samples, at } = record(payload);
    const received = finite(at);
    // Frames of one system buffer share their `at`.
    if (
      received !== undefined &&
      this.lastInputAt !== undefined &&
      received > this.lastInputAt
    ) {
      this.gaps.push(received - this.lastInputAt);
      if (this.gaps.length > BUFFER_GAPS) this.gaps.shift();
      this.bufferMs = Math.min(MAX_BUFFER_MS, Math.max(...this.gaps));
    }
    this.lastInputAt = received ?? this.lastInputAt;
    if (this.inputs.size === 0 || typeof samples !== "string") return;
    let decoded: Float32Array;
    try {
      decoded = decodePcm16(samples);
    } catch {
      return;
    }
    const input = { samples: decoded, at: received ?? Date.now() };
    for (const listener of this.inputs) listener(input);
  }

  private started(payload: unknown) {
    const { id, at } = record(payload);
    const piece = typeof id === "string" ? this.pieces.get(id) : undefined;
    if (piece) this.log(piece, (finite(at) ?? Date.now()) / 1000);
  }

  private played(payload: unknown) {
    const { id, at, durationMs } = record(payload);
    const piece = typeof id === "string" ? this.pieces.get(id) : undefined;
    if (!piece) return;
    const endedAt = finite(at) ?? Date.now();
    if (!piece.logged)
      this.log(piece, (endedAt - (finite(durationMs) ?? 0)) / 1000);
    this.done(piece);
  }

  private routed(payload: unknown) {
    const route = record(payload);
    this.outputDelayMs = finite(route.outputDelayMs) ?? this.outputDelayMs;
    this.inputDelayMs = finite(route.inputDelayMs) ?? this.inputDelayMs;
  }

  private interrupt(interrupted: boolean) {
    if (this.state === "closed" || this.interrupted === interrupted) return;
    this.interrupted = interrupted;
    for (const watcher of [...this.watchers]) watcher();
  }

  /**
   * Nothing of it plays or listens any more: every voice counts as ended.
   * `reason` is the shell's, when the shell closed it.
   */
  private end(byShell = false, reason?: unknown) {
    if (this.state === "closed") return;
    this.state = "closed";
    // After `interrupted` the system advises against going on by itself.
    this.reopens = reason === "mediaServicesReset" || reason === "failed";
    if (current === this) {
      current = null;
      lost = byShell ? this : null;
    }
    for (const stop of this.detach) stop();
    const owners = new Set([...this.pieces.values()].map((p) => p.owner));
    this.pieces.clear();
    this.inputs.clear();
    for (const watcher of [...this.watchers]) watcher();
    this.watchers.clear();
    for (const owner of owners) {
      owner.pieces = [];
      owner.onDrained();
    }
    changed();
  }
}

let current: ShellVoiceAudio | null = null;
interface Opening {
  promise: Promise<ShellVoiceAudio | null>;
  /** The conversation ended while it opened. */
  letGo: boolean;
}
let opening: Opening | null = null;
/** The session the shell closed during the conversation, until a new open. */
let lost: ShellVoiceAudio | null = null;
const changes = new Set<() => void>();
const changed = () => {
  for (const listener of [...changes]) listener();
};

registerWorkInProgress(() => current !== null);

/** The session that has the conversation's audio, while it is open. */
export function shellVoiceAudio(): ShellVoiceAudio | null {
  return current;
}

/**
 * The open session; while one is being opened for a conversation, a promise
 * of it. A closed session from it means the conversation ended meanwhile,
 * not that the page should play and record itself.
 */
export function settledShellVoiceAudio():
  | ShellVoiceAudio
  | null
  | Promise<ShellVoiceAudio | null> {
  return opening && !opening.letGo ? opening.promise : current;
}

/** The session the shell closed during the conversation, until a new open. */
export function lostShellVoiceAudio(): ShellVoiceAudio | null {
  return lost;
}

/** Hears a session open, fail to open, or close. Returns the unsubscribe. */
export function onShellVoiceAudioChange(listener: () => void): () => void {
  changes.add(listener);
  return () => changes.delete(listener);
}

/**
 * Opens the app shell's voice audio for a conversation, or returns the one
 * open or opening. Null where the shell does not offer it or it would not
 * start: the page then plays and records as in a browser.
 */
export function openShellVoiceAudio(start: {
  bufferMs: number;
  maxWaitMs: number;
}): Promise<ShellVoiceAudio | null> {
  if (current) return Promise.resolve(current);
  if (opening) {
    opening.letGo = false;
    return opening.promise;
  }
  const shell = hostShellWithCapability(CAPABILITY, 1);
  if (!shell) return Promise.resolve(null);
  const voice = new ShellVoiceAudio(shell);
  const attempt: Opening = {
    letGo: false,
    promise: voice
      .open(start)
      .catch(() => false)
      .then((opened) => {
        opening = null;
        lost = null;
        let result: ShellVoiceAudio | null = voice;
        if (!opened || voice.state === "closed") {
          voice.close(opened);
          result = null;
        } else if (attempt.letGo) {
          voice.close();
        } else {
          current = voice;
        }
        changed();
        return result;
      }),
  };
  opening = attempt;
  changed();
  return attempt.promise;
}

/** Ends the conversation's session, also one still being opened. */
export function closeShellVoiceAudio() {
  lost = null;
  if (opening && !opening.letGo) {
    opening.letGo = true;
    changed();
  }
  current?.close();
}

/** For a request nobody waits on: a failure in it is logged, not thrown. */
function quietly(request: Promise<unknown>) {
  request.catch((error: unknown) =>
    logger.log("[VOICE] request failed", error),
  );
}

/**
 * A queue's own share of the session: it hears only its own pieces, and its
 * stop silences only when it has any in the shell.
 */
export interface ShellVoiceQueue {
  enqueue(voice: ShellVoiceAudio, chunk: PcmChunk): boolean;
  flush(): void;
  /** What had not been heard to its end, the piece playing first. */
  pause(): PcmChunk[];
  stop(): void;
  readonly active: boolean;
}

export function createShellVoiceQueue(
  onDrained: () => void,
  onScheduled?: OnScheduled,
): ShellVoiceQueue {
  const owner: Owner = {
    pieces: [],
    onDrained,
    onScheduled,
    pauses: 0,
    heard: null,
    passage: null,
  };
  let session: ShellVoiceAudio | null = null;
  const silence = (pausing: boolean) => {
    if (!pausing) owner.heard = null;
    const playing = session;
    session = null;
    return playing ? playing.silence(owner, pausing) : [];
  };
  return {
    get active() {
      return owner.pieces.length > 0;
    },
    enqueue(voice, chunk) {
      if (session !== voice) silence(false);
      session = voice;
      return voice.queue(owner, chunk);
    },
    flush() {
      if (owner.pieces.length > 0) session?.flush();
    },
    pause: () => silence(true),
    stop() {
      silence(false);
    },
  };
}
