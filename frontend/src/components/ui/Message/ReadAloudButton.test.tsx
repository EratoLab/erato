import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useReadAloud } from "@/hooks/audio/readAloud";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { DefaultMessageControls } from "./DefaultMessageControls";
import { ReadAloudButton } from "./ReadAloudButton";

import type {
  MessageControlsProps,
  MessageReadAloudFacts,
} from "@/types/message-controls";
import type { ReactElement } from "react";

const { toggleReadAloud } = vi.hoisted(() => ({ toggleReadAloud: vi.fn() }));
vi.mock("@/hooks/audio/readAloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/audio/readAloud")>()),
  toggleReadAloud,
}));
vi.mock("@/components/ui/Message/MessageTimestamp", () => ({
  MessageTimestamp: () => <time>now</time>,
}));

const READABLE: MessageReadAloudFacts = {
  isFinished: true,
  hasText: true,
  hasSpokenAudio: false,
};

const withFeature = (ui: ReactElement, readAloudEnabled = true) =>
  render(
    <StaticFeatureConfigProvider
      config={{
        messageActions: {
          editingEnabled: true,
          regenerationEnabled: true,
          readAloudEnabled,
        },
      }}
    >
      {ui}
    </StaticFeatureConfigProvider>,
  );

const controls = (props: Partial<MessageControlsProps> = {}) => (
  <DefaultMessageControls
    messageId="m1"
    createdAt="2026-01-01T12:00:00Z"
    context={{ canEdit: true }}
    onAction={vi.fn(async () => true)}
    isUserMessage={false}
    readAloud={READABLE}
    {...props}
  />
);

const button = () => screen.queryByRole("button", { name: "Read aloud" });

beforeEach(() => {
  toggleReadAloud.mockClear();
  useReadAloud.setState({
    messageId: null,
    status: null,
    audioModeActive: false,
  });
});

describe("read aloud button in the default message controls", () => {
  it("shows on a finished assistant message and starts playback without an action", () => {
    const onAction = vi.fn(async () => true);
    withFeature(controls({ onAction }));

    const readAloud = button();
    expect(readAloud).toHaveAttribute("data-ui", "message-read-aloud");
    expect(readAloud).toHaveAttribute("data-state", "idle");
    fireEvent.click(readAloud!);

    expect(toggleReadAloud).toHaveBeenCalledExactlyOnceWith("m1");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("is styled like its neighbours and hides until hover with them", () => {
    withFeature(controls({ showOnHover: true }));

    const copy = screen.getByLabelText("Copy message");
    const readAloud = button()!;
    expect(readAloud.dataset.variant).toBe(copy.dataset.variant);
    expect(readAloud.dataset.geometry).toBe(copy.dataset.geometry);
    for (const name of [
      "hover:bg-[var(--theme-message-controls)]",
      "group-hover:opacity-100",
    ]) {
      expect(copy.className).toContain(name);
      expect(readAloud.className).toContain(name);
    }
  });

  it.each<[string, Partial<MessageControlsProps>]>([
    [
      "the facts are missing (renderer built its own props)",
      { readAloud: undefined },
    ],
    [
      "the message is still streaming",
      { readAloud: { ...READABLE, isFinished: false } },
    ],
    ["the message has no text", { readAloud: { ...READABLE, hasText: false } }],
    [
      "the message already carries a spoken reply",
      { readAloud: { ...READABLE, hasSpokenAudio: true } },
    ],
  ])("is hidden when %s", (_name, props) => {
    withFeature(controls(props));

    expect(button()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Copy message")).toBeInTheDocument();
  });

  it("is hidden while the feature is off, also without a feature provider", () => {
    const { unmount } = withFeature(controls(), false);
    expect(button()).not.toBeInTheDocument();
    unmount();

    render(controls());
    expect(button()).not.toBeInTheDocument();
  });

  it("is hidden while an audio mode is active and returns afterwards", () => {
    withFeature(controls());
    expect(button()).toBeInTheDocument();

    act(() => useReadAloud.setState({ audioModeActive: true }));
    expect(button()).not.toBeInTheDocument();

    act(() => useReadAloud.setState({ audioModeActive: false }));
    expect(button()).toBeInTheDocument();
  });

  it("becomes a stop button for the message that plays, and only for that one", () => {
    withFeature(
      <>
        {controls({ showOnHover: true })}
        {controls({ messageId: "m2", showOnHover: true })}
      </>,
    );

    act(() => useReadAloud.setState({ messageId: "m1", status: "loading" }));
    const loading = screen.getByRole("button", { name: "Stop reading" });
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toBeEnabled();

    act(() => useReadAloud.setState({ messageId: "m1", status: "playing" }));
    const stop = screen.getByRole("button", { name: "Stop reading" });
    expect(stop).toHaveAttribute("data-state", "playing");
    // Stays visible without hover while it plays.
    expect(stop.className).not.toContain("opacity-0");
    expect(screen.getAllByRole("button", { name: "Read aloud" })).toHaveLength(
      1,
    );

    fireEvent.click(stop);
    expect(toggleReadAloud).toHaveBeenCalledExactlyOnceWith("m1");
  });

  it("shows a failed state that can be retried", () => {
    withFeature(controls());

    act(() => useReadAloud.setState({ messageId: "m1", status: "failed" }));
    const failed = screen.getByRole("button", {
      name: "Could not read this message aloud. Try again",
    });
    expect(failed).toHaveAttribute("data-state", "failed");

    fireEvent.click(failed);
    expect(toggleReadAloud).toHaveBeenCalledExactlyOnceWith("m1");
  });
});

describe("ReadAloudButton as a building block for custom controls", () => {
  it("needs only the message id, hover flag and the facts passed through", () => {
    withFeature(
      <ReadAloudButton messageId="m9" showOnHover readAloud={READABLE} />,
    );

    fireEvent.click(button()!);
    expect(toggleReadAloud).toHaveBeenCalledExactlyOnceWith("m9");
  });

  it("stays hidden when the facts are not passed", () => {
    withFeature(<ReadAloudButton messageId="m9" />);

    expect(button()).not.toBeInTheDocument();
  });
});
