import { describe, expect, it } from "vitest";

import { classifyOverVoiceTurn, echoCoverage } from "./overVoiceTurn";
import { foldSpokenWords } from "./spokenWords";

/** What the voice was saying around the spot it was talked over at. */
const VOICE =
  "Für den Kunden Müller habe ich drei offene Angebote gefunden. Einen Moment, das größte ist das Angebot über die neue Fertigungsstraße.";

const turn = (text: string, spokeOn = false, voiceText = VOICE) =>
  classifyOverVoiceTurn(text, { voiceText, spokeOn });

describe("a turn said over a reply's voice", () => {
  it("is nothing when it holds no words or only listening noise", () => {
    expect(turn("")).toBe("empty");
    expect(turn(" … ")).toBe("empty");
    expect(turn("Okay.")).toBe("empty");
    expect(turn("Mhm, genau.")).toBe("empty");
    expect(turn("Alles klar.")).toBe("empty");
    // A listener's "ja" over a long reading.
    expect(turn("Ja.")).toBe("empty");
    expect(turn("Ja, ja.")).toBe("empty");
  });

  it("is a stop when each segment is a stop, a leading no, noise or fillers", () => {
    expect(turn("Stopp!")).toBe("stop");
    expect(turn("Stopp, bitte.")).toBe("stop");
    expect(turn("Stopp, stopp!")).toBe("stop");
    expect(turn("Äh, hör auf.")).toBe("stop");
    expect(turn("Nein, stopp.")).toBe("stop");
    expect(turn("Nein stopp")).toBe("stop");
    expect(turn("Okay, warte.")).toBe("stop");
    expect(turn("Wait, wait")).toBe("stop");
    expect(turn("Stop reading, please")).toBe("stop");
  });

  it("is a message when a stop leads into more", () => {
    expect(turn("Stopp, was ist mit Schmidt?")).toBe("message");
    expect(turn("Moment, ich meinte das Angebot von gestern")).toBe("message");
  });

  it("is a message for a short real answer the voice was not saying", () => {
    for (const said of [
      "Nein.",
      "Warum?",
      "Und dann?",
      "Was heißt das?",
      "Am Freitag",
    ])
      expect(turn(said)).toBe("message");
  });

  it("is the voice's echo when it only repeats what the voice was saying", () => {
    expect(turn("drei offene Angebote gefunden")).toBe("echo");
    expect(turn("das größte ist das Angebot")).toBe("echo");
    expect(turn("Fertigungsstraße")).toBe("echo");
  });

  it("is the voice's echo when the recognizer misheard it slightly", () => {
    expect(turn("drei offen Angebot gefunden")).toBe("echo");
    expect(turn("für den Kunden Miller")).toBe("echo");
  });

  it("is the voice's echo when the voice itself said the stop phrase", () => {
    expect(turn("Einen Moment.")).toBe("echo");
    // The person said it on past the pause: theirs.
    expect(turn("Einen Moment.", true)).toBe("stop");
    // Not what the voice was saying: theirs.
    expect(turn("Halt!")).toBe("stop");
    // A word the stop only resembles is not the stop.
    expect(turn("Moment!", false, "Das ist momentan der Stand.")).toBe("stop");
    expect(turn("Warte!", false, "Wir warten noch.")).toBe("echo");
  });

  it("is the person's when their speech went on after the voice paused", () => {
    expect(turn("drei offene Angebote gefunden", true)).toBe("message");
  });

  it("is never echo when nothing was sounding", () => {
    expect(turn("drei offene Angebote gefunden", false, "")).toBe("message");
  });

  it("is a message when it only shares single words with the voice", () => {
    expect(turn("Zeig mir lieber die Angebote von Schmidt")).toBe("message");
    expect(turn("Und was ist mit dem Kunden Weber?")).toBe("message");
  });

  it("takes the deployment's words", () => {
    const stopWords = {
      stop: ["arrête", "sei mal leise"],
      fillers: ["donc", "mal"],
      noise_words: ["bon"],
      noise_phrases: [],
      leading_no: ["non"],
      yes_particles: ["oui"],
    };
    const read = (text: string) =>
      classifyOverVoiceTurn(text, {
        voiceText: VOICE,
        spokeOn: false,
        stopWords,
      });
    expect(read("Donc, arrête !")).toBe("stop");
    expect(read("Non, arrête.")).toBe("stop");
    expect(read("Bon.")).toBe("empty");
    expect(read("Oui.")).toBe("empty");
    // A stop phrase holding a filler still matches.
    expect(read("sei mal leise")).toBe("stop");
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
