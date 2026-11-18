import { afterEach, describe, expect, it } from "vitest";

import {
  dictatedTurnFor,
  userTurnsBefore,
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
  it("a chat with nothing dictated hands over nothing", () => {
    expect(
      userTurnsBefore("s1", { u1: user("Getippt.") }, ["u1"], "card"),
    ).toEqual([]);
  });

  it("a message sent from transcripts is dictated whole", () => {
    noteDictatedTranscript("s1", "Schreib dem Kunden:");
    noteDictatedTranscript("s1", "Das Angebot kommt bis Freitag.");
    settleDictation("s1", "Schreib dem Kunden: Das Angebot kommt bis Freitag.");
    expect(
      dictatedTurnFor(
        "s1",
        "Schreib dem Kunden: Das Angebot kommt bis Freitag.",
      ),
    ).toEqual({
      text: "Schreib dem Kunden: Das Angebot kommt bis Freitag.",
      passages: ["Schreib dem Kunden: Das Angebot kommt bis Freitag."],
      whole: true,
    });
  });

  it("a typed message is not", () => {
    settleDictation("s1", "Das Angebot kommt bis Freitag.");
    expect(
      dictatedTurnFor("s1", "Das Angebot kommt bis Freitag."),
    ).toBeUndefined();
  });

  it("typing into a dictation keeps only what is still as heard, and marks the message as not whole", () => {
    noteDictatedTranscript("s1", "Das Angebot kommt bis Freitag.");
    settleDictation("s1", "Bitte notieren: Das Angebot kommt bis Freitag.");
    expect(
      dictatedTurnFor("s1", "Bitte notieren: Das Angebot kommt bis Freitag."),
    ).toEqual({
      text: "Bitte notieren: Das Angebot kommt bis Freitag.",
      passages: ["Das Angebot kommt bis Freitag."],
      whole: false,
    });
  });

  it("transcripts belong to their composer, and to one message only", () => {
    noteDictatedTranscript("other", "Das Angebot kommt bis Freitag.");
    settleDictation("s1", "Das Angebot kommt bis Freitag.");
    expect(
      dictatedTurnFor("s1", "Das Angebot kommt bis Freitag."),
    ).toBeUndefined();

    noteDictatedTranscript("s1", "Termin am Montag.");
    settleDictation("s1", "Termin am Montag.");
    // The next message of the same composer is typed.
    settleDictation("s1", "Termin am Dienstag.");
    expect(dictatedTurnFor("s1", "Termin am Dienstag.")).toBeUndefined();
  });

  it("the same words typed in another chat are not dictated there", () => {
    noteDictatedTranscript("chat-a", "Das Angebot kommt bis Freitag.");
    settleDictation("chat-a", "Das Angebot kommt bis Freitag.");
    settleDictation("chat-b", "Das Angebot kommt bis Freitag.");
    const messages = { u1: user("Das Angebot kommt bis Freitag.") };
    expect(userTurnsBefore("chat-b", messages, ["u1"], "card")).toEqual([]);
    expect(userTurnsBefore("chat-a", messages, ["u1"], "card")).toEqual([
      {
        text: "Das Angebot kommt bis Freitag.",
        passages: ["Das Angebot kommt bis Freitag."],
        whole: true,
      },
    ]);
  });

  it("hands over the user's messages before a card, the latest first, typed ones too", () => {
    for (const text of [
      "Erster diktierter Text.",
      "Zweiter diktierter Text.",
      "Nach der Karte.",
    ]) {
      noteDictatedTranscript("s1", text);
      settleDictation("s1", text);
    }
    const messages = {
      u1: user("Erster diktierter Text."),
      a1: assistant("Erster diktierter Text."),
      u2: user("Getippt."),
      u3: user("Zweiter diktierter Text."),
      card: assistant("Ich lege das an."),
      u4: user("Nach der Karte."),
    };
    expect(
      userTurnsBefore(
        "s1",
        messages,
        ["u1", "a1", "u2", "u3", "card", "u4"],
        "card",
      ),
    ).toEqual([
      {
        text: "Zweiter diktierter Text.",
        passages: ["Zweiter diktierter Text."],
        whole: true,
      },
      { text: "Getippt.", passages: [], whole: false },
      {
        text: "Erster diktierter Text.",
        passages: ["Erster diktierter Text."],
        whole: true,
      },
    ]);
  });
});
