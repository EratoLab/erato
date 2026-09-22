import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { ChatTaskPlanAdvisory } from "../ChatTaskPlanAdvisory";

import type { DelegationTasksApprovalMode } from "@/app/env";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const ADVISORY = "chat-task-plan-advisory";

/**
 * `StaticFeatureConfigProvider` layers overrides onto the static defaults,
 * which is exactly a deployment that has told the client nothing — so a test
 * that passes no assistants config is testing the default deployment.
 */
const renderAdvisory = (
  assistants?: Partial<{
    delegationTasksEnabled: boolean;
    delegationTasksAllowAsync: boolean;
    delegationTasksApprovalMode: DelegationTasksApprovalMode;
  }>,
) =>
  render(
    <I18nProvider i18n={i18n}>
      <StaticFeatureConfigProvider
        config={assistants ? { assistants } : undefined}
      >
        <ChatTaskPlanAdvisory />
      </StaticFeatureConfigProvider>
    </I18nProvider>,
  );

const advisory = () => document.querySelector(`[data-ui="${ADVISORY}"]`);

describe("ChatTaskPlanAdvisory", () => {
  it("says nothing on a default deployment", () => {
    // The acceptance this issue turns on: tasks are off by default, so there
    // is no stop to announce and announcing one would be a lie.
    renderAdvisory();

    expect(advisory()).toBeNull();
  });

  it("says nothing when tasks are enabled but nothing is ever approved", () => {
    renderAdvisory({
      delegationTasksEnabled: true,
      delegationTasksApprovalMode: "never",
    });

    expect(advisory()).toBeNull();
  });

  it("announces the plan approval under `plan`", () => {
    renderAdvisory({
      delegationTasksEnabled: true,
      delegationTasksApprovalMode: "plan",
    });

    expect(advisory()).not.toBeNull();
    expect(screen.getByText(/approve the plan/i)).toBeInTheDocument();
  });

  it("announces every run under `always`", () => {
    renderAdvisory({
      delegationTasksEnabled: true,
      delegationTasksApprovalMode: "always",
    });

    expect(screen.getByText(/needs your approval/i)).toBeInTheDocument();
  });

  it("announces background tasks under `async_only` once async is offered", () => {
    renderAdvisory({
      delegationTasksEnabled: true,
      delegationTasksAllowAsync: true,
      delegationTasksApprovalMode: "async_only",
    });

    expect(screen.getByText(/background task/i)).toBeInTheDocument();
  });

  it("stays silent under `async_only` while async is not an offered run mode", () => {
    // `async_only` stops nothing at all unless the model may offer async, so
    // this is the mode that would otherwise warn about an impossible stop —
    // and it is the default mode, which is what makes it worth pinning.
    renderAdvisory({
      delegationTasksEnabled: true,
      delegationTasksAllowAsync: false,
      delegationTasksApprovalMode: "async_only",
    });

    expect(advisory()).toBeNull();
  });

  it("stays silent whatever the mode says while tasks are switched off", () => {
    // The backend publishes the mode ungated, so this combination is
    // reachable by configuration: demanding approval on a deployment where no
    // dispatch can happen at all.
    for (const mode of ["always", "plan", "async_only"] as const) {
      const { unmount } = renderAdvisory({
        delegationTasksEnabled: false,
        delegationTasksAllowAsync: true,
        delegationTasksApprovalMode: mode,
      });

      expect(advisory()).toBeNull();
      unmount();
    }
  });
});
