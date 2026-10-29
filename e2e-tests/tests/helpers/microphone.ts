import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    playMicrophoneFixture: () => Promise<void>;
  }
}

/** Reuse the audio-recorder unit test's WAV through the browser capture API. */
export async function installMicrophoneFixture(page: Page) {
  const file = fileURLToPath(
    new URL(
      "../../../frontend/src/hooks/audio/__tests__/fixtures/sales-summary-1-3.wav",
      import.meta.url,
    ),
  );
  await page.addInitScript((base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const captures: Array<{
      context: AudioContext;
      destination: MediaStreamAudioDestinationNode;
    }> = [];
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        // Keep delivering silence after the fixture ends, so real VAD can detect
        // end-of-speech and restarted recording cannot submit another utterance.
        const silence = context.createConstantSource();
        silence.offset.value = 0;
        silence.connect(destination);
        silence.start();
        destination.stream.getTracks()[0].addEventListener("ended", () => {
          silence.stop();
          void context.close();
        });
        captures.push({ context, destination });
        await context.resume();
        return destination.stream;
      },
    });
    window.playMicrophoneFixture = async () => {
      const capture = captures.at(-1);
      if (!capture) throw new Error("Microphone has not opened");
      const source = capture.context.createBufferSource();
      source.buffer = await capture.context.decodeAudioData(
        bytes.buffer.slice(0),
      );
      source.connect(capture.destination);
      await capture.context.resume();
      source.start();
    };
  }, readFileSync(file).toString("base64"));
}
