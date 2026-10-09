import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { CompactionMarker } from "./CompactionMarker";

import type { ContentPartCompactionMarker } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

vi.mock("./MessageContent", () => ({
  MessageContent: ({ content }: { content: { text?: string }[] }) => (
    <div>{content.map((part) => part.text).join(" ")}</div>
  ),
}));
beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});
const marker: ContentPartCompactionMarker & {
  content_type: "compaction_marker";
} = {
  content_type: "compaction_marker",
  version: 1,
  mode: "summarize",
  operation_id: "operation",
  summarizer_chat_provider_id: "summary",
  target_chat_provider_id: "chat",
  before_tokens: 1000,
  after_tokens: 120,
  before_files: 3,
  after_files: 2,
  retained_file_ids: [],
  dropped_file_ids: [],
};
function show(value = marker) {
  return render(
    <I18nProvider i18n={i18n}>
      <CompactionMarker
        marker={value}
        content={[value, { content_type: "text", text: "A durable summary" }]}
        messageId="checkpoint"
        filesById={{}}
      />
    </I18nProvider>,
  );
}
describe("CompactionMarker", () => {
  it("uses persisted statistics and accessible summary disclosure", () => {
    show();
    expect(screen.getByRole("note")).toHaveTextContent(
      "120 of 1,000 estimated tokens (12%) and 2 of 3 files",
    );
    expect(screen.queryByText("A durable summary")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Show summary" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A durable summary")).toBeVisible();
    fireEvent.click(button);
    expect(screen.queryByText("A durable summary")).not.toBeInTheDocument();
  });
  it("handles zero tokens and zero files without invalid percentages", () => {
    show({
      ...marker,
      before_tokens: 0,
      after_tokens: 0,
      before_files: 0,
      after_files: 0,
    });
    expect(screen.getByRole("note")).toHaveTextContent(
      "0 of 0 estimated tokens (0%) and 0 of 0 files",
    );
  });
});
