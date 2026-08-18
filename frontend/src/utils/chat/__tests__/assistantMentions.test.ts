import { describe, it, expect } from "vitest";

import {
  applyMentionSelection,
  detectMentionTrigger,
  mentionToken,
  pruneTrackedMentions,
  resolveMentionedAssistantIds,
} from "../assistantMentions";

import type { AssistantMention } from "../assistantMentions";

const researcher: AssistantMention = { id: "a1", name: "Researcher" };
const dataAssistant: AssistantMention = { id: "a2", name: "Data" };
const dataAnalyst: AssistantMention = { id: "a3", name: "Data Analyst" };
const regexName: AssistantMention = { id: "a4", name: "C++ (v1.0)" };

describe("detectMentionTrigger", () => {
  it("triggers on an @ at the very start", () => {
    expect(detectMentionTrigger("@")).toEqual({ query: "", startIndex: 0 });
  });

  it("triggers mid-sentence after whitespace", () => {
    expect(detectMentionTrigger("ask @res")).toEqual({
      query: "res",
      startIndex: 4,
    });
  });

  it("triggers after a newline", () => {
    expect(detectMentionTrigger("first line\n@re")).toEqual({
      query: "re",
      startIndex: 11,
    });
  });

  it("does not trigger inside an email address", () => {
    expect(detectMentionTrigger("mail a@b.com")).toBeNull();
    expect(detectMentionTrigger("mail a@")).toBeNull();
  });

  it("does not trigger on consecutive @", () => {
    expect(detectMentionTrigger("@@")).toBeNull();
    expect(detectMentionTrigger("hi @@re")).toBeNull();
  });

  it("does not trigger once a second @ follows the query", () => {
    expect(detectMentionTrigger("@user@host")).toBeNull();
  });

  it("stops triggering once the query passes the length cap", () => {
    expect(detectMentionTrigger(`@${"x".repeat(40)}`)).not.toBeNull();
    expect(detectMentionTrigger(`@${"x".repeat(41)}`)).toBeNull();
  });

  it("stops triggering once a space follows the @", () => {
    expect(detectMentionTrigger("@Data ")).toBeNull();
  });

  it("reports the index of the @ within the full text", () => {
    const text = "please ask @dat about it";
    const caret = "please ask @dat".length;
    const trigger = detectMentionTrigger(text.slice(0, caret));
    expect(trigger?.startIndex).toBe(11);
    expect(text[trigger?.startIndex ?? -1]).toBe("@");
  });
});

describe("applyMentionSelection", () => {
  it("replaces the query fragment and leaves one trailing space", () => {
    const text = "@res";
    const trigger = detectMentionTrigger(text);
    expect(
      applyMentionSelection(text, text.length, trigger!, "Researcher"),
    ).toEqual({ text: "@Researcher ", caret: 12 });
  });

  it("inserts mid-sentence without doubling the following space", () => {
    const text = "ask @res about it";
    const caret = "ask @res".length;
    const trigger = detectMentionTrigger(text.slice(0, caret));
    expect(applyMentionSelection(text, caret, trigger!, "Researcher")).toEqual({
      text: "ask @Researcher about it",
      caret: "ask @Researcher ".length,
    });
  });

  it("keeps names with spaces intact", () => {
    const text = "@dat";
    const trigger = detectMentionTrigger(text);
    expect(
      applyMentionSelection(text, text.length, trigger!, "Data Analyst"),
    ).toEqual({ text: "@Data Analyst ", caret: 14 });
  });

  it("expands a bare @ with no query", () => {
    const text = "hello @";
    const trigger = detectMentionTrigger(text);
    expect(applyMentionSelection(text, text.length, trigger!, "Data")).toEqual({
      text: "hello @Data ",
      caret: 12,
    });
  });
});

describe("resolveMentionedAssistantIds", () => {
  it("returns nothing when no token survives in the text", () => {
    expect(resolveMentionedAssistantIds("plain text", [researcher])).toEqual(
      [],
    );
  });

  it("drops a mention whose token was deleted", () => {
    expect(
      resolveMentionedAssistantIds("@Resear please help", [researcher]),
    ).toEqual([]);
  });

  it("preserves tracked order rather than text order", () => {
    expect(
      resolveMentionedAssistantIds("@Data then @Researcher", [
        researcher,
        dataAssistant,
      ]),
    ).toEqual(["a1", "a2"]);
  });

  it("dedupes an assistant mentioned twice", () => {
    expect(
      resolveMentionedAssistantIds("@Researcher and @Researcher", [
        researcher,
        researcher,
      ]),
    ).toEqual(["a1"]);
  });

  it("does not let a prefix name ride along on a longer one", () => {
    expect(
      resolveMentionedAssistantIds("@Data Analyst please", [
        dataAssistant,
        dataAnalyst,
      ]),
    ).toEqual(["a3"]);
  });

  it("resolves both when the prefix name is mentioned on its own too", () => {
    expect(
      resolveMentionedAssistantIds("@Data and @Data Analyst", [
        dataAssistant,
        dataAnalyst,
      ]),
    ).toEqual(["a2", "a3"]);
  });

  it("treats names with regex metacharacters literally", () => {
    expect(resolveMentionedAssistantIds("@C++ (v1.0) hi", [regexName])).toEqual(
      ["a4"],
    );
    expect(resolveMentionedAssistantIds("@Cxx (v1x0) hi", [regexName])).toEqual(
      [],
    );
  });

  it("ignores a token glued to the end of a word", () => {
    expect(
      resolveMentionedAssistantIds("mail me@Data now", [dataAssistant]),
    ).toEqual([]);
  });

  it("ignores a token that continues into a longer word", () => {
    expect(
      resolveMentionedAssistantIds("check the @Database rows", [dataAssistant]),
    ).toEqual([]);
    expect(
      resolveMentionedAssistantIds("@Researchers meeting", [researcher]),
    ).toEqual([]);
  });

  it("counts a token closed by punctuation", () => {
    expect(
      resolveMentionedAssistantIds("@Data, please help", [dataAssistant]),
    ).toEqual(["a2"]);
    expect(
      resolveMentionedAssistantIds("ask @Researcher.", [researcher]),
    ).toEqual(["a1"]);
  });
});

describe("pruneTrackedMentions", () => {
  it("keeps the array identity when nothing was dropped", () => {
    const tracked = [researcher, dataAssistant];
    expect(pruneTrackedMentions("@Researcher @Data", tracked)).toBe(tracked);
  });

  it("drops entries whose token is gone", () => {
    expect(
      pruneTrackedMentions("@Researcher only", [researcher, dataAssistant]),
    ).toEqual([researcher]);
  });

  it("drops an entry whose token grew into a longer word", () => {
    expect(pruneTrackedMentions("@Database rows", [dataAssistant])).toEqual([]);
  });

  it("collapses a duplicate tracking entry", () => {
    expect(
      pruneTrackedMentions("@Researcher and @Researcher", [
        researcher,
        researcher,
      ]),
    ).toEqual([researcher]);
  });
});

describe("mentionToken", () => {
  it("is the rendering that insertion and reconciliation share", () => {
    const text = applyMentionSelection(
      "@d",
      2,
      detectMentionTrigger("@d")!,
      dataAnalyst.name,
    ).text;
    expect(text.startsWith(mentionToken(dataAnalyst.name))).toBe(true);
    expect(resolveMentionedAssistantIds(text, [dataAnalyst])).toEqual(["a3"]);
  });
});
