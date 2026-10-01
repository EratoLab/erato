import { plural, t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { Card } from "@/components/ui/Container/Card";
import { Button } from "@/components/ui/Controls/Button";
import { Collapse } from "@/components/ui/Controls/Collapse";
import { DisclosureChevron } from "@/components/ui/Controls/DisclosureChevron";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import { SettledInfoPill } from "@/components/ui/Trace/steps/ToolStatusPill";
import { UndoIcon } from "@/components/ui/icons";

import "./wordReview.css";

import { storyLabel } from "./wordPlanLabels";

import type { WordPlanRisk } from "@/lib/wordReview/wordPlanReview";
import type { ComponentProps, ReactNode } from "react";

export function WordReviewGenerating({ label }: { label: string }) {
  return (
    <Card variant="surface" size="sm">
      <SpinnerIcon label={label} />
    </Card>
  );
}

/** Shared chrome of every Word review card: receipt when collapsed, details, status. */
export function WordReviewCard({
  cardRef,
  label,
  testId,
  footer,
  collapsed,
  receipt,
  detailsId,
  status,
  trailing,
  children,
}: {
  cardRef?: ComponentProps<typeof Card>["ref"];
  label: string;
  testId: string;
  footer: ReactNode;
  collapsed: boolean;
  receipt?: ReactNode;
  detailsId: string;
  /** Status alert, rendered while the card is expanded. */
  status?: ReactNode;
  /** Rendered after the status alert while the card is expanded. */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      variant="surface"
      size="none"
      ref={cardRef}
      tabIndex={-1}
      role="region"
      aria-label={label}
      className="word-review focus-ring"
      data-testid={testId}
      footer={<div className="word-review__footer">{footer}</div>}
    >
      {collapsed && receipt}
      <div id={detailsId} hidden={collapsed}>
        {children}
      </div>
      {!collapsed && status}
      {!collapsed && trailing}
    </Card>
  );
}

export function WordReviewHeader({
  chip,
  title,
  scope,
  children,
}: {
  chip?: { label: string; toneClassName?: string };
  title: string;
  scope?: string;
  children?: ReactNode;
}) {
  return (
    <div className="word-review__header">
      {chip && (
        <span className="word-review__chip">
          <SettledInfoPill
            label={chip.label}
            toneClassName={chip.toneClassName}
          />
        </span>
      )}
      <h3>{title}</h3>
      {scope && <p className="word-review__hint">{scope}</p>}
      {children}
    </div>
  );
}

export function wordPlanRiskLabel(risk: WordPlanRisk): string {
  const n = risk.count;
  switch (risk.kind) {
    case "headings-lost":
      return t({
        id: "officeAddin.word.checkFirst.headingsLost",
        message: plural(n, {
          one: "# heading is no longer in the document",
          other: "# headings are no longer in the document",
        }),
      });
    case "natives-removed":
      return t({
        id: "officeAddin.word.checkFirst.nativesRemoved",
        message: plural(n, {
          one: "# table, image or object is removed or not carried over",
          other: "# tables, images or objects are removed or not carried over",
        }),
      });
    case "sections-removed":
      return t({
        id: "officeAddin.word.checkFirst.sectionsRemoved",
        message: plural(n, {
          one: "# section break is removed",
          other: "# section breaks are removed",
        }),
      });
    case "parts-changed": {
      const parts = [
        ...new Set(
          risk.items.flatMap((item) =>
            item.storyType ? [storyLabel(item.storyType)] : [],
          ),
        ),
      ].join(", ");
      return t({
        id: "officeAddin.word.checkFirst.partsChanged",
        message: `Document parts change too: ${parts}`,
      });
    }
    case "layout-changed":
      return t({
        id: "officeAddin.word.checkFirst.layoutChanged",
        message: plural(n, {
          one: "Page layout changes in # section",
          other: "Page layout changes in # sections",
        }),
      });
  }
}

/** Lists the risks worth a look before applying; each item jumps to its row. */
export function WordCheckFirst({
  risks,
  onJump,
}: {
  risks: readonly WordPlanRisk[];
  onJump: (rowKey: string) => void;
}) {
  if (risks.length === 0) return null;
  return (
    // Static review content with controls inside: a polite region, not an alert.
    <Alert
      type="warning"
      role="status"
      title={t({
        id: "officeAddin.word.checkFirst.title",
        message: "Check first",
      })}
      className="m-3 [overflow-wrap:anywhere]"
    >
      <ul className="word-review__risks">
        {risks.map((risk) => (
          <li key={risk.kind}>
            <Button
              type="button"
              variant="link"
              onClick={() => onJump(risk.rowKey)}
            >
              {wordPlanRiskLabel(risk)}
            </Button>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function DisclosureButton({
  open,
  controls,
  onToggle,
  children,
}: {
  open: boolean;
  controls: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-expanded={open}
      aria-controls={controls}
      icon={<DisclosureChevron open={open} />}
      onClick={onToggle}
    >
      {children}
    </Button>
  );
}

/** A labelled toggle whose body mounts only while open. */
export function WordDisclosure({
  label,
  openLabel = label,
  className,
  bodyClassName,
  children,
}: {
  label: string;
  openLabel?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <DisclosureButton
        open={open}
        controls={id}
        onToggle={() => setOpen(!open)}
      >
        {open ? openLabel : label}
      </DisclosureButton>
      <Collapse isOpen={open}>
        <div id={id} className={bodyClassName}>
          {open && children}
        </div>
      </Collapse>
    </div>
  );
}

export function WordReviewDetailsToggle({
  collapsed,
  controls,
  onToggle,
}: {
  collapsed: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <DisclosureButton open={!collapsed} controls={controls} onToggle={onToggle}>
      {collapsed
        ? t({
            id: "officeAddin.word.review.showDetails",
            message: "Show details",
          })
        : t({
            id: "officeAddin.word.review.hideDetails",
            message: "Hide details",
          })}
    </DisclosureButton>
  );
}

/** The revert slot is a single in-memory snapshot, which is what the line promises. */
export function WordUndoLine({
  canRevert,
  label,
  disabled,
  onUndo,
  testId,
}: {
  canRevert: boolean;
  label: string;
  disabled: boolean;
  onUndo: () => void;
  testId?: string;
}) {
  if (!canRevert) return null;
  return (
    <div className="word-review__undo">
      <UndoIcon className="word-review__undo-icon" />
      <p className="word-review__hint">
        {t({
          id: "officeAddin.word.review.undoAvailable",
          message:
            "Undo available until another change is applied or the pane is closed.",
        })}
      </p>
      <Button
        type="button"
        variant="secondary"
        data-testid={testId}
        disabled={disabled}
        onClick={onUndo}
      >
        {label}
      </Button>
    </div>
  );
}

export function wordUndoLabel(): string {
  return t({ id: "officeAddin.word.review.undo", message: "Undo" });
}

export function wordShowInWordLabel(): string {
  return t({
    id: "officeAddin.word.review.showInWord",
    message: "Show in Word",
  });
}
