import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installHostShell, removeHostShell } from "@/test/hostShellStub";

import type {
  StartingAssistantResponse,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const profile = (preferences: Partial<UserProfile> = {}) =>
  ({ id: "user-1", ...preferences }) as UserProfile;

const orgDefault: StartingAssistantResponse = {
  starting_assistant: {
    assistant_id: "assistant-1",
    assistant_hub_assistant_id: "hub-1",
    source: "audience_pin",
    audience: "everyone",
  },
};

interface Data {
  profile: UserProfile;
  answer: StartingAssistantResponse | undefined;
  /** When each was fetched; the answer after the profile by default. */
  profileAt?: number;
  answerAt?: number;
  answerError?: unknown;
}

/** A fresh module graph per test: the page reports once per page load. */
async function mount(start: Data, seen: unknown[] = []) {
  let data = start;
  vi.resetModules();
  vi.doMock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
    useProfile: (variables: unknown) => {
      seen.push(variables);
      return { data: data.profile, dataUpdatedAt: data.profileAt ?? 1 };
    },
    useStartingAssistant: (variables: unknown) => {
      seen.push(variables);
      return {
        data: data.answer,
        dataUpdatedAt: data.answer ? (data.answerAt ?? 2) : 0,
        error: data.answerError ?? null,
      };
    },
  }));
  const { ShellStartScreenReady } = await import("../ShellStartScreenReady");
  const view = render(<ShellStartScreenReady />);
  return {
    change(next: Data) {
      data = next;
      view.rerender(<ShellStartScreenReady />);
    },
  };
}

describe("ShellStartScreenReady", () => {
  beforeEach(() => {
    document.body.style.background = "rgb(17, 24, 39)";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockRestore();
    removeHostShell();
    document.body.removeAttribute("style");
  });

  it("sends a shell of version 1 today's report and asks nothing more", async () => {
    const request = installHostShell({ startScreen: 1 });
    const variables: unknown[] = [];
    await mount({ profile: profile(), answer: {} }, variables);
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls).toEqual([
      ["startScreen.ready", { background: "#111827" }],
    ]);
    // Skipped: a shell that keeps no page needs no start choice.
    expect(variables).not.toHaveLength(0);
    expect(variables.every((value) => typeof value === "symbol")).toBe(true);
  });

  it("lets a start resume when nobody chose a start screen", async () => {
    const request = installHostShell({ startScreen: 2 });
    await mount({ profile: profile(), answer: {} });
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls).toEqual([
      ["startScreen.ready", { background: "#111827", resume: true }],
    ]);
  });

  it("keeps the start screen while the organization's default is unknown", async () => {
    const request = installHostShell({ startScreen: 2 });
    await mount({
      profile: profile(),
      answer: undefined,
    });
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls).toEqual([
      ["startScreen.ready", { background: "#111827", resume: false }],
    ]);
  });

  it.each([
    ["an assistant", { preference_starting_assistant_id: "own-1" }],
    ["a hub assistant", { preference_starting_hub_assistant_id: "hub-2" }],
    ["the welcome screen", { preference_starting_assistant_cleared: true }],
  ])(
    "keeps the start screen when the person chose %s",
    async (_, preferences) => {
      const request = installHostShell({ startScreen: 2 });
      await mount({ profile: profile(preferences), answer: {} });
      await waitFor(() => expect(request).toHaveBeenCalled());
      expect(request.mock.calls).toEqual([
        ["startScreen.ready", { background: "#111827", resume: false }],
      ]);
    },
  );

  it("keeps the start screen when the organization set a default assistant", async () => {
    const request = installHostShell({ startScreen: 2 });
    await mount({ profile: profile(), answer: orgDefault });
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls).toEqual([
      ["startScreen.ready", { background: "#111827", resume: false }],
    ]);
  });

  it("tells the shell again when the person changes the start setting", async () => {
    const request = installHostShell({ startScreen: 2 });
    const page = await mount({ profile: profile(), answer: {} });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    page.change({
      profile: profile({ preference_starting_hub_assistant_id: "hub-2" }),
      profileAt: 3,
      answer: {
        starting_assistant: {
          assistant_id: "assistant-2",
          assistant_hub_assistant_id: "hub-2",
          source: "user_pick",
        },
      },
      answerAt: 4,
    });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    page.change({ profile: profile(), profileAt: 5, answer: {}, answerAt: 6 });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(request.mock.calls.map(([, params]) => params)).toEqual([
      { background: "#111827", resume: true },
      { background: "#111827", resume: false },
      { background: "#111827", resume: true },
    ]);
  });

  it("waits for the organization's default after the person drops their own choice", async () => {
    const request = installHostShell({ startScreen: 2 });
    const welcome = profile({ preference_starting_assistant_cleared: true });
    const page = await mount({ profile: welcome, answer: {} });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    // Saved: the profile is back first, the answer still from before.
    page.change({ profile: profile(), profileAt: 3, answer: {}, answerAt: 2 });
    page.change({
      profile: profile(),
      profileAt: 3,
      answer: orgDefault,
      answerAt: 4,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(request.mock.calls).toEqual([
      ["startScreen.ready", { background: "#111827", resume: false }],
    ]);
  });

  it("keeps the last answer through a failed refresh", async () => {
    const request = installHostShell({ startScreen: 2 });
    const page = await mount({ profile: profile(), answer: {} });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    page.change({ profile: profile(), answer: {}, answerError: new Error() });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(request.mock.calls).toEqual([
      ["startScreen.ready", { background: "#111827", resume: true }],
    ]);
  });
});
