import { Button, TextComparison } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { WordRichBlockSequence } from "./WordRichBlockPreview";
import { WordSectionPlanPreview } from "./WordSectionPlanPreview";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../utils/wordDocumentPlan";

export function WordScopedPlanReview({
  plan,
  snapshot,
  onLocate,
}: {
  plan: WordDocumentPlan;
  snapshot: WordAuthoringSnapshot;
  onLocate?: (ref: string) => void;
}) {
  const scope = snapshot.readScopes?.get(plan.readToken);
  if (!scope) return null;
  const changed = plan.entries.filter((e) => e.kind !== "keep");
  const refs =
    scope.kind === "table-cell"
      ? [scope.sourceRef]
      : [
          ...new Set(
            scope.targets.flatMap((target) =>
              target.bodyRef ? [target.bodyRef] : [],
            ),
          ),
        ];
  const original = refs
    .map((ref) => snapshot.blocks.find((b) => b.ref === ref)?.text ?? "")
    .join("\n\n");
  const table =
    changed[0]?.kind === "replace" ? changed[0].blocks[0] : undefined;
  const cell =
    scope.kind === "table-cell" && table?.type === "table"
      ? table.rows
          .find((r) => r.sourceIndex === scope.rowIndex)
          ?.cells.find((c) => c.sourceIndex === scope.cellIndex)?.textEdit
      : undefined;
  return (
    <section
      aria-label={t({
        id: "officeAddin.word.scoped.review",
        message: "Review selected changes",
      })}
    >
      <h3>
        {t({
          id: "officeAddin.word.scoped.review",
          message: "Review selected changes",
        })}
      </h3>
      {cell ? (
        <>
          <p>
            {t({ id: "officeAddin.word.scoped.cell", message: "Table cell" })}
          </p>
          <TextComparison original={cell.expectedText} proposed={cell.text} />
        </>
      ) : (
        <>
          {original && (
            <>
              <h4>
                {t({
                  id: "officeAddin.word.scoped.original",
                  message: "Original passage",
                })}
              </h4>
              <p className="word-review__text">{original}</p>
            </>
          )}
          {changed.length > 0 && (
            <>
              <h4>
                {t({
                  id: "officeAddin.word.scoped.proposed",
                  message: "Proposed changes",
                })}
              </h4>
              {changed.map((entry, i) => (
                <WordRichBlockSequence
                  key={i}
                  blocks={entry.blocks}
                  snapshot={snapshot}
                />
              ))}
            </>
          )}
          {plan.deleted.map((item, i) => (
            <p key={i}>
              {t({
                id: "officeAddin.word.scoped.removal",
                message: "Remove selected content",
              })}
              : {item.reason}
            </p>
          ))}
          {!changed.length &&
            !plan.deleted.length &&
            !plan.stories?.length &&
            !plan.sections?.length && (
              <p>
                {t({
                  id: "officeAddin.word.scoped.move",
                  message:
                    "Move the selected content to the reviewed destination.",
                })}
              </p>
            )}
          {plan.stories?.map((story) => (
            <section key={story.id}>
              <p className="word-review__text">
                {snapshot.stories?.find((s) => s.id === story.id)?.text}
              </p>
              {story.kind === "delete" ? (
                <p>
                  {t({
                    id: "officeAddin.word.scoped.removePart",
                    message: "Remove this document part and its links.",
                  })}
                </p>
              ) : (
                <WordRichBlockSequence
                  blocks={story.blocks ?? []}
                  snapshot={snapshot}
                />
              )}
            </section>
          ))}
          {plan.sections
            ?.filter(
              (section) =>
                scope.kind === "objects" &&
                (scope.targets.some(
                  (target) => target.sectionId === section.id,
                ) ||
                  !snapshot.sections?.some((s) => s.id === section.id)),
            )
            .map((section, index) => (
              <WordSectionPlanPreview
                key={section.id}
                section={section}
                index={index}
                label={(ref) =>
                  snapshot.blocks.find((b) => b.ref === ref)?.text ?? ref
                }
                plan={plan}
                snapshot={snapshot}
              />
            ))}
        </>
      )}
      {onLocate &&
        refs.map((ref, i) => (
          <Button
            key={ref}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onLocate(ref)}
          >
            {t({
              id: "officeAddin.word.scoped.locate",
              message: `Locate passage ${i + 1}`,
            })}
          </Button>
        ))}
      <p className="word-review__hint">
        {t({
          id: "officeAddin.word.scoped.preservation",
          message:
            "Other document content is preserved. Check final appearance in Word.",
        })}
      </p>
    </section>
  );
}
