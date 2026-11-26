import { fetchWaitLines } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { primaryLanguage } from "@/lib/toolCallGist/spokenLanguageData";
import { nextWaitStep } from "@/lib/waitLines/plan";
import { toolWaitLine } from "@/lib/waitLines/toolLine";
import { createSSEConnection } from "@/utils/sse/sseClient";

import { createPcmQueue, playbackContext, playbackPlays } from "./pcmPlayback";
import { onMicrophoneOpened, takeSpeechEnd } from "./speechEnd";
import {
  afterReplyAudio,
  holdReplyAudio,
  noteVoiceChunk,
  onSpeechInterrupted,
  releaseReplyAudio,
  useSpeechPlayback,
} from "./speechPlayback";

import type {
  ToolCallLabel,
  WaitLinesResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  SaidLine,
  WaitAmount,
  WaitLineKind,
  WaitTiming,
  WaitTurnState,
} from "@/lib/waitLines/plan";
import type { ToolLineTemplates } from "@/lib/waitLines/toolLine";

/**
 * What the voice says while the user waits for an answer: the lines the
 * deployment set, in the answer's own voice, on the timers of `nextWaitStep`.
 * One turn at a time, the one whose answer is read back. A line plays on its
 * own queue on the shared voice output, so stop and ducking reach it; the
 * answer's first audio waits until a line has finished.
 */

interface Clip {
  text: string;
  audio: string;
  sampleRate: number;
}

interface Loaded {
  amount: WaitAmount;
  timing: WaitTiming;
  taperAfterTurns: number;
  language: string;
  /** Changes with the voice, the words, the timings or the amount. */
  version: string;
  /** A configured line could not be said yet: asked for again next turn. */
  incomplete: boolean;
  clips: Record<"opener" | "opener_short" | "still" | "long", Clip[]>;
  tools: ToolLineTemplates;
}

interface ToolLine {
  messageId: string;
  text: string;
  chunks: Clip[];
  close: () => void;
}

interface Turn {
  streamKey: string;
  /** The language the turn was spoken in; the user's own when unknown. */
  language?: string;
  state: WaitTurnState;
  toolLines: Map<string, ToolLine>;
  /** Calls already looked at: one request per call at most. */
  toolsSeen: Set<string>;
  /** The lines are confirmed for this turn: same voice as the answer. */
  checked: boolean;
  /** A continuation after a decision has no opener of its own. */
  opener: boolean;
  /**
   * The reply's spoken parts whose end is still to come, oldest first: a
   * part's end follows its audio, so it can come after the next part began.
   */
  parts: SaidLine[];
}

/** Speech that ended this long ago no longer belongs to the turn sent now. */
const SPEECH_END_FRESH_MS = 30_000;
/** Between the end of a line and the answer it held back. */
const AFTER_LINE_MS = 150;

/** Lines by the language they are said in; `""` for the user's own. */
const loadedLines = new Map<string, Loaded>();
const loadingLines = new Map<string, Promise<Loaded | null>>();
let unsupported = false;
let openersSaid = 0;
const lastSaid = new Map<string, string>();
let turn: Turn | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let lineDone: (() => void) | null = null;
/** The line playing when it is said outside the plan (`sayAsideLine`). */
let aside: SaidLine | null = null;
/** A line plays, or its answer audio has not been let go yet. */
let busy = false;
let idleWaiters: (() => void)[] = [];

const queue = createPcmQueue(() => lineEnded(), noteVoiceChunk);

const now = () => Date.now();

const fromResponse = (response: WaitLinesResponse): Loaded => {
  const clips: Loaded["clips"] = {
    opener: [],
    opener_short: [],
    still: [],
    long: [],
  };
  for (const line of response.lines) {
    clips[line.slot].push({
      text: line.text,
      audio: line.audio,
      sampleRate: line.sample_rate,
    });
  }
  const { timing } = response;
  return {
    amount: response.amount,
    timing: {
      firstAfterMs: timing.first_after_ms,
      toolAfterMs: timing.tool_after_ms,
      stillAfterMs: timing.still_after_ms,
      stillQuietMs: timing.still_quiet_ms,
      longAfterMs: timing.long_after_ms,
      stillRepeatMs: timing.still_repeat_ms,
      stillRepeatMax: timing.still_repeat_max,
      minGapMs: timing.min_gap_ms,
      maxPerTurn: timing.max_per_turn,
    },
    taperAfterTurns: timing.taper_after_turns,
    language: response.language,
    version: response.version,
    incomplete: response.incomplete,
    clips,
    tools: {
      search: response.tools.search,
      items: response.tools.items,
      list: response.tools.list,
      server: response.tools.server,
    },
  };
};

const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number"
    ? error.status
    : undefined;

// On a cold cache the server makes every line's audio before it answers.
const WAIT_LINES_READ_TIMEOUT_MS = 120_000;

/**
 * Asks whether the lines still hold, and for new ones where they do not:
 * the server answers `unchanged` for the version the browser has, without
 * any audio. Asked when audio mode starts and again at every turn, so a
 * deployment that changed its voice is never heard with lines in the old
 * one, and a changed amount or timing applies from the next turn.
 */
export function prepareWaitLines(language?: string): Promise<Loaded | null> {
  if (unsupported) return Promise.resolve(null);
  const key = language ? primaryLanguage(language) : "";
  const pending = loadingLines.get(key);
  if (pending) return pending;
  const known = loadedLines.get(key);
  const loading = fetchWaitLines({
    readTimeoutMs: WAIT_LINES_READ_TIMEOUT_MS,
    // Lines that came back incomplete are asked for in full again, so a
    // line the voice failed on once is not missing for the whole session.
    queryParams: {
      ...(known && !known.incomplete ? { known: known.version } : {}),
      ...(language ? { language } : {}),
    },
  })
    .then((response) => {
      if (response.unchanged && known?.version === response.version) {
        return known;
      }
      lastSaid.clear();
      const fresh = fromResponse(response);
      loadedLines.set(key, fresh);
      return fresh;
    })
    .catch((error: unknown) => {
      // No voice, or a backend without wait lines: nothing is said. Lines
      // that could not be confirmed are not said in this turn either.
      if (statusOf(error) === 404) unsupported = true;
      throw error;
    })
    .finally(() => {
      loadingLines.delete(key);
    });
  loadingLines.set(key, loading);
  return loading;
}

/** The lines of the turn's language: none for a language without lines. */
const linesOf = (current: Turn | null): Loaded | null =>
  current
    ? (loadedLines.get(
        current.language ? primaryLanguage(current.language) : "",
      ) ?? null)
    : null;

/** For tests: forget everything. */
export function resetWaitLines() {
  stopWaitLines();
  loadedLines.clear();
  loadingLines.clear();
  unsupported = false;
  takeSpeechEnd();
  openersSaid = 0;
  lastSaid.clear();
}

/**
 * A turn whose answer is read back was sent on `streamKey`: the wait starts.
 * It counts from the end of the speech that became this turn, or from now
 * for a continuation after a decision, never from an earlier utterance such
 * as a command said to a card. A continuation has no opener unless `opener`:
 * after a decision by voice the voice already answered it; after a tap only
 * the screen did, and someone listening would hear nothing while it runs.
 */
export function beginWaitTurn(
  streamKey: string,
  options: { continuation?: boolean; opener?: boolean; language?: string } = {},
) {
  stopWaitLines();
  const sent = now();
  const ended = takeSpeechEnd();
  const speechEndedAt =
    !options.continuation &&
    ended !== undefined &&
    sent - ended <= SPEECH_END_FRESH_MS
      ? ended
      : sent;
  turn = {
    streamKey,
    language: options.language,
    state: {
      speechEndedAt,
      transcriptAt: sent,
      answerStarted: false,
      ended: false,
      said: [],
      tools: [],
      unavailable: [],
    },
    toolLines: new Map(),
    toolsSeen: new Set(),
    checked: false,
    opener: !options.continuation || options.opener === true,
    parts: [],
  };
  const current = turn;
  prepareWaitLines(options.language).then(
    (lines) => {
      if (turn !== current || !lines) return;
      current.checked = true;
      plan();
    },
    () => {
      // Not confirmed: this turn says nothing.
    },
  );
}

const forTurn = (streamKey: string): Turn | null =>
  turn?.streamKey === streamKey ? turn : null;

/** The answer's text or audio has arrived: no new line from here on. */
export function waitTurnAnswered(streamKey: string) {
  const current = forTurn(streamKey);
  if (!current || current.state.answerStarted) return;
  current.state.answerStarted = true;
  closeToolLines(current);
  plan();
}

/**
 * The reply's audio arrived. Inside a spoken part it is that part's voice,
 * which `waitTurnSpeaks` has counted; otherwise it reads the answer.
 */
export function waitTurnAudio(streamKey: string) {
  if (forTurn(streamKey)?.parts.length) return;
  waitTurnAnswered(streamKey);
}

/**
 * The reply's spoken part has begun. It may be the answer or a line before
 * a tool call, so it pauses the wait rather than end it: a tool call after
 * it lets the lines go on, the written answer ends them.
 */
export function waitTurnSpeaks(streamKey: string) {
  const current = forTurn(streamKey);
  if (!current) return;
  const { state } = current;
  if (state.answerStarted || state.ended) return;
  // More text of the open part, unless a tool call came after it: a new
  // model call speaks a part of its own.
  const open = current.parts.at(-1);
  if (open && !state.tools.some((tool) => tool.startedAt >= open.startedAt))
    return;
  const part: SaidLine = { kind: "reply", startedAt: now() };
  current.parts.push(part);
  state.said.push(part);
  plan();
}

/** The spoken part has all its audio: it counts as said once that played. */
export function waitTurnSpokenEnd(streamKey: string) {
  const current = forTurn(streamKey);
  const part = current?.parts.shift();
  if (!current || !part) return;
  void afterReplyAudio().then(() => {
    if (turn !== current) return;
    part.endedAt ??= now();
    plan();
  });
}

/** The turn's stream ended: a line that plays finishes, nothing follows. */
export function endWaitTurn(streamKey: string) {
  const current = forTurn(streamKey);
  if (!current) return;
  current.state.ended = true;
  closeToolLines(current);
  plan();
}

export function moveWaitTurn(from: string, to: string) {
  if (turn?.streamKey === from) turn.streamKey = to;
}

/**
 * A tool call of the turn changed. A call that only reads, and whose label
 * names what it reads or that the backend found to do nothing but read
 * (`readOnlyServer`, the server's name), gets its line asked for at once,
 * so it is ready by the time it is due.
 */
export function waitTurnTool(
  streamKey: string,
  messageId: string,
  toolCallId: string,
  status: string,
  label: ToolCallLabel | null | undefined,
  readOnlyServer?: string,
) {
  const current = forTurn(streamKey);
  if (!current) return;
  const { state } = current;
  let tool = state.tools.find((entry) => entry.id === toolCallId);
  if (status === "success" || status === "error") {
    if (tool && tool.endedAt === undefined) tool.endedAt = now();
    current.toolLines.get(toolCallId)?.close();
    plan();
    return;
  }
  if (status !== "in_progress" || current.toolsSeen.has(toolCallId)) return;
  current.toolsSeen.add(toolCallId);
  tool = { id: toolCallId, startedAt: now(), ready: false };
  state.tools.push(tool);
  const loaded = linesOf(current);
  const text =
    !loaded || state.answerStarted || state.ended || loaded.amount === "off"
      ? null
      : toolWaitLine(label, loaded.language, loaded.tools, readOnlyServer);
  if (!text) {
    // A call without a line still counts: after a spoken part, it lets the
    // fixed lines cover the wait.
    tool.silent = true;
    plan();
    return;
  }
  const line: ToolLine = { messageId, text, chunks: [], close: () => {} };
  current.toolLines.set(toolCallId, line);
  const added = tool;
  let settled = false;
  // Never said late or in part: a line that fails is dropped.
  const fail = () => {
    if (settled) return;
    settled = true;
    line.chunks = [];
    current.toolLines.delete(toolCallId);
    added.silent = true;
    if (turn === current) plan();
  };
  line.close = createSSEConnection(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- request path
    `/api/v1beta/me/messages/${encodeURIComponent(messageId)}/progress-speech`,
    {
      method: "POST",
      body: JSON.stringify(
        loaded ? { text, language: loaded.language } : { text },
      ),
      onMessage: (event) => {
        if (turn !== current || settled) return;
        if (event.type === "audio_delta") {
          try {
            const chunk = JSON.parse(event.data) as {
              audio: string;
              sample_rate: number;
            };
            line.chunks.push({
              text,
              audio: chunk.audio,
              sampleRate: chunk.sample_rate,
            });
          } catch {
            fail();
          }
        } else if (event.type === "done") {
          if (line.chunks.length === 0) {
            fail();
            return;
          }
          settled = true;
          added.ready = true;
          plan();
        } else if (event.type === "error") {
          fail();
        }
      },
      onError: fail,
      onClose: fail,
    },
  );
  plan();
}

const closeToolLines = (current: Turn) => {
  for (const line of current.toolLines.values()) line.close();
};

/**
 * Stops the line now and says nothing more in this turn: the user stopped
 * the voice, talked over it, or left the chat.
 */
export function stopWaitLines() {
  clearTimeout(timer);
  timer = undefined;
  if (turn) closeToolLines(turn);
  turn = null;
  aside = null;
  queue.stop();
  if (lineDone) {
    lineDone = null;
    releaseReplyAudio();
  }
  settleIdle();
}

onSpeechInterrupted(stopWaitLines);
// Whatever ends a turn, nothing the voice says may play into a recording
// without the echo-cancelling hold.
onMicrophoneOpened(stopWaitLines);

/** Whether a wait line is being said right now. */
export function waitLinePlaying(): boolean {
  return busy;
}

/** Resolves once no line plays: a card read aloud waits for it. */
export function afterWaitLine(): Promise<void> {
  if (!busy) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

const settleIdle = () => {
  busy = false;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const resolve of waiters) resolve();
};

const pick = (
  loaded: Loaded,
  slot: keyof Loaded["clips"],
): Clip | undefined => {
  const clips = loaded.clips[slot];
  if (clips.length === 0) return undefined;
  const last = lastSaid.get(slot);
  const fresh = clips.filter((clip) => clip.text !== last);
  const choices = fresh.length > 0 ? fresh : clips;
  return choices[Math.floor(Math.random() * choices.length)];
};

const openerSlot = (loaded: Loaded): "opener" | "opener_short" => {
  const taper = loaded.taperAfterTurns;
  return taper > 0 &&
    openersSaid >= taper &&
    loaded.clips.opener_short.length > 0
    ? // eslint-disable-next-line lingui/no-unlocalized-strings -- a slot name
      "opener_short"
    : "opener";
};

function plan() {
  clearTimeout(timer);
  timer = undefined;
  const current = turn;
  const loaded = linesOf(current);
  if (!current || !loaded || !current.checked) return;
  const { state } = current;
  const unavailable: WaitLineKind[] = [];
  if (!current.opener || loaded.clips[openerSlot(loaded)].length === 0)
    unavailable.push("opener");
  if (loaded.clips.still.length === 0) unavailable.push("still");
  if (loaded.clips.long.length === 0) unavailable.push("long");
  state.unavailable = unavailable;
  const step = nextWaitStep(loaded.amount, loaded.timing, state, now());
  if (step.kind === "wake") {
    timer = setTimeout(plan, Math.max(0, step.at - now()));
    return;
  }
  if (step.kind !== "say") return;
  const clips =
    step.line === "tool"
      ? (current.toolLines.get(step.toolCallId)?.chunks ?? [])
      : [];
  const slot =
    step.line === "tool"
      ? undefined
      : step.line === "opener"
        ? openerSlot(loaded)
        : step.line;
  if (slot) {
    const clip = pick(loaded, slot);
    if (clip) clips.push(clip);
  }
  const context = playbackContext();
  // The voice must be the one reading this turn back, and able to play.
  if (
    clips.length === 0 ||
    !playbackPlays(context) ||
    useSpeechPlayback.getState().spokenTurn !== current.streamKey ||
    !useSpeechPlayback.getState().enabled
  ) {
    state.answerStarted = true;
    return;
  }
  const said: SaidLine = {
    kind: step.line,
    ...(step.line === "tool" ? { toolCallId: step.toolCallId } : {}),
    ...(step.line === "still" && step.repeat ? { repeat: true } : {}),
    startedAt: now(),
  };
  state.said.push(said);
  if (step.line === "opener") openersSaid += 1;
  if (slot) lastSaid.set(slot, clips[0].text);
  playLine(context, clips, said, current);
}

/** Plays `clips` as the line `said` of `current`, holding the answer back. */
function playLine(
  context: AudioContext,
  clips: readonly Clip[],
  said: SaidLine,
  current: Turn | null,
) {
  busy = true;
  holdReplyAudio();
  lineDone = () => {
    // Not the last entry: a spoken part may have begun while the line played.
    said.endedAt ??= now();
    if (aside === said) aside = null;
    // The answer goes on the reply queue before anything waiting for the
    // line (a card) is let go, so it is never overtaken.
    setTimeout(() => {
      releaseReplyAudio();
      settleIdle();
    }, AFTER_LINE_MS);
    if (current && turn === current) plan();
  };
  // A tool line's chunks all carry its text: it is said from the first.
  for (let at = 0; at < clips.length; at += 1) {
    const clip = clips[at];
    const says = at === 0 || clip.text !== clips[at - 1].text;
    if (
      !queue.enqueue(
        context,
        clip.audio,
        clip.sampleRate,
        says ? clip.text : undefined,
      )
    ) {
      queue.stop();
      lineEnded();
      return;
    }
  }
  queue.flush();
}

/** The turn being waited for, to tell later whether it is still the same. */
export function waitTurnNow(): object | null {
  return turn;
}

/**
 * Says `clips` at once on the lines' queue, outside the plan: the word that
 * an approval by voice was taken. It belongs to the turn `of` (from
 * `waitTurnNow`) and is said only while that turn is still waited for: not
 * after the voice was stopped, talked over, or a microphone opened without
 * the echo-cancelling hold. In the turn it counts as a line said (nothing
 * over it or right after it, and toward the turn's cap), and the answer and
 * the next card wait for it as for any line. Returns whether it is said: not
 * while a line plays, nor once the turn's answer or spoken part has begun,
 * nor where the voice cannot play.
 */
export function sayAsideLine(
  clips: readonly { text: string; audio: string; sampleRate: number }[],
  of: object | null,
): boolean {
  const context = playbackContext();
  const speech = useSpeechPlayback.getState();
  const current = turn;
  if (
    current === null ||
    current !== of ||
    clips.length === 0 ||
    busy ||
    !playbackPlays(context) ||
    !speech.enabled ||
    !speech.conversational
  )
    return false;
  const { state } = current;
  if (
    state.answerStarted ||
    state.ended ||
    current.parts.length > 0 ||
    state.said.some((line) => line.kind === "reply") ||
    speech.spokenTurn !== current.streamKey
  )
    return false;
  const said: SaidLine = { kind: "ack", startedAt: now() };
  state.said.push(said);
  aside = said;
  playLine(context, clips, said, current);
  return aside === said;
}

/** Stops the line said by `sayAsideLine`, if it still plays. */
export function stopAsideLine() {
  if (aside === null) return;
  aside = null;
  queue.stop();
  lineEnded();
}

function lineEnded() {
  const done = lineDone;
  lineDone = null;
  done?.();
}
