import type { ComposerContextItem } from "@erato/frontend/library";
import type { ReactNode } from "react";

/**
 * The context items a host hands the composer, as plain DOM, so add-in tests read and press what
 * the lane would draw. The control rule is the lane's (composerContextControl): a suggested item
 * offers (+), every other state (x), each only with its handler. Every detail is rendered.
 */
export function ContextLaneDouble({
  items,
}: {
  items?: ComposerContextItem[];
}) {
  return (
    <div data-testid="context-lane">
      {(items ?? []).map((item) => {
        const spoken = item.spokenLabel ?? item.label;
        const control =
          item.state === "suggested"
            ? item.onRestore
              ? "restore"
              : null
            : item.onRemove
              ? "remove"
              : null;
        const lockTitle = item.locked ? item.lockReason : undefined;
        return (
          <div
            key={item.id}
            data-testid={`context-chip-${item.kind}`}
            data-id={item.id}
            data-state={item.state}
            data-tone={item.tone}
            data-origin={item.origin}
            data-dismiss-scope={item.dismissScope}
            data-locked={item.locked ? "true" : undefined}
          >
            <span data-testid="context-chip-label">{item.label}</span>
            {item.meta && (
              <span data-testid="context-chip-meta">{item.meta}</span>
            )}
            {control === "remove" && (
              <button
                type="button"
                disabled={item.locked}
                title={lockTitle}
                onClick={item.onRemove}
              >
                {item.removeLabel ?? `Remove ${spoken}`}
              </button>
            )}
            {control === "restore" && (
              <button
                type="button"
                disabled={item.locked}
                title={lockTitle}
                onClick={item.onRestore}
              >
                {item.restoreLabel ?? `Include ${spoken}`}
              </button>
            )}
            {item.detail && (
              <div data-testid={`context-detail-${item.kind}`}>
                <span data-testid="context-detail-title">
                  {item.detail.title}
                </span>
                {item.detail.render({ locked: item.locked ?? false })}
                {item.detail.actions?.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    data-action-id={action.id}
                    onClick={action.onSelect}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The library Alert as tests need it: its role (default "alert") and test id kept. */
export function AlertMock({
  children,
  role = "alert",
  "data-testid": testId,
}: {
  children: ReactNode;
  role?: "alert" | "status" | "none";
  "data-testid"?: string;
}) {
  return (
    <div role={role} data-testid={testId}>
      {children}
    </div>
  );
}
