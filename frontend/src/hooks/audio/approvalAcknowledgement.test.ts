import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addCatalog, forgetLoadedCatalogs } from "@/lib/i18n";
import { messages as deMessages } from "@/locales/de/messages.json";
import { messages as enMessages } from "@/locales/en/messages.json";
import { messages as frMessages } from "@/locales/fr/messages.json";

import type { Messages } from "@lingui/core";

vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: () => () => {},
}));

/**
 * The sentence an approval by voice is answered with, in every language the
 * card may be in, and the guard against one that says a confirmation
 * phrase. The backend checks the built-in German and English sentences
 * against the voice command rules of both languages
 * (`approval_acknowledgement_sentences_are_never_commands`).
 */
const BUILT_IN = {
  de: "Gut, ich führe das jetzt aus.",
  en: "All right, I'm running it now.",
};

describe("the word that an approval by voice was taken", () => {
  let locale = "en";
  beforeEach(async () => {
    locale = i18n.locale;
    addCatalog("de", deMessages as unknown as Messages);
    addCatalog("en", enMessages as unknown as Messages);
    addCatalog("fr", frMessages as unknown as Messages);
    const { useSpeechPlayback } = await import("./speechPlayback");
    useSpeechPlayback.setState({ conversational: true, enabled: true });
  });
  afterEach(() => {
    i18n.activate(locale);
    forgetLoadedCatalogs();
  });

  it.each(Object.entries(BUILT_IN))(
    "is the catalog's sentence in %s, whatever the screen shows",
    async (language, text) => {
      const { loadApprovalNotice } = await import("./approvalSpeech");
      for (const screen of ["en", "de"]) {
        i18n.activate(screen);
        expect(
          loadApprovalNotice("m", { kind: "approved" }, language)?.text,
        ).toBe(text);
      }
    },
  );

  it("a language without its own wording says the English one, never a phrase", async () => {
    const { loadApprovalNotice } = await import("./approvalSpeech");
    const { holdsConfirmationPhrase } = await import(
      "./approvalAcknowledgement"
    );
    i18n.activate("de");
    const text = loadApprovalNotice("m", { kind: "approved" }, "fr")?.text;
    expect(text).toBe(BUILT_IN.en);
    expect(holdsConfirmationPhrase(text ?? "")).toBe(false);
  });

  it("nothing is loaded while audio mode does not speak", async () => {
    const { useSpeechPlayback } = await import("./speechPlayback");
    const { loadApprovalNotice } = await import("./approvalSpeech");
    useSpeechPlayback.setState({ conversational: true, enabled: false });
    expect(loadApprovalNotice("m", { kind: "approved" }, "de")).toBeNull();
  });

  it.each([
    ["Ich bestätige.", true],
    ["Gut, ich bestätige das.", true],
    ["I confirm, running it now.", true],
    ["Ich bestaetige", true],
    [BUILT_IN.de, false],
    [BUILT_IN.en, false],
    ["Bestätigt, ich führe das aus.", false],
  ])("%s holds a confirmation phrase: %s", async (text, holds) => {
    const { holdsConfirmationPhrase } = await import(
      "./approvalAcknowledgement"
    );
    expect(holdsConfirmationPhrase(text)).toBe(holds);
  });
});
