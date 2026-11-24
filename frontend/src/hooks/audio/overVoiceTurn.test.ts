import { describe, expect, it } from "vitest";

import { classifyOverVoiceTurn, echoCoverage } from "./overVoiceTurn";
import { foldSpokenWords } from "./spokenWords";

/** What the voice was saying around the spot it was talked over at. */
const VOICE =
  "Für den Kunden Müller habe ich drei offene Angebote gefunden. Einen Moment, das größte ist das Angebot über die neue Fertigungsstraße.";

const turn = (text: string, spokeOn = false, voiceText = VOICE) =>
  classifyOverVoiceTurn(text, { voiceText, spokeOn });

describe("a turn said over a reply's voice", () => {
  it("is nothing when it holds no words", () => {
    expect(turn("")).toBe("empty");
    expect(turn(" … ")).toBe("empty");
  });

  it("is the next message whatever its words", () => {
    for (const said of [
      "Stopp!",
      "Okay.",
      "Nein.",
      "Warum?",
      "Und dann?",
      "Was heißt das?",
      "Zeig mir lieber die Angebote von Schmidt",
    ])
      expect(turn(said)).toBe("message");
  });

  it("is the voice's echo when it only repeats what the voice was saying", () => {
    expect(turn("drei offene Angebote gefunden")).toBe("echo");
    expect(turn("das größte ist das Angebot")).toBe("echo");
    expect(turn("Einen Moment.")).toBe("echo");
    expect(turn("Fertigungsstraße")).toBe("echo");
  });

  it("is the voice's echo when the recognizer misheard it slightly", () => {
    expect(turn("drei offen Angebot gefunden")).toBe("echo");
    expect(turn("für den Kunden Miller")).toBe("echo");
  });

  it("is the person's when their speech went on after the voice paused", () => {
    expect(turn("drei offene Angebote gefunden", true)).toBe("message");
  });

  it("is never echo when nothing was sounding", () => {
    expect(turn("drei offene Angebote gefunden", false, "")).toBe("message");
  });

  it("is a message when it only shares single words with the voice", () => {
    expect(turn("Und was ist mit dem Kunden Weber?")).toBe("message");
  });
});

describe("how much of a turn repeats the voice", () => {
  const coverage = (said: string, voice: string) =>
    echoCoverage(foldSpokenWords(said), foldSpokenWords(voice));

  it("counts stretches of two words or more", () => {
    expect(coverage("aaaa bbbb xxxx", "aaaa bbbb cccc")).toBeCloseTo(2 / 3);
    expect(coverage("aaaa xxxx bbbb", "aaaa bbbb cccc")).toBe(0);
  });

  it("counts a one-word turn by that word", () => {
    expect(coverage("bbbb", "aaaa bbbb cccc")).toBe(1);
    expect(coverage("dddd", "aaaa bbbb cccc")).toBe(0);
  });

  it("does not take short words for each other", () => {
    expect(coverage("das ist", "was ist")).toBe(0);
  });
});
