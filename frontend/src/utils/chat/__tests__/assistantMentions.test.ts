import { describe, it, expect } from "vitest";

import {
  applyMentionSelection,
  detectMentionTrigger,
  findMentionRanges,
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

describe("findMentionRanges", () => {
  it("finds nothing for a name nobody tracked", () => {
    expect(findMentionRanges("@Researcher please", [])).toEqual([]);
  });

  it("finds a mention at the very start", () => {
    expect(findMentionRanges("@Data now", [dataAssistant])).toEqual([
      { start: 0, end: 5, id: "a2", name: "Data" },
    ]);
  });

  it("finds a mention mid-sentence", () => {
    expect(findMentionRanges("please ask @Data now", [dataAssistant])).toEqual([
      { start: 11, end: 16, id: "a2", name: "Data" },
    ]);
  });

  it("skips an address-like @", () => {
    expect(findMentionRanges("mail me@Data now", [dataAssistant])).toEqual([]);
  });

  it("returns one range per repetition", () => {
    expect(
      findMentionRanges("@Data and @Data", [dataAssistant]).map(
        (range) => range.start,
      ),
    ).toEqual([0, 10]);
  });

  it("spans a name with spaces", () => {
    expect(findMentionRanges("@Data Analyst please", [dataAnalyst])).toEqual([
      { start: 0, end: 13, id: "a3", name: "Data Analyst" },
    ]);
  });

  it("gives an overlapping span to the longer name", () => {
    expect(
      findMentionRanges("@Data Analyst please", [dataAssistant, dataAnalyst]),
    ).toEqual([{ start: 0, end: 13, id: "a3", name: "Data Analyst" }]);
  });

  it("treats regex metacharacters in a name literally", () => {
    expect(findMentionRanges("ping @C++ (v1.0)", [regexName])).toEqual([
      { start: 5, end: 16, id: "a4", name: "C++ (v1.0)" },
    ]);
    expect(findMentionRanges("ping @Cxx (v1x0)", [regexName])).toEqual([]);
  });

  it("orders ranges by position rather than by tracked order", () => {
    expect(
      findMentionRanges("@Data then @Researcher", [
        researcher,
        dataAssistant,
      ]).map((range) => range.id),
    ).toEqual(["a2", "a1"]);
  });

  it("bounds every range to exactly its token", () => {
    const text = "ask @Data Analyst and @Researcher.";
    expect(
      findMentionRanges(text, [researcher, dataAssistant, dataAnalyst]).map(
        (range) => text.slice(range.start, range.end),
      ),
    ).toEqual(["@Data Analyst", "@Researcher"]);
  });

  it("agrees with the ids the composer submits", () => {
    const text = "@Data and @Data Analyst and @Researcher";
    const tracked = [researcher, dataAssistant, dataAnalyst];
    expect(new Set(findMentionRanges(text, tracked).map((r) => r.id))).toEqual(
      new Set(resolveMentionedAssistantIds(text, tracked)),
    );
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
