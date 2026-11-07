import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ToolUseStep } from "./ToolUseStep";

import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

describe("tool progress in the trace header", () => {
  it.each([false, true])(
    "updates the message after the tool name (has details: %s)",
    (hasDetails) => {
      const renderStep = (progressMessage?: string) => (
        <I18nProvider i18n={i18n}>
          <ToolUseStep
            part={{
              content_type: "tool_use",
              tool_call_id: "read-file-call",
              tool_name: "read_file",
              status: "in_progress",
              input: hasDetails
                ? ({ path: "docs/readme.txt" } as unknown as ToolUse["input"])
                : null,
              progress_message: progressMessage,
            }}
            status="running"
            isStreaming
            isCollapsed={false}
            isLastStep
          />
        </I18nProvider>
      );

      const { rerender } = render(renderStep());
      expect(screen.getByText("read_file")).toBeVisible();

      for (const step of [1, 2, 3]) {
        rerender(renderStep(`Reading file step ${step}/3`));
        const progress = screen.getByText(`Reading file step ${step}/3`);
        expect(progress).toBeVisible();
        expect(progress).toHaveAttribute("dir", "auto");
        expect(progress.parentElement).toHaveTextContent(
          `read_fileReading file step ${step}/3`,
        );
        if (step > 1) {
          expect(
            screen.queryByText(`Reading file step ${step - 1}/3`),
          ).not.toBeInTheDocument();
        }
        if (hasDetails) {
          expect(progress.closest("button")).toHaveAttribute(
            "aria-expanded",
            "false",
          );
        }
      }

      rerender(renderStep());
      expect(screen.queryByText(/Reading file step/)).not.toBeInTheDocument();
      expect(screen.getByText("read_file")).toBeVisible();
    },
  );
});

describe("progress text from any writer", () => {
  const renderProgress = (progressMessage: unknown) =>
    render(
      <I18nProvider i18n={i18n}>
        <ToolUseStep
          part={{
            content_type: "tool_use",
            tool_call_id: "read-file-call",
            tool_name: "read_file",
            status: "in_progress",
            progress_message: progressMessage as string,
          }}
          status="running"
          isStreaming
          isCollapsed={false}
          isLastStep
        />
      </I18nProvider>,
    );
  const title = () => screen.getByText("read_file").textContent;

  it.each([[{ text: "Reading" }], [["Reading"]], [42], [true], ["   \n\t "]])(
    "shows only the tool name for %o",
    (progressMessage) => {
      renderProgress(progressMessage);

      expect(title()).toBe("read_file");
    },
  );

  it("caps text of any length at the server's 200 characters", () => {
    renderProgress(`<img src=x onerror=alert(1)>${"😀".repeat(1_000_000)}`);

    const shown = screen.getByText(/^<img src=x onerror=alert\(1\)>/);
    expect(Array.from(shown.textContent ?? "")).toHaveLength(200);
    expect(shown.getAttribute("title")).toBe(shown.textContent);
    expect(document.querySelector("img")).toBeNull();
  });
});
