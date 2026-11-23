import { i18n } from "@lingui/core";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  WordDecisionChoices,
  wordCommentsStandingLabel,
} from "../WordDecisionChoices";

import type { WordCardDecision } from "../WordDecisionChoices";

const shown = vi.hoisted(() => ({ props: {} }));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    ActionConfirmationCard: (props: Record<string, unknown>) => {
      shown.props = props;
      return null;
    },
    alwaysAllowLockedLine: () => "Locked by your organization.",
  });
});

const decision = (patch: Partial<WordCardDecision> = {}): WordCardDecision => ({
  allowAlways: true,
  decideOnScreen: false,
  status: "pending",
  resolvedLabel: undefined,
  isBusy: false,
  onDecide: vi.fn(),
  ...patch,
});

const draw = (
  choice: WordCardDecision,
  extra: { canApply?: boolean; alwaysLockedReason?: string } = {},
) =>
  render(
    <WordDecisionChoices
      decision={choice}
      title="Reply to comments?"
      applyLabel="Apply"
      canApply={extra.canApply ?? true}
      standingLabel={wordCommentsStandingLabel()}
      alwaysLockedReason={extra.alwaysLockedReason}
    />,
  );

describe("the Word card's choices in the decision place", () => {
  beforeAll(() => {
    i18n.load("en", {});
    i18n.activate("en");
  });

  it("names everything its Always and Never cover", () => {
    draw(decision());
    expect(shown.props.standingLabel).toBe(
      "Every comment change, new comments included:",
    );
    expect(shown.props.alwaysAllowDisabledReason).toBeUndefined();
  });

  it("shows Always locked with the reason when the server asks every time", () => {
    draw(decision({ allowAlways: false }));
    expect(shown.props.onAlwaysAllow).toBeTypeOf("function");
    expect(shown.props.alwaysAllowDisabledReason).toBe(
      "Locked by your organization.",
    );
    draw(decision(), { alwaysLockedReason: "Comments by other people." });
    expect(shown.props.alwaysAllowDisabledReason).toBe(
      "Comments by other people.",
    );
  });

  it("offers no Always for a change that needs a choice on screen", () => {
    draw(decision({ decideOnScreen: true, allowAlways: false }));
    expect(shown.props.onAlwaysAllow).toBeUndefined();
    expect(shown.props.alwaysAllowDisabledReason).toBeUndefined();
  });

  it("keeps Cancel and Never when the change cannot be made here", () => {
    const choice = decision();
    draw(choice, { canApply: false });
    expect(shown.props.onAllowOnce).toBeUndefined();
    expect(shown.props.onAlwaysAllow).toBeUndefined();
    (shown.props.onDeny as () => void)();
    expect(choice.onDecide).toHaveBeenCalledWith("reject");
    (shown.props.onNeverAllow as () => void)();
    expect(choice.onDecide).toHaveBeenCalledWith("reject_always");
  });
});
