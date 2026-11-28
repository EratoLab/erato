import { afterEach, describe, expect, it, vi } from "vitest";

import { registerWorkInProgress } from "@/lib/chunkLoadRecovery";
import {
  emitHostShellEvent,
  installHostShell,
  removeHostShell,
  shellAnswers,
} from "@/test/hostShellStub";
import { pcm16 } from "@/test/pcm16";

import {
  closeShellVoiceAudio,
  createShellVoiceQueue,
  openShellVoiceAudio,
  settledShellVoiceAudio,
  shellVoiceAudio,
  shellVoiceAudioLost,
} from "./shellVoiceAudio";

vi.mock("@/lib/chunkLoadRecovery", () => ({
  registerWorkInProgress: vi.fn(),
}));

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
      "voiceAudio.flush": null,
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

const asked = (request: ReturnType<typeof voiceShell>, method: string) =>
  request.mock.calls.filter(([called]) => called === method);
const played = (request: ReturnType<typeof voiceShell>) =>
  asked(request, "voiceAudio.play").map(
    ([, params]) => params as { id: string; audio: string },
  );

/** An answer the test gives when it wants to. */
function later() {
  const answers: ((value: unknown) => void)[] = [];
  return {
    answer: () => new Promise((resolve) => answers.push(resolve)),
    give: (value: unknown = null) => answers.shift()?.(value),
  };
}

afterEach(async () => {
  closeShellVoiceAudio();
  await settle();
  removeHostShell();
});

describe("opening the app shell's voice audio", () => {
  it("opens it once for a conversation, with the page's start buffer", async () => {
    const { request, voice } = await opened();

    expect(asked(request, "voiceAudio.open")).toEqual([
      ["voiceAudio.open", { startBufferMs: 400, startMaxWaitMs: 350 }],
    ]);
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
    const reloadGuard = vi.mocked(registerWorkInProgress).mock.calls[0][0];
    expect(reloadGuard()).toBe(true);
    closeShellVoiceAudio();
    expect(reloadGuard()).toBe(false);
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

  it("keeps the one engine when the conversation stops and starts again while it opens", async () => {
    const open = later();
    const request = voiceShell({ "voiceAudio.open": open.answer });
    const first = openShellVoiceAudio(START);
    await settle();
    closeShellVoiceAudio();
    const again = openShellVoiceAudio(START);
    open.give(OPENED);

    expect(again).toBe(first);
    const voice = await again;
    expect(voice?.state).toBe("running");
    expect(shellVoiceAudio()).toBe(voice);
    expect(asked(request, "voiceAudio.open")).toHaveLength(1);
    expect(asked(request, "voiceAudio.close")).toHaveLength(0);
  });

  it("lets go of an open that the conversation ended meanwhile, without the page taking over", async () => {
    const open = later();
    const request = voiceShell({ "voiceAudio.open": open.answer });
    const opening = openShellVoiceAudio(START);
    await settle();
    closeShellVoiceAudio();
    open.give(OPENED);

    const voice = await opening;
    expect(voice?.state).toBe("closed");
    expect(shellVoiceAudio()).toBeNull();
    await settle();
    expect(asked(request, "voiceAudio.close")).toHaveLength(1);
  });

  it("gives back an engine the shell closed while it opened", async () => {
    const open = later();
    const request = voiceShell({ "voiceAudio.open": open.answer });
    const opening = openShellVoiceAudio(START);
    await settle();
    emitHostShellEvent("voiceAudio.closed", { reason: "failed" });
    open.give(OPENED);

    expect(await opening).toBeNull();
    await settle();
    expect(asked(request, "voiceAudio.close")).toHaveLength(1);
  });

  it("sends each request only once the one before it is answered", async () => {
    const play = later();
    const { request, voice } = await opened({ "voiceAudio.play": play.answer });
    const sent = () => request.mock.calls.slice(1).map(([method]) => method);
    const queue = createShellVoiceQueue(vi.fn());
    queue.enqueue(voice, { audio: pcm(100), sampleRate: RATE });
    queue.enqueue(voice, { audio: pcm(100), sampleRate: RATE });
    await settle();
    expect(sent()).toEqual(["voiceAudio.play"]);

    play.give();
    await settle();
    expect(sent()).toEqual(["voiceAudio.play", "voiceAudio.play"]);

    // Stopped before its turn: never sent.
    queue.enqueue(voice, { audio: pcm(100), sampleRate: RATE });
    queue.stop();
    play.give();
    await settle();
    expect(sent()).toEqual([
      "voiceAudio.play",
      "voiceAudio.play",
      "voiceAudio.stop",
    ]);
  });
});

describe("the voice through the app shell", () => {
  it("passes the voice's base64 through as it is, and fits what the shell takes", async () => {
    const { request, voice } = await opened();
    const queue = createShellVoiceQueue(vi.fn());
    const audio = pcm(200);

    expect(queue.enqueue(voice, { audio, sampleRate: RATE })).toBe(true);
    expect(queue.active).toBe(true);
    // Over 960,000 bytes: 20 s at 24 kHz.
    expect(queue.enqueue(voice, { audio: pcm(20_001), sampleRate: RATE })).toBe(
      false,
    );
    expect(queue.enqueue(voice, { audio: pcm(5), sampleRate: RATE })).toBe(
      true,
    );
    await settle();

    const [whole, short] = played(request);
    expect(whole).toEqual({ id: expect.any(String), audio, sampleRate: RATE });
    // Under the shell's 10 ms, silence follows the piece.
    expect(globalThis.atob(short.audio)).toHaveLength((RATE / 100) * 2);
  });

  it("logs each piece once as it starts to be heard, and drains once all are heard", async () => {
    const { request, voice } = await opened();
    const drained = vi.fn();
    const scheduled = vi.fn();
    const queue = createShellVoiceQueue(drained, scheduled);
    queue.enqueue(voice, { audio: pcm(500), sampleRate: RATE, text: "Hallo." });
    queue.enqueue(voice, { audio: pcm(250), sampleRate: RATE });
    await settle();
    const [first, second] = played(request);

    emitHostShellEvent("voiceAudio.started", { id: first.id, at: 1_000_000 });
    expect(scheduled).toHaveBeenLastCalledWith("Hallo.", 1000, 1000.5);
    // After an interruption the shell starts the piece again.
    emitHostShellEvent("voiceAudio.started", { id: first.id, at: 1_009_000 });
    expect(scheduled).toHaveBeenCalledOnce();
    emitHostShellEvent("voiceAudio.played", {
      id: first.id,
      at: 1_009_500,
      durationMs: 500,
    });
    expect(drained).not.toHaveBeenCalled();

    emitHostShellEvent("voiceAudio.started", { id: second.id, at: 1_009_500 });
    expect(scheduled).toHaveBeenLastCalledWith(undefined, 1009.5, 1009.75);
    emitHostShellEvent("voiceAudio.played", {
      id: second.id,
      at: 1_009_750,
      durationMs: 250,
    });
    expect(drained).toHaveBeenCalledOnce();
    expect(queue.active).toBe(false);
  });

  it("does not say again what the shell heard to its end before a pause", async () => {
    let unplayed: string[] = [];
    const { request, voice } = await opened({
      "voiceAudio.stop": () => ({ unplayed }),
    });
    const queue = createShellVoiceQueue(vi.fn());
    const chunks = [pcm(100), pcm(200), pcm(300)].map((audio) => ({
      audio,
      sampleRate: RATE,
    }));
    for (const chunk of chunks) queue.enqueue(voice, chunk);
    await settle();
    const ids = played(request).map(({ id }) => id);
    // The first piece ended just before the stop; its event is still on its way.
    unplayed = [ids[1], ids[2]];

    const held = queue.pause();
    expect(held).toEqual(chunks);
    expect(queue.active).toBe(false);
    for (const chunk of held) queue.enqueue(voice, chunk);
    await settle();

    expect(held).toEqual(chunks);
    expect(
      played(request)
        .slice(3)
        .map(({ audio }) => audio),
    ).toEqual([chunks[1].audio, chunks[2].audio]);
    expect(queue.active).toBe(true);
  });

  it("stops only what its own queue has in the shell, and plays again first what that silenced of another", async () => {
    let unplayed: string[] = [];
    const { request, voice } = await opened({
      "voiceAudio.stop": () => ({ unplayed }),
    });
    const line = createShellVoiceQueue(vi.fn());
    const reply = createShellVoiceQueue(vi.fn());

    line.stop();
    await settle();
    expect(asked(request, "voiceAudio.stop")).toHaveLength(0);

    const answer = { audio: pcm(300), sampleRate: RATE };
    reply.enqueue(voice, answer);
    line.enqueue(voice, { audio: pcm(100), sampleRate: RATE });
    await settle();
    const [replyPiece, linePiece] = played(request);
    unplayed = [replyPiece.id, linePiece.id];
    line.stop();
    const after = { audio: pcm(50), sampleRate: RATE };
    reply.enqueue(voice, after);
    await settle();

    expect(asked(request, "voiceAudio.stop")).toHaveLength(1);
    expect(
      played(request)
        .slice(2)
        .map(({ audio }) => audio),
    ).toEqual([answer.audio, after.audio]);
    expect(played(request)[2].id).not.toBe(replyPiece.id);
    expect(reply.active).toBe(true);
  });

  it("plays what it has at once when told nothing more is coming", async () => {
    const { request, voice } = await opened();
    const queue = createShellVoiceQueue(vi.fn());
    queue.flush();
    queue.enqueue(voice, { audio: pcm(100), sampleRate: RATE });
    queue.flush();
    await settle();
    expect(asked(request, "voiceAudio.flush")).toHaveLength(1);
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
  it("keeps playing through an interruption, and says when it begins and ends", async () => {
    const { voice } = await opened();
    const states = vi.fn(() => voice.interrupted);
    voice.onStateChange(states);

    emitHostShellEvent("voiceAudio.interrupted", { reason: "system" });
    expect(voice).toMatchObject({ state: "running", interrupted: true });
    emitHostShellEvent("voiceAudio.resumed", {});
    expect(voice.interrupted).toBe(false);
    expect(states.mock.results.map(({ value }) => value)).toEqual([
      true,
      false,
    ]);
  });

  it("ends every voice and the session when the shell closes it, and expects a new open", async () => {
    const { voice } = await opened();
    const states = vi.fn();
    const drained = vi.fn();
    voice.onStateChange(states);
    const queue = createShellVoiceQueue(drained);
    queue.enqueue(voice, { audio: pcm(200), sampleRate: RATE });

    emitHostShellEvent("voiceAudio.closed", { reason: "mediaServicesReset" });

    expect(voice.state).toBe("closed");
    expect(states).toHaveBeenCalledOnce();
    expect(shellVoiceAudio()).toBeNull();
    expect(shellVoiceAudioLost()).toBe(true);
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
    await settle();

    expect(asked(request, "voiceAudio.close")).toHaveLength(1);
    expect(voice.state).toBe("closed");
    expect(shellVoiceAudioLost()).toBe(false);
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
