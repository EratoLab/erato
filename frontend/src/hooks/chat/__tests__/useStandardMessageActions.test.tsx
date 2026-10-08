import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { useStandardMessageActions } from "../useStandardMessageActions";

import type { ChatMessage } from "@/components/ui/MessageList/MessageList";
import type { ReactNode } from "react";

const messages = {
  question: { id: "question", role: "user" },
  answer: { id: "answer", role: "assistant" },
} as unknown as Record<string, ChatMessage>;

const renderActions = (
  editingEnabled: boolean,
  regenerationEnabled: boolean,
) => {
  const onBeginEdit = vi.fn();
  const handleRegenerate = vi.fn();
  const { result } = renderHook(
    () =>
      useStandardMessageActions({
        messages,
        onBeginEdit,
        handleRegenerate,
        handleFeedbackSubmit: vi.fn(),
        feedbackConfig: { commentsEnabled: false },
        openFeedbackDialog: vi.fn(),
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StaticFeatureConfigProvider
          config={{ messageActions: { editingEnabled, regenerationEnabled } }}
        >
          {children}
        </StaticFeatureConfigProvider>
      ),
    },
  );
  return { onAction: result.current, onBeginEdit, handleRegenerate };
};

describe("useStandardMessageActions", () => {
  it("edits and regenerates while the deployment offers both", async () => {
    const { onAction, onBeginEdit, handleRegenerate } = renderActions(
      true,
      true,
    );

    await expect(
      onAction({ type: "edit", messageId: "question" }),
    ).resolves.toBe(true);
    await expect(
      onAction({ type: "regenerate", messageId: "answer" }),
    ).resolves.toBe(true);
    expect(onBeginEdit).toHaveBeenCalledWith("question");
    expect(handleRegenerate).toHaveBeenCalledWith("answer");
  });

  it("refuses edit and regenerate requested by custom controls the deployment turned off", async () => {
    const { onAction, onBeginEdit, handleRegenerate } = renderActions(
      false,
      false,
    );

    await expect(
      onAction({ type: "edit", messageId: "question" }),
    ).resolves.toBe(false);
    await expect(
      onAction({ type: "regenerate", messageId: "answer" }),
    ).resolves.toBe(false);
    expect(onBeginEdit).not.toHaveBeenCalled();
    expect(handleRegenerate).not.toHaveBeenCalled();
  });
});
