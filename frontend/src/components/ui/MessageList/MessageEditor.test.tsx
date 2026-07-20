import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageEditor } from "./MessageEditor";

import type { MessageEditorProps } from "./MessageEditor";
import type { Message } from "@/types/chat";

const userMessage: Message = {
  id: "u1",
  role: "user",
  status: "complete",
  createdAt: "2026-07-20T00:00:00Z",
  content: [{ content_type: "text", text: "original text" }],
  input_files_ids: ["file-1"],
};

const renderEditor = (overrides: Partial<MessageEditorProps> = {}) => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <MessageEditor
      message={userMessage}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return {
    onSubmit,
    onCancel,
    input: screen.getByTestId("message-editor-input"),
  };
};

describe("MessageEditor", () => {
  it("opens with the message's current text", () => {
    const { input } = renderEditor();

    expect(input).toHaveValue("original text");
  });

  it("submits the edited text and carries the message's files through", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.change(input, { target: { value: "edited text" } });
    fireEvent.click(screen.getByTestId("message-editor-submit"));

    expect(onSubmit).toHaveBeenCalledWith("edited text", ["file-1"]);
  });

  it("submits on Enter", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSubmit).toHaveBeenCalledWith("original text", ["file-1"]);
  });

  it("keeps Shift+Enter as a newline rather than a submit", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const { onCancel, input } = renderEditor();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("blocks submit while a token limit is exceeded", () => {
    const { onSubmit, input } = renderEditor({ isSubmitBlocked: true });

    expect(screen.getByTestId("message-editor-submit")).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit when the draft is emptied", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.change(input, { target: { value: "   " } });

    expect(screen.getByTestId("message-editor-submit")).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
