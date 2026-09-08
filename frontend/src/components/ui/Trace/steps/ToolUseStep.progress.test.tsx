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
