import { afterEach, describe, expect, it } from "vitest";

import {
  dictatedTurnOf,
  dictatedTurnsBefore,
  forgetDictation,
  noteDictatedTranscript,
  settleDictation,
} from "./dictatedTurns";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const user = (text: string) => ({
  role: "user",
  content: [{ content_type: "text", text } as ContentPart],
});
const assistant = (text: string) => ({ ...user(text), role: "assistant" });

afterEach(forgetDictation);

describe("the words a user dictated, per sent message", () => {
  it("a message sent from transcripts is dictated", () => {
    noteDictatedTranscript("s1", "Schreib dem Kunden:");
    noteDictatedTranscript("s1", "Das Angebot kommt bis Freitag.");
    settleDictation("s1", "Schreib dem Kunden: Das Angebot kommt bis Freitag.");
    expect(
      dictatedTurnOf("Schreib dem Kunden: Das Angebot kommt bis Freitag."),
    ).toEqual({
      passages: ["Schreib dem Kunden: Das Angebot kommt bis Freitag."],
    });
  });

  it("a typed message is not", () => {
    settleDictation("s1", "Das Angebot kommt bis Freitag.");
    expect(dictatedTurnOf("Das Angebot kommt bis Freitag.")).toBeUndefined();
  });

  it("typing into a dictation keeps only what is still as heard", () => {
    noteDictatedTranscript("s1", "Das Angebot kommt bis Freitag.");
    settleDictation("s1", "Bitte notieren: Das Angebot kommt bis Freitag.");
    expect(
      dictatedTurnOf("Bitte notieren: Das Angebot kommt bis Freitag."),
    ).toEqual({ passages: ["Das Angebot kommt bis Freitag."] });
  });

  it("transcripts belong to their composer, and to one message only", () => {
    noteDictatedTranscript("other", "Das Angebot kommt bis Freitag.");
    settleDictation("s1", "Das Angebot kommt bis Freitag.");
    expect(dictatedTurnOf("Das Angebot kommt bis Freitag.")).toBeUndefined();

    noteDictatedTranscript("s1", "Termin am Montag.");
    settleDictation("s1", "Termin am Montag.");
    // The next message of the same composer is typed.
    settleDictation("s1", "Termin am Dienstag.");
    expect(dictatedTurnOf("Termin am Dienstag.")).toBeUndefined();
  });

  it("finds the dictated turns before a card, the latest first", () => {
    noteDictatedTranscript("s1", "Erster diktierter Text.");
    settleDictation("s1", "Erster diktierter Text.");
    noteDictatedTranscript("s1", "Zweiter diktierter Text.");
    settleDictation("s1", "Zweiter diktierter Text.");
    noteDictatedTranscript("s1", "Nach der Karte.");
    settleDictation("s1", "Nach der Karte.");
    const messages = {
      u1: user("Erster diktierter Text."),
      a1: assistant("Erster diktierter Text."),
      u2: user("Getippt."),
      u3: user("Zweiter diktierter Text."),
      card: assistant("Ich lege das an."),
      u4: user("Nach der Karte."),
    };
    expect(
      dictatedTurnsBefore(
        messages,
        ["u1", "a1", "u2", "u3", "card", "u4"],
        "card",
      ),
    ).toEqual([
      { passages: ["Zweiter diktierter Text."] },
      { passages: ["Erster diktierter Text."] },
    ]);
  });
});
