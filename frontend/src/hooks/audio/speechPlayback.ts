import { create } from "zustand";

interface SpeechState {
  conversational: boolean;
  enabled: boolean;
  playing: boolean;
  blocked: boolean;
  failed: boolean;
}
export const useSpeechPlayback = create<SpeechState>(() => ({
  conversational: false,
  enabled: false,
  playing: false,
  blocked: false,
  failed: false,
}));
let context: AudioContext | undefined;
let nextTime = 0;
const sources = new Set<AudioBufferSourceNode>();
const sequences = new Map<string, number>();
let activeMessage: string | undefined;
let accepting = false;
let acceptingStream: string | undefined;

export async function enableSpeechPlayback(enabled: boolean) {
  useSpeechPlayback.setState({ enabled, blocked: false, failed: false });
  if (!enabled) {
    stopSpeechPlayback();
    return;
  }
  try {
    context ??= new AudioContext();
    await context.resume();
    useSpeechPlayback.setState({ blocked: context.state !== "running" });
  } catch {
    useSpeechPlayback.setState({ blocked: true });
  }
}
export function stopSpeechPlayback(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  accepting = false;
  for (const source of sources) source.stop();
  sources.clear();
  nextTime = 0;
  useSpeechPlayback.setState({ playing: false });
}
export function beginSpeechResponse(streamKey?: string) {
  acceptingStream = streamKey;
  stopSpeechPlayback();
  activeMessage = undefined;
  accepting =
    useSpeechPlayback.getState().enabled &&
    useSpeechPlayback.getState().conversational;
  useSpeechPlayback.setState({ failed: false });
}
export function moveSpeechStream(from: string, to: string) {
  if (acceptingStream === from) acceptingStream = to;
}
export function speechFailed(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  stopSpeechPlayback();
  useSpeechPlayback.setState({ failed: true });
}
export function playSpeechChunk(
  messageId: string,
  sequence: number,
  audio: string,
  sampleRate: number,
  streamKey?: string,
) {
  const state = useSpeechPlayback.getState();
  if (
    (acceptingStream !== undefined && acceptingStream !== streamKey) ||
    !accepting ||
    !state.enabled ||
    !state.conversational ||
    (activeMessage && activeMessage !== messageId)
  )
    return;
  if (sequence <= (sequences.get(messageId) ?? -1)) return;
  sequences.set(messageId, sequence);
  if (sequences.size > 100) {
    const oldest = sequences.keys().next().value;
    if (oldest !== undefined) sequences.delete(oldest);
  }
  activeMessage = messageId;
  if (context?.state !== "running") {
    useSpeechPlayback.setState({ blocked: true });
    return; // The completed response remains available for explicit replay.
  }
  const raw = globalThis.atob(audio);
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (
    !bytes.length ||
    bytes.length % 2 !== 0 ||
    sampleRate < 8000 ||
    sampleRate > 192000
  ) {
    speechFailed();
    return;
  }
  const view = new DataView(bytes.buffer);
  const buffer = context.createBuffer(1, bytes.length / 2, sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++)
    samples[i] = view.getInt16(i * 2, true) / 32768;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const start = Math.max(context.currentTime + 0.03, nextTime);
  nextTime = start + buffer.duration;
  sources.add(source);
  useSpeechPlayback.setState({ playing: true });
  source.onended = () => {
    sources.delete(source);
    source.disconnect();
    if (!sources.size) useSpeechPlayback.setState({ playing: false });
  };
  source.start(start);
}
