import { describe, expect, it } from "vitest";

import words from "@/lib/toolCallGist/fixtures/spokenNumberWords.json";

import { classifyOverVoiceTurn, echoCoverage } from "./overVoiceTurn";
import { foldSpokenWords } from "./spokenWords";

import type { NumberWords } from "@/lib/toolCallGist/spokenNumbers";

const GERMAN = (words as unknown as Record<"de", NumberWords>).de;

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
    expect(turn("Einen Moment, das größte")).toBe("echo");
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

describe("the voice's echo with numbers spelled another way (review 1)", () => {
  const AMOUNT =
    "Das Angebot liegt bei 48.500 Euro, freigegeben am 12. März 2025 von Frau Schneider.";
  const TIME = "Der Termin mit der Kessler GmbH ist am Dienstag um 14:30 Uhr.";
  const echo = (text: string, voiceText: string) =>
    classifyOverVoiceTurn(text, {
      voiceText,
      spokeOn: false,
      numberWords: GERMAN,
    });

  it("leaves numbers out on both sides", () => {
    expect(echo("Das Angebot liegt bei 48500 Euro", AMOUNT)).toBe("echo");
    expect(
      echo("Angebot liegt bei achtundvierzigtausendfünfhundert Euro", AMOUNT),
    ).toBe("echo");
    expect(
      echo(
        "am zwölften März zweitausendfünfundzwanzig von Frau Schneider",
        AMOUNT,
      ),
    ).toBe("echo");
    expect(
      echo("der Kessler GmbH ist am Dienstag um vierzehn Uhr dreißig", TIME),
    ).toBe("echo");
  });
});

describe("short real questions over the voice (review 2)", () => {
  const VOICE_SAID =
    "Freigegeben von Frau Schneider, Termin am Dienstag, das Budget liegt bei Peter.";

  it("are the person's, though they repeat a word the voice said", () => {
    for (const said of [
      "Schneider?",
      "Dienstag?",
      "Ja, das Budget",
      "Peter",
      "Frau Schneider?",
    ])
      expect(turn(said, false, VOICE_SAID)).toBe("message");
  });
});

describe("how much of a turn repeats the voice", () => {
  const coverage = (said: string, voice: string) =>
    echoCoverage(foldSpokenWords(said), foldSpokenWords(voice));

  it("counts stretches of three words or more", () => {
    expect(coverage("aaaa bbbb cccc xxxx", "aaaa bbbb cccc dddd")).toBe(3 / 4);
    expect(coverage("aaaa bbbb xxxx", "aaaa bbbb cccc")).toBe(0);
    expect(coverage("bbbb", "aaaa bbbb cccc")).toBe(0);
  });

  it("does not take short words for each other", () => {
    expect(coverage("das ist", "was ist")).toBe(0);
  });
});
