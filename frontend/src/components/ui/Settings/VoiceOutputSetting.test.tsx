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
  },
  cards: { wording: "precise", user_choice: false },
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

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

beforeEach(() => api.update.mockClear());

const renderSetting = () =>
  render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <VoiceOutputSetting />
      </QueryClientProvider>
    </I18nProvider>,
  );

describe("voice output setting", () => {
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
    expect(screen.getByText("Set by your organization")).toBeInTheDocument();
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
});
