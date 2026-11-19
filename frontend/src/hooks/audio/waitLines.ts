import { fetchWaitLines } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { nextWaitStep } from "@/lib/waitLines/plan";
import { toolWaitLine } from "@/lib/waitLines/toolLine";
import { createSSEConnection } from "@/utils/sse/sseClient";

import { createPcmQueue, playbackContext } from "./pcmPlayback";
import { takeSpeechEnd } from "./speechEnd";
import {
  holdReplyAudio,
  onSpeechInterrupted,
  releaseReplyAudio,
  useSpeechPlayback,
} from "./speechPlayback";

import type {
  ToolCallLabel,
  WaitLinesResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
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
  voice: string;
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
  state: WaitTurnState;
  toolLines: Map<string, ToolLine>;
  /** Calls already looked at: one request per call at most. */
  toolsSeen: Set<string>;
}

/** Speech that ended this long ago no longer belongs to the turn sent now. */
const SPEECH_END_FRESH_MS = 30_000;
/** Between the end of a line and the answer it held back. */
const AFTER_LINE_MS = 150;

let loaded: Loaded | null = null;
let loadedAt = 0;
/**
 * Lines older than this are asked for again at the next turn, so a voice
 * changed while audio mode stays on reaches the lines too. The server keeps
 * them, so asking again costs nothing new.
 */
const FRESH_FOR_MS = 5 * 60_000;
let loading: Promise<Loaded | null> | null = null;
let unsupported = false;
let openersSaid = 0;
const lastSaid = new Map<string, string>();
let turn: Turn | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let lineDone: (() => void) | null = null;
/** A line plays, or its answer audio has not been let go yet. */
let busy = false;
let idleWaiters: (() => void)[] = [];

const queue = createPcmQueue(() => lineEnded());

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
      minGapMs: timing.min_gap_ms,
      maxPerTurn: timing.max_per_turn,
    },
    taperAfterTurns: timing.taper_after_turns,
    language: response.language,
    voice: response.voice,
    clips,
    tools: {
      search: response.tools.search,
      items: response.tools.items,
      list: response.tools.list,
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

/**
 * Asks for the lines again, as audio mode starts: a deployment that changed
 * its voice answers with a new `voice`, and the old lines are dropped, so
 * the lines always sound like the answers.
 */
export function prepareWaitLines(): Promise<Loaded | null> {
  if (unsupported) return Promise.resolve(null);
  loading ??= fetchWaitLines({})
    .then((response) => {
      const next = fromResponse(response);
      if (loaded?.voice !== next.voice) lastSaid.clear();
      loaded = next;
      loadedAt = Date.now();
      return loaded;
    })
    .catch((error: unknown) => {
      // No voice, or a backend without wait lines: nothing is said.
      if (statusOf(error) === 404) unsupported = true;
      return loaded;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** For tests: forget everything. */
export function resetWaitLines() {
  stopWaitLines();
  loaded = null;
  loading = null;
  unsupported = false;
  takeSpeechEnd();
  openersSaid = 0;
  lastSaid.clear();
}

/**
 * A turn whose answer is read back was sent on `streamKey`: the wait starts.
 * The user's words are known at this point, so nothing is due earlier.
 */
export function beginWaitTurn(streamKey: string) {
  stopWaitLines();
  const sent = now();
  const ended = takeSpeechEnd();
  const speechEndedAt =
    ended !== undefined && sent - ended <= SPEECH_END_FRESH_MS ? ended : sent;
  turn = {
    streamKey,
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
  };
  const current = turn;
  const stale = !loaded || sent - loadedAt > FRESH_FOR_MS;
  void (stale ? prepareWaitLines() : Promise.resolve(loaded)).then(() => {
    if (turn === current) plan();
  });
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
 * names what it reads, gets its line asked for at once, so it is ready by
 * the time it is due.
 */
export function waitTurnTool(
  streamKey: string,
  messageId: string,
  toolCallId: string,
  status: string,
  label: ToolCallLabel | null | undefined,
) {
  const current = forTurn(streamKey);
  if (!current || !loaded) return;
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
  if (state.answerStarted || state.ended || loaded.amount === "off") return;
  const text = toolWaitLine(label, loaded.language, loaded.tools);
  if (!text) {
    // Nothing to say about it; the fixed lines cover the wait.
    state.tools = state.tools.filter((entry) => entry !== tool);
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
    state.tools = state.tools.filter((entry) => entry !== added);
    if (turn === current) plan();
  };
  line.close = createSSEConnection(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- request path
    `/api/v1beta/me/messages/${encodeURIComponent(messageId)}/progress-speech`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
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
  queue.stop();
  if (lineDone) {
    lineDone = null;
    releaseReplyAudio();
  }
  settleIdle();
}

onSpeechInterrupted(stopWaitLines);

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

const pick = (slot: keyof Loaded["clips"]): Clip | undefined => {
  const clips = loaded?.clips[slot] ?? [];
  if (clips.length === 0) return undefined;
  const last = lastSaid.get(slot);
  const fresh = clips.filter((clip) => clip.text !== last);
  const choices = fresh.length > 0 ? fresh : clips;
  return choices[Math.floor(Math.random() * choices.length)];
};

const openerSlot = (): "opener" | "opener_short" => {
  const taper = loaded?.taperAfterTurns ?? 0;
  return taper > 0 &&
    openersSaid >= taper &&
    (loaded?.clips.opener_short.length ?? 0) > 0
    ? // eslint-disable-next-line lingui/no-unlocalized-strings -- a slot name
      "opener_short"
    : "opener";
};

function plan() {
  clearTimeout(timer);
  timer = undefined;
  const current = turn;
  if (!current || !loaded) return;
  const { state } = current;
  const unavailable: WaitLineKind[] = [];
  if (loaded.clips[openerSlot()].length === 0) unavailable.push("opener");
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
        ? openerSlot()
        : step.line;
  if (slot) {
    const clip = pick(slot);
    if (clip) clips.push(clip);
  }
  const context = playbackContext();
  // The voice must be the one reading this turn back, and able to play.
  if (
    clips.length === 0 ||
    context?.state !== "running" ||
    useSpeechPlayback.getState().spokenTurn !== current.streamKey ||
    !useSpeechPlayback.getState().enabled
  ) {
    state.answerStarted = true;
    return;
  }
  state.said.push({
    kind: step.line,
    ...(step.line === "tool" ? { toolCallId: step.toolCallId } : {}),
    startedAt: now(),
  });
  if (step.line === "opener") openersSaid += 1;
  if (slot) lastSaid.set(slot, clips[0].text);
  busy = true;
  holdReplyAudio();
  lineDone = () => {
    const said = state.said[state.said.length - 1];
    said.endedAt ??= now();
    // The answer goes on the reply queue before anything waiting for the
    // line (a card) is let go, so it is never overtaken.
    setTimeout(() => {
      releaseReplyAudio();
      settleIdle();
    }, AFTER_LINE_MS);
    if (turn === current) plan();
  };
  for (const clip of clips) {
    if (!queue.enqueue(context, clip.audio, clip.sampleRate)) {
      queue.stop();
      lineEnded();
      return;
    }
  }
  queue.flush();
}

function lineEnded() {
  const done = lineDone;
  lineDone = null;
  done?.();
}
