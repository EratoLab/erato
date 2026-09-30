import { Button } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { WordRichBlockSequence } from "./WordRichBlockPreview";
import { planCounts } from "../utils/wordPlanReview";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../utils/wordDocumentPlan";

/** Saved previews have no live object inventory and cannot authorize writes. */
const NO_SOURCES: WordAuthoringSnapshot = {
  token: "",
  identity: "",
  ooxml: "",
  fingerprint: "",
  blocks: [],
  styles: [],
  read: new Set(),
  revoked: true,
  used: true,
};

export function WordSavedPlanPreview({ plan }: { plan: WordDocumentPlan }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const counts = planCounts(plan);
  const { added } = counts;
  return (
    <div className="word-review__header">
      <h3>
        {t({
          id: "officeAddin.word.authoring.savedDraft",
          message: "Saved document rewrite",
        })}
      </h3>
      <p className="word-review__totals">
        {t({
          id: "officeAddin.word.authoring.counts",
          message: `${counts.kept} reused · ${counts.replaced} rewritten · ${counts.removed} removed · ${added} added`,
        })}
      </p>
      <p className="word-review__hint">
        {t({
          id: "officeAddin.word.authoring.savedDraftSources",
          message:
            "The submitted draft is saved. Original source content and image data are unavailable in this session; applying requires a fresh document request.",
        })}
      </p>
      <Button
        type="button"
        variant="secondary"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? t({
              id: "officeAddin.word.review.hideDetails",
              message: "Hide details",
            })
          : t({
              id: "officeAddin.word.review.showDetails",
              message: "Show details",
            })}
      </Button>
      {expanded && (
        <div id={id}>
          {plan.entries.map((entry, index) =>
            entry.kind === "keep" ? (
              <p key={index}>
                {t({
                  id: "officeAddin.word.authoring.savedRetainedBlocks",
                  message: `${entry.source.length} original source blocks retained`,
                })}
              </p>
            ) : (
              <WordRichBlockSequence
                key={index}
                blocks={entry.blocks}
                snapshot={NO_SOURCES}
              />
            ),
          )}
          {plan.stories?.map(
            (story) =>
              story.blocks && (
                <WordRichBlockSequence
                  key={story.id}
                  blocks={story.blocks}
                  snapshot={NO_SOURCES}
                />
              ),
          )}
        </div>
      )}
    </div>
  );
}
