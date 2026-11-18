import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useApprovalListening } from "@/hooks/audio/approvalListening";
import { useApprovalSpeech } from "@/hooks/audio/approvalSpeech";

import { ApprovalHeardStatus } from "./ApprovalHeardStatus";

const KEY = "message-1:call-1";

const show = () =>
  render(
    <I18nProvider i18n={i18n}>
      <ApprovalHeardStatus />
    </I18nProvider>,
  );

afterEach(() => {
  useApprovalListening.setState({ heard: null });
  useApprovalSpeech.setState({ key: null });
});

describe("what was heard for a waiting card", () => {
  it("shows at once that words were heard, then the words and what they were understood as", () => {
    useApprovalSpeech.setState({ key: KEY });
    useApprovalListening.setState({
      heard: { key: KEY, words: null, meaning: null },
    });
    const { rerender } = show();
    expect(screen.getByRole("status")).toHaveTextContent("Heard …");

    useApprovalListening.setState({
      heard: { key: KEY, words: "weiter", meaning: "skip" },
    });
    rerender(
      <I18nProvider i18n={i18n}>
        <ApprovalHeardStatus />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "“weiter” · Understood: next",
    );
  });

  it("shows only the words for listening noise, and nothing for another card", () => {
    useApprovalSpeech.setState({ key: KEY });
    useApprovalListening.setState({
      heard: { key: KEY, words: "mhm", meaning: "noise" },
    });
    const { unmount } = show();
    expect(screen.getByRole("status")).toHaveTextContent(/^“mhm”$/);
    unmount();

    useApprovalSpeech.setState({ key: "message-2:call-9" });
    show();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
