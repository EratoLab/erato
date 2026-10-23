/**
 * Mounts the host's context lane around a kit's chip face and reports what
 * the face broke. Reads hooks and roles, never label copy, because a kit's
 * harness activates its own catalog.
 */
/* eslint-disable lingui/no-unlocalized-strings -- failure text and fixtures for a test run, never shown to a user */
import { createElement } from "react";

import { composerContextMeta } from "@/components/ui/Chat/ComposerContext/ComposerContextChip";
import { ComposerContextLane } from "@/components/ui/Chat/ComposerContext/ComposerContextLane";

import type {
  ComposerContextChipFaceProps,
  ComposerContextItem,
  ComposerContextState,
} from "@/components/ui/Chat/ComposerContext/types";
import type { ComponentType, ReactElement } from "react";

export interface ComposerContextChipFaceConformanceHarness {
  render: (element: ReactElement) => {
    container: HTMLElement;
    unmount: () => void;
  };
}

const noop = () => {};

const STATES: ComposerContextState[] = [
  "included",
  "suggested",
  "superseded",
  "loading",
  "error",
  "attention",
];

const INTERACTIVE =
  'button, a[href], input, select, textarea, [tabindex], [role="button"], [contenteditable="true"]';

interface ConformanceCase {
  name: string;
  item: ComposerContextItem;
}

const caseItem = (
  state: ComposerContextState,
  variant: { detail: boolean; locked: boolean },
): ComposerContextItem => ({
  id: `conformance-${state}-${variant.detail ? "detail" : "plain"}-${variant.locked ? "locked" : "open"}`,
  kind: "conformance.document",
  origin: "ambient",
  dismissScope: "chat",
  state,
  label: `Conformance ${state} label`,
  meta: state === "suggested" ? undefined : `Conformance ${state} meta`,
  icon: "document",
  locked: variant.locked,
  lockReason: variant.locked ? "Conformance lock" : undefined,
  onRemove: noop,
  onRestore: noop,
  detail: variant.detail
    ? { title: "Conformance detail", render: () => null }
    : undefined,
});

const CASES: ConformanceCase[] = STATES.flatMap((state) => [
  {
    name: `a ${state} chip`,
    item: caseItem(state, { detail: false, locked: false }),
  },
  {
    name: `a ${state} chip with a detail`,
    item: caseItem(state, { detail: true, locked: false }),
  },
  {
    name: `a locked ${state} chip with a detail`,
    item: caseItem(state, { detail: true, locked: true }),
  },
]);

const chipFailures = (
  container: HTMLElement,
  { name, item }: ConformanceCase,
): string[] => {
  const chip = container.querySelector<HTMLElement>(
    '[data-ui="composer-context-chip"]',
  );
  if (!chip) {
    return [
      `${name}: no chip rendered (if every case fails, the test build holds two copies of @erato/frontend)`,
    ];
  }
  const open = chip.querySelector<HTMLElement>(
    '[data-ui="composer-context-chip-open"]',
  );
  if (!open) {
    return [`${name}: the chip has no open button`];
  }
  const failures: string[] = [];

  const text = open.textContent ?? "";
  if (!text.includes(item.label)) {
    failures.push(`${name}: the face does not show the item's label`);
  }
  // The meta says why a chip is not sent and how long it stays off; read
  // through the active catalog, so a kit's own catalog passes too.
  const meta = composerContextMeta(item);
  if (meta && !text.includes(meta)) {
    failures.push(`${name}: the face does not show the item's meta`);
  }

  const nested = [...open.querySelectorAll(INTERACTIVE)];
  if (nested.length > 0) {
    failures.push(
      `${name}: the face holds ${nested.length} focusable or clickable element(s); the open button must be the only activation target`,
    );
  }

  const control = chip.querySelector<HTMLElement>(
    item.state === "suggested"
      ? '[data-ui="composer-context-restore"]'
      : '[data-ui="composer-context-remove"]',
  );
  if (!control) {
    failures.push(`${name}: the host's (x)/(+) is missing`);
  } else if (open.contains(control)) {
    failures.push(`${name}: the (x)/(+) sits inside the open button`);
  } else if (item.locked && !control.hasAttribute("disabled")) {
    failures.push(`${name}: a locked chip's (x)/(+) is not disabled`);
  }

  const haspopup = open.getAttribute("aria-haspopup");
  if (item.detail && haspopup !== "dialog") {
    failures.push(`${name}: the open button lost aria-haspopup="dialog"`);
  }
  if (!item.detail && haspopup !== null) {
    failures.push(`${name}: a chip without a detail claims a popup`);
  }

  const stateText = open
    .querySelector('[data-ui="composer-context-chip-state"]')
    ?.textContent?.trim();
  if (!stateText) {
    failures.push(`${name}: the open button does not say the chip's state`);
  }

  if (chip.getAttribute("data-state") !== item.state) {
    failures.push(
      `${name}: the chip reads data-state="${chip.getAttribute("data-state")}"`,
    );
  }

  return failures;
};

/**
 * Every failure across the six states, with and without a detail, and
 * locked. A conforming face returns `[]`.
 */
export const composerContextChipFaceConformanceFailures = (
  Face: ComponentType<ComposerContextChipFaceProps>,
  harness: ComposerContextChipFaceConformanceHarness,
): string[] =>
  CASES.flatMap((conformanceCase) => {
    const { container, unmount } = harness.render(
      createElement(ComposerContextLane, {
        items: [conformanceCase.item],
        chipFace: Face,
      }),
    );
    try {
      return chipFailures(container, conformanceCase);
    } finally {
      unmount();
    }
  });
