/* eslint-disable lingui/no-unlocalized-strings -- the contract's capability, method and event names */
import { hostShellWithCapability } from "@/lib/hostShell";
import { createLogger } from "@/utils/debugLogger";

import type { HostShell } from "@/lib/hostShell";

const logger = createLogger("HOOK", "shellVoiceAudio");

const CAPABILITY = "voiceAudio";

export type ShellVoiceAudioState = "running" | "interrupted" | "closed";

/** One frame of the processed microphone. */
export interface ShellVoiceInput {
  samples: Float32Array;
  /** When the shell received it, in Unix ms; the sound is up to `inputDelayMs` older. */
  at: number;
}

/** A piece of a voice: base64 signed 16-bit little-endian mono PCM. */
export interface ShellVoiceChunk {
  audio: string;
  sampleRate: number;
  text?: string;
}

interface Owner {
  /** Handed to the shell and not yet heard to their end, in play order. */
  pieces: Piece[];
  onDrained: () => void;
  onScheduled?: (
    text: string | undefined,
    startsAt: number,
    endsAt: number,
  ) => void;
}

interface Piece {
  id: string;
  chunk: ShellVoiceChunk;
  seconds: number;
  owner: Owner;
  logged: boolean;
}

const record = (payload: unknown): Record<string, unknown> =>
  typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Bytes of PCM in base64 `audio`, without decoding it. */
function pcmBytes(audio: string): number {
  const padding = audio.endsWith("==") ? 2 : audio.endsWith("=") ? 1 : 0;
  return Math.floor(((audio.length - padding) * 3) / 4);
}

/** Base64 signed 16-bit little-endian mono PCM as samples from -1 to 1. */
export function decodePcm16(audio: string): Float32Array {
  const raw = globalThis.atob(audio);
  const samples = new Float32Array(raw.length >> 1);
  for (let index = 0; index < samples.length; index++) {
    const value =
      raw.charCodeAt(2 * index) | (raw.charCodeAt(2 * index + 1) << 8);
    samples[index] = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
  }
  return samples;
}

/**
 * A spoken conversation's voice and microphone in the app shell's audio
 * engine (`voiceAudio: 1`), which cancels the voice's echo with the voice
 * itself as reference. The page keeps the conversation: when to listen, what
 * counts as speech, what to play. Times are seconds on the clock of the
 * shell's `at` values, Unix time, so that the said log and a pause compare.
 */
export class ShellVoiceAudio {
  state: ShellVoiceAudioState = "running";
  sampleRate = 16000;
  frameSamples = 512;
  outputDelayMs = 0;
  inputDelayMs = 0;
  private readonly pieces = new Map<string, Piece>();
  private readonly inputs = new Set<(input: ShellVoiceInput) => void>();
  private readonly watchers = new Set<(state: ShellVoiceAudioState) => void>();
  private readonly detach: (() => void)[];
  private serial = 0;

  constructor(private readonly shell: HostShell) {
    const on = (event: string, listener: (payload: unknown) => void) =>
      shell.on(`voiceAudio.${event}`, listener);
    this.detach = [
      on("input", (payload) => this.heard(payload)),
      on("started", (payload) => this.started(payload)),
      on("played", (payload) => this.played(payload)),
      on("route", (payload) => this.routed(payload)),
      on("interrupted", () => this.become("interrupted")),
      on("resumed", () => {
        if (this.state === "interrupted") this.become("running");
      }),
      on("closed", (payload) => {
        logger.log("[VOICE] the shell closed its voice audio", payload);
        this.end();
      }),
    ];
  }

  /** Now, on the clock the shell's events give. */
  get currentTime(): number {
    return Date.now() / 1000;
  }

  /** Starts the engine; false when the shell would not. */
  async open(start: { bufferMs: number; maxWaitMs: number }): Promise<boolean> {
    const answer = await this.request("open", {
      mode: "conversation",
      startBufferMs: start.bufferMs,
      startMaxWaitMs: start.maxWaitMs,
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

  /** Whether the voice plays and the microphone hears, as it changes. */
  onStateChange(listener: (state: ShellVoiceAudioState) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  lower(lowered: boolean) {
    this.send("lower", { lowered });
  }

  /** Queues `chunk` for `owner`; false for a chunk that is no PCM. */
  queue(owner: Owner, chunk: ShellVoiceChunk): boolean {
    const bytes = pcmBytes(chunk.audio);
    if (
      this.state === "closed" ||
      bytes <= 0 ||
      bytes % 2 !== 0 ||
      chunk.sampleRate < 8000 ||
      chunk.sampleRate > 192000
    )
      return false;
    const piece: Piece = {
      id: "",
      chunk,
      seconds: bytes / 2 / chunk.sampleRate,
      owner,
      logged: false,
    };
    owner.pieces.push(piece);
    this.play(piece);
    return true;
  }

  /**
   * Silences what `owner` queued and returns it, the piece playing first:
   * what the page knows at once. The shell's answer then takes out of that
   * list what it heard to its end meanwhile, and plays again what it
   * silenced of other owners.
   */
  silence(owner: Owner): ShellVoiceChunk[] {
    const stopped = owner.pieces;
    if (stopped.length === 0) return [];
    owner.pieces = [];
    for (const piece of stopped) this.pieces.delete(piece.id);
    const unplayed = stopped.map((piece) => piece.chunk);
    void this.request("stop").then((answer) => {
      const ids = record(answer).unplayed;
      if (!Array.isArray(ids) || this.state === "closed") return;
      const left = new Set(ids);
      for (const piece of stopped) {
        if (left.has(piece.id)) continue;
        const at = unplayed.indexOf(piece.chunk);
        if (at >= 0) unplayed.splice(at, 1);
      }
      for (const id of ids) {
        const other = typeof id === "string" ? this.pieces.get(id) : undefined;
        if (!other) continue;
        this.pieces.delete(id as string);
        this.play(other);
      }
    });
    return unplayed;
  }

  /**
   * Gives the audio back to the system. The page's own close reports no
   * loss: whoever closes it has stopped listening.
   */
  close() {
    if (this.state === "closed") return;
    void this.request("close");
    this.watchers.clear();
    this.end();
  }

  /** Forgets a session that never opened. */
  dispose() {
    this.watchers.clear();
    this.end();
  }

  private play(piece: Piece) {
    this.serial += 1;
    piece.id = `v${this.serial}`;
    this.pieces.set(piece.id, piece);
    const { id } = piece;
    void this.request("play", {
      id,
      audio: piece.chunk.audio,
      sampleRate: piece.chunk.sampleRate,
    }).then((answer) => {
      if (answer !== undefined || this.pieces.get(id) !== piece) return;
      // Refused: nothing of it will be heard.
      this.done(piece);
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

  private send(method: string, params?: unknown) {
    if (this.state !== "closed") void this.request(method, params);
  }

  private done(piece: Piece) {
    this.pieces.delete(piece.id);
    const { owner } = piece;
    const at = owner.pieces.indexOf(piece);
    if (at < 0) return;
    owner.pieces.splice(at, 1);
    if (owner.pieces.length === 0) owner.onDrained();
  }

  private log(piece: Piece, startsAt: number) {
    if (piece.logged) return;
    piece.logged = true;
    piece.owner.onScheduled?.(
      piece.chunk.text,
      startsAt,
      startsAt + piece.seconds,
    );
  }

  private heard(payload: unknown) {
    if (this.inputs.size === 0) return;
    const { samples, at } = record(payload);
    if (typeof samples !== "string") return;
    let decoded: Float32Array;
    try {
      decoded = decodePcm16(samples);
    } catch {
      return;
    }
    const input = { samples: decoded, at: finite(at) ?? Date.now() };
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
    this.log(piece, (endedAt - (finite(durationMs) ?? 0)) / 1000);
    this.done(piece);
  }

  private routed(payload: unknown) {
    const route = record(payload);
    this.outputDelayMs = finite(route.outputDelayMs) ?? this.outputDelayMs;
    this.inputDelayMs = finite(route.inputDelayMs) ?? this.inputDelayMs;
  }

  private become(state: ShellVoiceAudioState) {
    if (this.state === state || this.state === "closed") return;
    this.state = state;
    for (const watcher of [...this.watchers]) watcher(state);
  }

  /** Nothing of it plays or listens any more: every voice counts as ended. */
  private end() {
    if (this.state === "closed") return;
    if (current === this) current = null;
    for (const stop of this.detach) stop();
    const owners = new Set([...this.pieces.values()].map((p) => p.owner));
    this.pieces.clear();
    this.inputs.clear();
    this.become("closed");
    this.watchers.clear();
    for (const owner of owners) {
      owner.pieces = [];
      owner.onDrained();
    }
  }
}

let current: ShellVoiceAudio | null = null;
let opening: Promise<ShellVoiceAudio | null> | null = null;
/** Counts opens and closes, so that an open closed meanwhile is let go. */
let generation = 0;

/** The session that has the conversation's audio, while it is open. */
export function shellVoiceAudio(): ShellVoiceAudio | null {
  return current;
}

/** The open session; while one is being opened, a promise of it. */
export function settledShellVoiceAudio():
  | ShellVoiceAudio
  | null
  | Promise<ShellVoiceAudio | null> {
  return opening ?? current;
}

/**
 * Opens the app shell's voice audio for a conversation, or returns the one
 * open. Null where the shell does not offer it or it would not start: the
 * page then plays and records as in a browser.
 */
export function openShellVoiceAudio(start: {
  bufferMs: number;
  maxWaitMs: number;
}): Promise<ShellVoiceAudio | null> {
  if (current) return Promise.resolve(current);
  if (opening) return opening;
  const shell = hostShellWithCapability(CAPABILITY, 1);
  if (!shell) return Promise.resolve(null);
  const voice = new ShellVoiceAudio(shell);
  const mine = ++generation;
  opening = voice.open(start).then((opened) => {
    const wanted = generation === mine;
    if (wanted) opening = null;
    if (!opened || voice.state === "closed") {
      voice.dispose();
      return null;
    }
    if (!wanted) {
      voice.close();
      return null;
    }
    current = voice;
    return voice;
  });
  return opening;
}

/** Ends the conversation's session, also one still being opened. */
export function closeShellVoiceAudio() {
  generation += 1;
  opening = null;
  current?.close();
}

/**
 * A queue's own share of the session: it hears only its own pieces, and its
 * stop silences only when it has any in the shell.
 */
export interface ShellVoiceQueue {
  enqueue(voice: ShellVoiceAudio, chunk: ShellVoiceChunk): boolean;
  /** What had not been heard to its end, the piece playing first. */
  pause(): ShellVoiceChunk[];
  stop(): void;
  readonly active: boolean;
}

export function createShellVoiceQueue(
  onDrained: () => void,
  onScheduled?: Owner["onScheduled"],
): ShellVoiceQueue {
  const owner: Owner = { pieces: [], onDrained, onScheduled };
  let session: ShellVoiceAudio | null = null;
  const pause = () => {
    const playing = session;
    session = null;
    return playing ? playing.silence(owner) : [];
  };
  return {
    get active() {
      return owner.pieces.length > 0;
    },
    enqueue(voice, chunk) {
      if (session !== voice) pause();
      session = voice;
      return voice.queue(owner, chunk);
    },
    pause,
    stop() {
      pause();
    },
  };
}
