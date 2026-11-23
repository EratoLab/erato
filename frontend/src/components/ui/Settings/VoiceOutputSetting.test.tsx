import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { VoiceOutputSetting } from "./VoiceOutputSetting";

import type { Messages } from "@lingui/core";

const api = vi.hoisted(() => ({
  replies: {
    wording: "natural",
    user_choice: true,
    source: "user",
    show_in_chat: false,
    show_in_chat_source: "deployment",
    spoken: true,
    spoken_source: "deployment",
  },
  cards: {
    wording: "precise",
    user_choice: false,
    spoken: true,
    spoken_source: "deployment",
  },
  update: vi.fn(async () => ({})),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useReplySpeechStyle: () => ({ data: api.replies }),
  useApprovalSpeechStyle: () => ({ data: api.cards }),
  replySpeechStyleQuery: () => ({ queryKey: ["reply"] }),
  approvalSpeechStyleQuery: () => ({ queryKey: ["approval"] }),
  fetchUpdateProfilePreferences: api.update,
  fetchApprovalSpeechStyle: vi.fn(),
}));
const refreshVoiceTraces = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/hooks/audio/voiceTraces", () => ({ refreshVoiceTraces }));
// "Languages I speak" has its own tests and endpoint.
vi.mock("./SpokenLanguagesSetting", () => ({
  SpokenLanguagesSetting: () => <div data-testid="spoken-languages" />,
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const REPLIES = { ...api.replies };
const CARDS = { ...api.cards };
beforeEach(() => {
  api.update.mockClear();
  api.replies = { ...REPLIES };
  api.cards = { ...CARDS };
});

const renderSetting = () =>
  render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <VoiceOutputSetting />
      </QueryClientProvider>
    </I18nProvider>,
  );

describe("voice output setting", () => {
  it("lists the languages the person speaks under how the voice sounds", () => {
    renderSetting();
    const sound = screen.getByRole("heading", { name: "How it sounds" });
    const languages = screen.getByTestId("spoken-languages");
    expect(
      sound.compareDocumentPosition(languages) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const shown = screen.queryByRole("heading", {
      name: "What the chat shows",
    });
    if (shown) {
      expect(
        languages.compareDocumentPosition(shown) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("saves the user's own reply wording", async () => {
    renderSetting();
    const replies = screen.getByRole("tablist", {
      name: "Replies in conversation",
    });
    fireEvent.click(
      Array.from(replies.querySelectorAll('[role="tab"]')).find(
        (tab) => tab.textContent === "Word for word",
      )!,
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_reply_speech_wording: "precise" },
      }),
    );
  });

  it("shows a row the organization has set as read-only", () => {
    renderSetting();
    // The card wording and whether cards are read aloud share one lock.
    expect(screen.getAllByText("Set by your organization")).toHaveLength(2);
    expect(
      screen.getByRole("checkbox", { name: "Read approval cards aloud" }),
    ).toBeDisabled();
    const cards = screen.getByRole("tablist", { name: "Approval cards" });
    for (const tab of cards.querySelectorAll('[role="tab"]'))
      expect(tab).toBeDisabled();
  });

  it("goes back to the organization's value", async () => {
    renderSetting();
    expect(
      screen.getAllByRole("button", { name: "Use my organization's setting" }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Use my organization's setting" }),
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_reply_speech_wording: null },
      }),
    );
  });

  it("shows what the voice said in the chat only when the user asks for it", async () => {
    renderSetting();
    const box = screen.getByRole("checkbox", {
      name: "Show what the voice said in the chat",
    });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_reply_speech_show_in_chat: true },
      }),
    );
    expect(refreshVoiceTraces).toHaveBeenCalled();
  });

  it("leaves showing the trace to the user when the wording is locked", async () => {
    api.replies = {
      ...api.replies,
      user_choice: false,
      show_in_chat: true,
      show_in_chat_source: "user",
    };
    renderSetting();
    const box = screen.getByRole("checkbox", {
      name: "Show what the voice said in the chat",
    });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Use my organization's setting" }),
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_reply_speech_show_in_chat: null },
      }),
    );
  });

  it("lists what you hear before how it sounds and what the chat shows", () => {
    renderSetting();
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["What you hear", "How it sounds", "What the chat shows"]);
  });

  it("turns spoken replies off and on again with the organization", async () => {
    renderSetting();
    const box = screen.getByRole("checkbox", { name: "Speak replies" });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    fireEvent.click(box);
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_reply_speech_spoken: false },
      }),
    );
    expect(refreshVoiceTraces).toHaveBeenCalled();
  });

  it("offers the organization's value back for the user's own choice", async () => {
    api.replies = {
      ...api.replies,
      source: "deployment",
      spoken: false,
      spoken_source: "user",
    };
    renderSetting();
    fireEvent.click(
      screen.getByRole("button", { name: "Use my organization's setting" }),
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_reply_speech_spoken: null },
      }),
    );
  });

  it("keeps cards from being read aloud while replies are not spoken", () => {
    api.replies = { ...api.replies, spoken: false, spoken_source: "user" };
    api.cards = { ...api.cards, user_choice: true };
    renderSetting();
    expect(
      screen.getByRole("checkbox", { name: "Read approval cards aloud" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Cards are read aloud only while replies are spoken."),
    ).toBeInTheDocument();
  });

  it("saves whether cards are read aloud where the organization allows it", async () => {
    api.cards = { ...api.cards, user_choice: true };
    renderSetting();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Read approval cards aloud" }),
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        body: { preference_approval_speech_spoken: false },
      }),
    );
  });

  it("shows spoken replies set by the organization as read-only", () => {
    api.replies = { ...api.replies, user_choice: false };
    renderSetting();
    expect(
      screen.getByRole("checkbox", { name: "Speak replies" }),
    ).toBeDisabled();
  });
});
