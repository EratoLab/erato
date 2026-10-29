import { expect, test } from "@playwright/test";
import { installMicrophoneFixture } from "./helpers/microphone";
import { chatIsReadyToChat, selectModel } from "./shared";
import { TAG_CI } from "./tags";

type ObservedEvent = {
  event: string;
  at: number;
  sequence?: number;
  text?: string;
};
declare global {
  interface Window {
    audioBackEvents: ObservedEvent[];
  }
}

test(
  "microphone Audio-back streams text independently and saves replay",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(90_000);
    await installMicrophoneFixture(page);
    await page.addInitScript(() => {
      window.audioBackEvents = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const input = args[0];
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/messages/submitstream") && response.body) {
          const reader = response.clone().body!.getReader();
          void (async () => {
            const decoder = new TextDecoder();
            let pending = "";
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              pending += decoder.decode(value, { stream: true });
              let boundary: number;
              while ((boundary = pending.indexOf("\n\n")) !== -1) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                const event = frame.match(/^event: ?(.+)$/m)?.[1];
                const data = frame.match(/^data: ?(.+)$/m)?.[1];
                if (!event || !data) continue;
                const body = JSON.parse(data);
                window.audioBackEvents.push({
                  event,
                  at: performance.now(),
                  sequence: body.sequence,
                  text: body.new_text,
                });
              }
            }
          })();
        }
        return response;
      };
    });
    let submissions = 0;
    page.on("request", (request) => {
      if (request.url().includes("/messages/submitstream")) submissions++;
    });
    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectModel(page, "Mock-LLM");
    await page.getByTestId("chat-input-audio-mode-start").click();
    const audioBack = page.getByRole("button", {
      name: "Audio-back",
      exact: true,
    });
    await expect(audioBack).toBeVisible();
    if ((await audioBack.getAttribute("aria-pressed")) !== "true")
      await audioBack.click();
    await expect(
      page.getByTestId("chat-input-audio-mode-recording-waveform"),
    ).toBeVisible({ timeout: 30_000 });
    const submitted = page.waitForRequest((request) =>
      request.url().includes("/messages/submitstream"),
    );
    await page.evaluate(() => window.playMicrophoneFixture());
    const request = await submitted;
    expect(request.postDataJSON()).toMatchObject({
      user_message: "Bitte Erzähl mir etwas über die Historie von Augsburg.",
      conversational_audio_back: true,
      chat_provider_id: "mock-llm-openai",
    });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.audioBackEvents.some((e) => e.event === "stream_end"),
          ),
        { timeout: 45_000 },
      )
      .toBe(true);
    const events = await page.evaluate(() => window.audioBackEvents);
    expect(
      events.some((e) => e.event === "audio_error" || e.event === "error"),
    ).toBe(false);
    const text = events.filter((e) => e.event === "text_delta");
    const audio = events.filter((e) => e.event === "audio_delta");
    expect(text.map((e) => e.text).join("")).toContain(
      "Leopold Mozart verbunden.",
    );
    expect(audio.length).toBeGreaterThan(100);
    // Slow synthesis must not hold up the text stream. The service mock delays
    // first audio by five seconds; text is independently emitted in ~1.5 seconds.
    expect(text.at(-1)!.at).toBeLessThan(audio[0].at);
    expect(audio.map((e) => e.sequence)).toEqual(audio.map((_, i) => i));
    await expect(page.getByLabel("Replay audio response")).toBeVisible();
    await page.getByTestId("chat-input-exit-audio-mode").click();
    await page.reload();
    const replay = page.getByLabel("Replay audio response");
    await expect(replay).toBeVisible();
    await replay.evaluate(async (element: HTMLAudioElement) => {
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() =>
        replay.evaluate((element: HTMLAudioElement) => element.currentTime),
      )
      .toBeGreaterThan(0);
    expect(submissions).toBe(1);
  },
);
