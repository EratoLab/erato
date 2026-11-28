import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitHostShellEvent,
  installHostShell,
  removeHostShell,
  shellAnswers,
} from "@/test/hostShellStub";

import {
  closeShellVoiceAudio,
  createShellVoiceQueue,
  openShellVoiceAudio,
  settledShellVoiceAudio,
  shellVoiceAudio,
} from "./shellVoiceAudio";

const OPENED = {
  sampleRate: 16000,
  frameSamples: 512,
  output: "speaker",
  outputDelayMs: 40,
  inputDelayMs: 30,
  microphoneMode: "standard",
};
const START = { bufferMs: 400, maxWaitMs: 350 };
const RATE = 24000;

/** Base64 signed 16-bit little-endian PCM of `values`. */
const pcm16 = (values: number[]) => {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return globalThis.btoa(String.fromCharCode(...bytes));
};
/** Base64 PCM of `ms` milliseconds of silence. */
const pcm = (ms: number) => pcm16(new Array((RATE * ms) / 1000).fill(0));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function voiceShell(answers: Record<string, unknown> = {}) {
  return installHostShell(
    { voiceAudio: 1 },
    shellAnswers({
      "voiceAudio.open": OPENED,
      "voiceAudio.play": null,
      "voiceAudio.stop": { unplayed: [] },
      "voiceAudio.lower": null,
      "voiceAudio.close": null,
      ...answers,
    }),
  );
}

async function opened(answers: Record<string, unknown> = {}) {
  const request = voiceShell(answers);
  const voice = await openShellVoiceAudio(START);
  if (!voice) throw new Error("the shell's voice audio did not open");
  return { request, voice };
}

const played = (request: ReturnType<typeof voiceShell>) =>
  request.mock.calls
    .filter(([method]) => method === "voiceAudio.play")
    .map(([, params]) => params as { id: string; audio: string });

afterEach(() => {
  closeShellVoiceAudio();
  removeHostShell();
});

describe("opening the app shell's voice audio", () => {
  it("opens it once for a conversation, with the page's start buffer", async () => {
    const { request, voice } = await opened();

    expect(request).toHaveBeenCalledWith("voiceAudio.open", {
      mode: "conversation",
      startBufferMs: 400,
      startMaxWaitMs: 350,
    });
    expect(voice).toMatchObject({
      sampleRate: 16000,
      frameSamples: 512,
      outputDelayMs: 40,
      inputDelayMs: 30,
      state: "running",
    });
    expect(shellVoiceAudio()).toBe(voice);
    expect(await openShellVoiceAudio(START)).toBe(voice);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("leaves the page's own audio where the shell does not offer it or will not open it", async () => {
    const request = installHostShell({ haptics: 1 });
    expect(await openShellVoiceAudio(START)).toBeNull();
    expect(request).not.toHaveBeenCalled();

    voiceShell({
      "voiceAudio.open": () => {
        throw { code: "unavailable", message: "microphone off" };
      },
    });
    const opening = openShellVoiceAudio(START);
    expect(settledShellVoiceAudio()).toBe(opening);
    expect(await opening).toBeNull();
    expect(shellVoiceAudio()).toBeNull();
    expect(settledShellVoiceAudio()).toBeNull();
  });

  it("lets go of an open that the conversation ended meanwhile", async () => {
    let answer!: (value: unknown) => void;
    const request = voiceShell({
      "voiceAudio.open": () => new Promise((resolve) => (answer = resolve)),
    });
    const opening = openShellVoiceAudio(START);
    await settle();
    closeShellVoiceAudio();
    answer(OPENED);

    expect(await opening).toBeNull();
    expect(shellVoiceAudio()).toBeNull();
    expect(request).toHaveBeenCalledWith("voiceAudio.close", undefined);
  });
});

describe("the voice through the app shell", () => {
  it("passes the voice's base64 through as it is, and refuses what is no PCM", async () => {
    const { request, voice } = await opened();
    const queue = createShellVoiceQueue(vi.fn());
    const audio = pcm(200);

    expect(queue.enqueue(voice, { audio, sampleRate: RATE })).toBe(true);
    expect(queue.active).toBe(true);
    expect(request).toHaveBeenCalledWith("voiceAudio.play", {
      id: expect.any(String),
      audio,
      sampleRate: RATE,
    });

    expect(queue.enqueue(voice, { audio: "AQID", sampleRate: RATE })).toBe(
      false,
    );
    expect(queue.enqueue(voice, { audio, sampleRate: 4000 })).toBe(false);
    expect(played(request)).toHaveLength(1);
  });

  it("logs each piece as it starts to be heard and drains once all are heard", async () => {
    const { request, voice } = await opened();
    const drained = vi.fn();
    const scheduled = vi.fn();
    const queue = createShellVoiceQueue(drained, scheduled);
    queue.enqueue(voice, { audio: pcm(500), sampleRate: RATE, text: "Hallo." });
    queue.enqueue(voice, { audio: pcm(250), sampleRate: RATE });
    const [first, second] = played(request);

    emitHostShellEvent("voiceAudio.started", { id: first.id, at: 1_000_000 });
    expect(scheduled).toHaveBeenLastCalledWith("Hallo.", 1000, 1000.5);
    emitHostShellEvent("voiceAudio.played", {
      id: first.id,
      at: 1_000_500,
      durationMs: 500,
    });
    expect(drained).not.toHaveBeenCalled();

    // A restart for a new route starts the piece again: it is said once.
    emitHostShellEvent("voiceAudio.started", { id: second.id, at: 1_000_500 });
    emitHostShellEvent("voiceAudio.started", { id: second.id, at: 1_000_600 });
    expect(scheduled).toHaveBeenCalledTimes(2);
    expect(scheduled).toHaveBeenLastCalledWith(undefined, 1000.5, 1000.75);
    emitHostShellEvent("voiceAudio.played", {
      id: second.id,
      at: 1_000_850,
      durationMs: 250,
    });
    expect(drained).toHaveBeenCalledOnce();
    expect(queue.active).toBe(false);
  });

  it("gets back what was not heard to its end when it is talked over", async () => {
    let unplayed: string[] = [];
    const { request, voice } = await opened({
      "voiceAudio.stop": () => ({ unplayed }),
    });
    const drained = vi.fn();
    const queue = createShellVoiceQueue(drained);
    const chunks = [pcm(100), pcm(200), pcm(300)].map((audio) => ({
      audio,
      sampleRate: RATE,
    }));
    for (const chunk of chunks) queue.enqueue(voice, chunk);
    const ids = played(request).map(({ id }) => id);
    // The first piece ended just before the stop; its event is still on its way.
    unplayed = [ids[1], ids[2]];

    const held = queue.pause();
    expect(held).toEqual(chunks);
    expect(queue.active).toBe(false);
    await settle();

    expect(held).toEqual([chunks[1], chunks[2]]);
    expect(drained).not.toHaveBeenCalled();
    emitHostShellEvent("voiceAudio.played", {
      id: ids[0],
      at: 1,
      durationMs: 1,
    });
    expect(drained).not.toHaveBeenCalled();
  });

  it("stops only what its own queue has in the shell, and plays again what that silenced of another", async () => {
    let unplayed: string[] = [];
    const { request, voice } = await opened({
      "voiceAudio.stop": () => ({ unplayed }),
    });
    const stops = () =>
      request.mock.calls.filter(([method]) => method === "voiceAudio.stop");
    const line = createShellVoiceQueue(vi.fn());
    const reply = createShellVoiceQueue(vi.fn());

    line.stop();
    expect(stops()).toHaveLength(0);

    const answer = { audio: pcm(300), sampleRate: RATE };
    reply.enqueue(voice, answer);
    line.enqueue(voice, { audio: pcm(100), sampleRate: RATE });
    const [replyPiece, linePiece] = played(request);
    unplayed = [replyPiece.id, linePiece.id];
    line.stop();
    await settle();

    expect(stops()).toHaveLength(1);
    expect(played(request)).toHaveLength(3);
    expect(played(request)[2]).toMatchObject({ audio: answer.audio });
    expect(played(request)[2].id).not.toBe(replyPiece.id);
    expect(reply.active).toBe(true);
  });

  it("lowers the voice", async () => {
    const { request, voice } = await opened();
    voice.lower(true);
    voice.lower(false);
    expect(request).toHaveBeenCalledWith("voiceAudio.lower", { lowered: true });
    expect(request).toHaveBeenCalledWith("voiceAudio.lower", {
      lowered: false,
    });
  });

  it("follows the shell's route", async () => {
    const { voice } = await opened();
    emitHostShellEvent("voiceAudio.route", {
      output: "bluetooth",
      outputDelayMs: 180,
      inputDelayMs: 90,
      microphoneMode: "voiceIsolation",
    });
    expect(voice).toMatchObject({ outputDelayMs: 180, inputDelayMs: 90 });
  });
});

describe("interruptions of the app shell's voice audio", () => {
  it("pauses through an interruption and goes on after it", async () => {
    const { voice } = await opened();
    const states = vi.fn();
    voice.onStateChange(states);

    emitHostShellEvent("voiceAudio.interrupted", { reason: "system" });
    expect(voice.state).toBe("interrupted");
    emitHostShellEvent("voiceAudio.resumed", {});
    expect(voice.state).toBe("running");
    expect(states.mock.calls).toEqual([["interrupted"], ["running"]]);
  });

  it("ends every voice and the session when the shell closes it", async () => {
    const { voice } = await opened();
    const states = vi.fn();
    const drained = vi.fn();
    voice.onStateChange(states);
    const queue = createShellVoiceQueue(drained);
    queue.enqueue(voice, { audio: pcm(200), sampleRate: RATE });

    emitHostShellEvent("voiceAudio.closed", { reason: "mediaServicesReset" });

    expect(voice.state).toBe("closed");
    expect(states).toHaveBeenCalledWith("closed");
    expect(shellVoiceAudio()).toBeNull();
    expect(drained).toHaveBeenCalledOnce();
    expect(queue.active).toBe(false);
    expect(queue.enqueue(voice, { audio: pcm(200), sampleRate: RATE })).toBe(
      false,
    );
  });

  it("reports no loss when the page closes it itself", async () => {
    const { request, voice } = await opened();
    const states = vi.fn();
    voice.onStateChange(states);

    closeShellVoiceAudio();

    expect(request).toHaveBeenCalledWith("voiceAudio.close", undefined);
    expect(voice.state).toBe("closed");
    expect(states).not.toHaveBeenCalled();
  });
});

describe("the microphone through the app shell", () => {
  it("hands each frame on as samples, with the time it came", async () => {
    const { voice } = await opened();
    const heard = vi.fn();
    const stop = voice.onInput(heard);

    emitHostShellEvent("voiceAudio.input", {
      seq: 1,
      at: 5000,
      samples: pcm16([0, 16384, -32768, 32767]),
    });

    expect(heard).toHaveBeenCalledOnce();
    const [{ samples, at }] = heard.mock.calls[0] as [
      { samples: Float32Array; at: number },
    ];
    expect(at).toBe(5000);
    expect(samples).toBeInstanceOf(Float32Array);
    expect([...samples]).toEqual([0, 0.5, -1, 32767 / 32768]);

    stop();
    emitHostShellEvent("voiceAudio.input", { seq: 2, at: 5032, samples: "" });
    expect(heard).toHaveBeenCalledOnce();
  });
});
