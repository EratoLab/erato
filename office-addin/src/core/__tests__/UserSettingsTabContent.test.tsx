import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinSettingsDialogCore } from "../AddinSettingsDialogCore";

import type { ChangeEventHandler, ReactNode } from "react";

const spies = vi.hoisted(() => ({
  fetchUpdateProfilePreferences: vi.fn(),
}));

vi.mock("@erato/frontend/library", async () => {
  // The core zone rule reads any `src/` import as host behavior reaching a
  // host-neutral file; a test-only stub set is neither.
  // eslint-disable-next-line import/no-restricted-paths
  const mock = await import("../../test/helpers/eratoLibraryMock");

  return mock.createEratoLibraryMock({
    AppearanceTabContent: () => null,
    TextSizeSetting: () => null,
    // Carries the shell's close button, which stays live while the body saves.
    ModalBase: ({
      isOpen,
      onClose,
      children,
    }: {
      isOpen: boolean;
      onClose: () => void;
      children?: ReactNode;
    }) =>
      isOpen ? (
        <div role="dialog">
          <button type="button" aria-label="Close modal" onClick={onClose} />
          {children}
        </div>
      ) : null,
    Alert: ({ children }: { children?: ReactNode }) => (
      <div role="alert">{children}</div>
    ),
    FormField: ({
      label,
      htmlFor,
      children,
    }: {
      label: string;
      htmlFor: string;
      children?: ReactNode;
    }) => (
      <div>
        <label htmlFor={htmlFor}>{label}</label>
        {children}
      </div>
    ),
    Textarea: ({
      id,
      value,
      onChange,
    }: {
      id?: string;
      value?: string;
      onChange?: ChangeEventHandler<HTMLTextAreaElement>;
    }) => <textarea id={id} value={value} onChange={onChange} />,
    fetchUpdateProfilePreferences: spies.fetchUpdateProfilePreferences,
    profileQuery: () => ({ queryKey: ["profile"] }),
    useProfile: () => ({ profile: { preference_nickname: "Ada" } }),
    useFeatureConfig: () => ({
      audioTranscription: { enabled: false },
      audioDictation: { enabled: false },
      audioConversational: { enabled: false },
      userPreferences: {
        desktopSidecarTabEnabled: false,
        mcpServersTabEnabled: false,
      },
    }),
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const renderUserSettings = () => {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AddinSettingsDialogCore isOpen onClose={onClose} openTab="user" />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Nickname"), {
    target: { value: "Grace" },
  });
  return { onClose };
};

describe("UserSettingsTabContent in the settings dialog", () => {
  beforeEach(() => {
    i18n.activate("en");
    spies.fetchUpdateProfilePreferences.mockReset();
  });
  afterEach(cleanup);

  it("reports a failed save beside the Save button, outside the scrolling fields", async () => {
    const save = deferred();
    spies.fetchUpdateProfilePreferences.mockReturnValue(save.promise);
    const { onClose } = renderUserSettings();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {
      save.reject(new Error("500"));
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not save preferences. Please try again.",
    );
    expect(alert.parentElement).toContainElement(
      screen.getByRole("button", { name: "Save" }),
    );
    expect(
      screen.getByLabelText("Nickname").closest(".overflow-y-auto"),
    ).not.toContainElement(alert);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
