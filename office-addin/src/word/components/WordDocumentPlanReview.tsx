import { Button, Select, TabRail } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { WordNativeBlockPreview } from "./WordNativeBlockPreview";
import {
  WordRichBlockPreview,
  WordRichBlockSequence,
} from "./WordRichBlockPreview";
import { WordSectionPlanPreview } from "./WordSectionPlanPreview";
import { wordPlanOutput, wordSourceReadRefs } from "../utils/wordDocumentPlan";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
} from "../utils/wordDocumentPlan";

export function WordDocumentPlanReview({
  plan,
  snapshot,
  onLocate,
}: {
  plan: WordDocumentPlan;
  snapshot: WordAuthoringSnapshot;
  onLocate?: (ref: string) => void;
}) {
  const id = useId();
  const [view, setView] = useState<"structure" | "draft" | "sources" | "parts">(
    "structure",
  );
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const output = wordPlanOutput(plan, snapshot);
  const listCounts = new Map<string, number>();
  const listLabels = new Map<string, number>();
  for (const item of output) {
    if (
      item.block.type !== "list-item" ||
      !item.block.list ||
      !item.block.ordered
    )
      continue;
    for (const key of listCounts.keys()) {
      const [list, level] = key.split(":");
      if (list === item.block.list && Number(level) > (item.block.level ?? 0))
        listCounts.delete(key);
    }
    const listKey = `${item.block.list}:${item.block.level ?? 0}`;
    const count = (listCounts.get(listKey) ?? 0) + 1;
    listCounts.set(listKey, count);
    listLabels.set(item.key, count);
  }
  const added = plan.entries.reduce(
    (count, e) => count + (e.kind === "insert" ? e.blocks.length : 0),
    0,
  );
  const removed = plan.deleted.flatMap((d) => d.source);
  const kept = plan.entries.flatMap((e) => (e.kind === "keep" ? e.source : []));
  const replaced = plan.entries.flatMap((e) =>
    e.kind === "replace" ? e.source : [],
  );
  const headings = output.filter((e) => e.block.type === "heading");
  const sourceHeadings = snapshot.blocks.filter((b) => b.type === "heading");
  const groups: { key: string; title: string; items: typeof output }[] = [];
  for (const item of output) {
    if (item.block.type === "heading" || !groups.length)
      groups.push({
        key: item.key,
        title:
          item.block.type === "heading"
            ? item.block.text
            : t({
                id: "officeAddin.word.authoring.opening",
                message: "Opening content",
              }),
        items: [],
      });
    groups[groups.length - 1].items.push(item);
  }
  return (
    <>
      <div className="word-review__header">
        <h3>
          {t({
            id: "officeAddin.word.authoring.review",
            message: "Review document rewrite",
          })}
        </h3>
        <p className="word-review__hint">
          {plan.scope === "document"
            ? t({
                id: "officeAddin.word.authoring.documentScope",
                message: "Document content and layout",
              })
            : t({
                id: "officeAddin.word.authoring.scope",
                message: "Main document body",
              })}
        </p>
        <p>
          {t({
            id: "officeAddin.word.authoring.coverage",
            message: `${snapshot.read.size} of ${wordSourceReadRefs(snapshot).length} source blocks read`,
          })}
        </p>
        <p className="word-review__totals">
          {t({
            id: "officeAddin.word.authoring.counts",
            message: `${kept.length} reused · ${replaced.length} rewritten · ${removed.length} removed · ${added} added`,
          })}
        </p>
        {!!(plan.stories?.length || plan.sections?.length) && (
          <p className="word-review__totals">
            {t({
              id: "officeAddin.word.authoring.partAndSectionCounts",
              message: `Document parts changed: ${plan.stories?.length ?? 0} · Sections configured: ${plan.sections?.length ?? 0}`,
            })}
          </p>
        )}
        {!!snapshot.blocks.filter((b) => b.type === "native").length && (
          <p className="word-review__hint">
            {t({
              id: "officeAddin.word.authoring.nativeScope",
              message:
                "Review changes to text and objects below. Check final pagination and appearance in Word.",
            })}
          </p>
        )}
        {plan.scope === "body" &&
          !!snapshot.preservedStories?.length &&
          !plan.stories?.length && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.authoring.preservedStories",
                message:
                  "Existing headers, footers, notes and comments are preserved. This plan edits the main body.",
              })}
            </p>
          )}
        {plan.entries.length === 0 && (
          <p>
            {t({
              id: "officeAddin.word.authoring.clearBody",
              message:
                "The body will be cleared, leaving Word’s empty final paragraph.",
            })}
          </p>
        )}
      </div>
      <TabRail
        value={view}
        onChange={setView}
        className="word-authoring__tabs flex-wrap"
        aria-label={t({
          id: "officeAddin.word.authoring.views",
          message: "Document review views",
        })}
        options={[
          {
            value: "structure",
            label: t({
              id: "officeAddin.word.authoring.structure",
              message: "Structure",
            }),
          },
          {
            value: "draft",
            label: t({
              id: "officeAddin.word.authoring.draft",
              message: "Full draft",
            }),
          },
          {
            value: "sources",
            label: t({
              id: "officeAddin.word.authoring.sources",
              message: "Source mapping",
            }),
          },
          ...(plan.stories?.length || plan.sections?.length
            ? [
                {
                  value: "parts",
                  label: t({
                    id: "officeAddin.word.authoring.parts",
                    message: "Document parts",
                  }),
                },
              ]
            : []),
        ].map((tab) => ({
          ...tab,
          value: tab.value as typeof view,
          id: `${id}-${tab.value}`,
          panelId: `${id}-panel`,
        }))}
      />
      <div
        className="word-authoring__content focus-ring"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${view}`}
        tabIndex={0}
      >
        {view === "structure" && (
          <div className="word-authoring__outline">
            <section>
              <h4>
                {t({
                  id: "officeAddin.word.authoring.beforeOutline",
                  message: `Original · ${sourceHeadings.length} headings`,
                })}
              </h4>
              <ol>
                {sourceHeadings.map((b) => (
                  <li
                    key={b.ref}
                    style={{
                      marginInlineStart: `${Math.min((b.level ?? 1) - 1, 4)}em`,
                    }}
                  >
                    {b.text}
                  </li>
                ))}
              </ol>
              {sourceHeadings.length === 0 && (
                <p>
                  {t({
                    id: "officeAddin.word.authoring.noHeadings",
                    message: "No headings",
                  })}
                </p>
              )}
            </section>
            <section>
              <h4>
                {t({
                  id: "officeAddin.word.authoring.afterOutline",
                  message: `Proposed · ${headings.length} headings`,
                })}
              </h4>
              <ol>
                {headings.map((b) => (
                  <li
                    key={b.key}
                    style={{
                      marginInlineStart: `${Math.min((b.block.level ?? 1) - 1, 4)}em`,
                    }}
                  >
                    {b.block.text}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
        {view === "draft" &&
          groups.map((group, i) => (
            <details
              key={group.key}
              open={(expanded ?? groups[0]?.key) === group.key}
              onToggle={(event) => {
                if (event.currentTarget.open && expanded !== group.key)
                  setExpanded(group.key);
              }}
            >
              <summary className="focus-ring">
                {group.title}
                <span className="word-review__hint">
                  {t({
                    id: "officeAddin.word.authoring.groupCount",
                    message: `${group.items.length} blocks`,
                  })}
                </span>
              </summary>
              <div
                className="word-authoring__draft"
                data-testid={`word-plan-group-${i}`}
              >
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className={`word-authoring__block word-authoring__block--${item.block.type}`}
                    style={
                      item.block.type === "list-item"
                        ? {
                            paddingInlineStart: `${Math.min(item.block.level ?? 0, 4)}em`,
                          }
                        : undefined
                    }
                  >
                    <span className="word-review__hint">
                      {item.source.length
                        ? t({
                            id: "officeAddin.word.authoring.from",
                            message: `Source: ${item.source.join(", ")}`,
                          })
                        : t({
                            id: "officeAddin.word.authoring.new",
                            message: "New content",
                          })}
                    </span>
                    {item.block.type === "native" ? (
                      <WordNativeBlockPreview block={item.block} />
                    ) : (
                      <div
                        className={
                          item.block.type === "list-item"
                            ? "word-rich-preview__list-item"
                            : undefined
                        }
                      >
                        {item.block.type === "list-item" && (
                          <span aria-hidden="true">
                            {item.block.ordered
                              ? `${listLabels.get(item.key) ?? 1}.`
                              : "•"}
                          </span>
                        )}
                        <WordRichBlockPreview
                          block={item.block as WordPlanBlock}
                          snapshot={snapshot}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
        {view === "sources" && (
          <>
            <Select
              label={t({
                id: "officeAddin.word.authoring.filter",
                message: "Show source blocks",
              })}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">
                {t({ id: "officeAddin.word.authoring.all", message: "All" })}
              </option>
              <option value="changed">
                {t({
                  id: "officeAddin.word.authoring.changed",
                  message: "Rewritten",
                })}
              </option>
              <option value="removed">
                {t({
                  id: "officeAddin.word.authoring.removed",
                  message: "Removed",
                })}
              </option>
            </Select>
            {snapshot.blocks
              .filter(
                (b) =>
                  filter === "all" ||
                  (filter === "changed" && replaced.includes(b.ref)) ||
                  (filter === "removed" && removed.includes(b.ref)),
              )
              .map((b) => (
                <details key={b.ref}>
                  <summary className="focus-ring">
                    {b.ref} ·{" "}
                    {removed.includes(b.ref)
                      ? t({
                          id: "officeAddin.word.authoring.removed",
                          message: "Removed",
                        })
                      : replaced.includes(b.ref)
                        ? t({
                            id: "officeAddin.word.authoring.changed",
                            message: "Rewritten",
                          })
                        : t({
                            id: "officeAddin.word.authoring.reused",
                            message: "Reused",
                          })}
                  </summary>
                  <strong>
                    {t({
                      id: "officeAddin.word.authoring.originalSource",
                      message: "Original source",
                    })}
                  </strong>
                  {b.type === "native" ? (
                    <WordNativeBlockPreview block={b} retained={false} />
                  ) : (
                    <p className="word-review__text">{b.text}</p>
                  )}
                  {removed.includes(b.ref) ? (
                    <p>
                      {
                        plan.deleted.find((d) => d.source.includes(b.ref))
                          ?.reason
                      }
                    </p>
                  ) : (
                    <div>
                      <strong>
                        {t({
                          id: "officeAddin.word.authoring.proposedContent",
                          message: "Proposed content",
                        })}
                      </strong>
                      {output
                        .filter((e) => e.source.includes(b.ref))
                        .map((e) => (
                          <div key={e.key}>
                            {e.block.type === "native" ? (
                              <WordNativeBlockPreview block={e.block} />
                            ) : (
                              <WordRichBlockPreview
                                block={e.block as WordPlanBlock}
                                snapshot={snapshot}
                              />
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                  {onLocate && b.paragraphOrdinal && (
                    <Button variant="link" onClick={() => onLocate(b.ref)}>
                      {t({
                        id: "officeAddin.word.review.showInWord",
                        message: "Show in Word ↗",
                      })}
                    </Button>
                  )}
                </details>
              ))}
          </>
        )}
        {view === "parts" && (
          <div className="word-authoring__draft">
            {(plan.stories ?? []).map((story) => (
              <section key={story.id}>
                <h4>
                  {storyLabel(story.type)} ·{" "}
                  {story.kind === "delete"
                    ? t({
                        id: "officeAddin.word.authoring.removed",
                        message: "Removed",
                      })
                    : snapshot.stories?.some((source) => source.id === story.id)
                      ? t({
                          id: "officeAddin.word.authoring.changed",
                          message: "Rewritten",
                        })
                      : t({
                          id: "officeAddin.word.authoring.new",
                          message: "New content",
                        })}
                </h4>
                <p className="word-review__hint">{story.id}</p>
                {story.kind === "delete" ? (
                  <p>
                    {snapshot.stories?.find((s) => s.id === story.id)?.text}
                  </p>
                ) : (
                  <WordRichBlockSequence
                    blocks={story.blocks ?? []}
                    snapshot={snapshot}
                  />
                )}
              </section>
            ))}
            {plan.sections && (
              <section>
                <h4>
                  {t({
                    id: "officeAddin.word.authoring.sectionLayout",
                    message: "Sections and page layout",
                  })}
                </h4>
                {plan.sections.map((section, index) => (
                  <WordSectionPlanPreview
                    key={section.id}
                    section={section}
                    index={index}
                    snapshot={snapshot}
                    plan={plan}
                    label={(ref) => {
                      const item = output.find(
                        (e) =>
                          ("id" in e.block && e.block.id === ref) ||
                          e.source.includes(ref),
                      );
                      return item?.block.text.slice(0, 120) || ref;
                    }}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
function storyLabel(type: string): string {
  switch (type) {
    case "header":
      return t({ id: "officeAddin.word.authoring.header", message: "Header" });
    case "footer":
      return t({ id: "officeAddin.word.authoring.footer", message: "Footer" });
    case "footnote":
      return t({
        id: "officeAddin.word.authoring.footnote",
        message: "Footnote",
      });
    case "endnote":
      return t({
        id: "officeAddin.word.authoring.endnote",
        message: "Endnote",
      });
    default:
      return t({
        id: "officeAddin.word.authoring.comment",
        message: "Comment",
      });
  }
}
