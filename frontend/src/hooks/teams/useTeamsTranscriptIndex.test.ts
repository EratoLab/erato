import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  teamsIndex,
  teamsMessage,
  teamsSection,
  teamsTranscriptFile,
  teamsTranscriptText,
  textFile,
} from "@/test/teamsTranscriptFixtures";

import {
  readTeamsTranscriptIndex,
  useTeamsTranscriptIndex,
  useTeamsTranscriptIndexes,
} from "./useTeamsTranscriptIndex";

const transcript = (title: string) =>
  teamsTranscriptFile(
    teamsIndex([teamsSection({ title })], [teamsMessage("m1")]),
  );

describe("readTeamsTranscriptIndex", () => {
  it("primes the cache, so the first render already knows the conversation", async () => {
    const file = transcript("Product sync");
    const index = await readTeamsTranscriptIndex(file);
    expect(index?.sections[0].title).toBe("Product sync");

    const { result } = renderHook(() => useTeamsTranscriptIndex(file));
    expect(result.current.isReading).toBe(false);
    expect(result.current.index).toBe(index);
  });

  it("reads a file once however often it is asked", async () => {
    const text = vi.fn(() =>
      Promise.resolve(
        teamsTranscriptText(teamsIndex([teamsSection()], [teamsMessage("m1")])),
      ),
    );
    const file = new File(["x"], "teams-Product_sync.md");
    Object.defineProperty(file, "text", { value: text });
    const [first, second] = await Promise.all([
      readTeamsTranscriptIndex(file),
      readTeamsTranscriptIndex(file),
    ]);
    expect(first).toBe(second);
    await readTeamsTranscriptIndex(file);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("settles to null for a file without a block or that can't be read", async () => {
    expect(
      await readTeamsTranscriptIndex(textFile("plain", "a.md")),
    ).toBeNull();
    const broken = new File(["x"], "b.md");
    Object.defineProperty(broken, "text", {
      value: () => Promise.reject(new Error("gone")),
    });
    expect(await readTeamsTranscriptIndex(broken)).toBeNull();
  });
});

describe("useTeamsTranscriptIndexes", () => {
  it("reads several transcripts and keeps its map while nothing changes", async () => {
    const files = [transcript("Product sync"), transcript("Design review")];
    const { result, rerender } = renderHook(
      ({ list }) => useTeamsTranscriptIndexes(list),
      { initialProps: { list: files } },
    );
    expect([...result.current.values()].map((read) => read.isReading)).toEqual([
      true,
      true,
    ]);
    await waitFor(() =>
      expect(
        [...result.current.values()].every((read) => !read.isReading),
      ).toBe(true),
    );
    expect(
      files.map((file) => result.current.get(file)?.index?.sections[0].title),
    ).toEqual(["Product sync", "Design review"]);

    const settled = result.current;
    rerender({ list: files });
    expect(result.current).toBe(settled);
  });
});
