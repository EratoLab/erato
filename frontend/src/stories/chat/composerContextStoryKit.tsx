import { useEffect, useMemo, useRef, useState } from "react";

import type { ComposerContextItem } from "@/components/ui/Chat/ComposerContext/types";
import type {
  FileCapability,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

export const noop = () => {};

/** The Office task pane at a fixed width, or as wide as the viewport. */
export const pane = (width?: number) =>
  function Pane(Story: () => ReactNode) {
    return (
      <div
        data-story-pane=""
        className="bg-theme-bg-primary"
        style={{
          width: width ?? "100%",
          minHeight: "100vh",
          padding: 16,
          boxSizing: "border-box",
        }}
      >
        <Story />
      </div>
    );
  };

/** What a host resolves an item to after (x) or (+). */
export type HostOutcome = Partial<
  Pick<
    ComposerContextItem,
    | "state"
    | "meta"
    | "tone"
    | "removeLabel"
    | "restoreLabel"
    | "announcements"
    | "detail"
  >
>;

/**
 * A host item as story data, with the outcomes the host resolver would give
 * it. The outcomes never reach the lane.
 */
export type StoryContextItem = ComposerContextItem & {
  /** After an ambient (x); without it the item turns suggested with the scope's meta. */
  whenRemoved?: HostOutcome;
  /** After (+); without it the item is included again as seeded. */
  whenRestored?: HostOutcome;
  /** Where a `whenRestored` that is still loading lands. */
  thenSettles?: HostOutcome;
  /** What the same answer does to other items, by id (a dismissed selection gives the document back). */
  siblingsWhenRemoved?: Record<string, HostOutcome>;
  siblingsWhenRestored?: Record<string, HostOutcome>;
};

const HOST_ONLY = new Set([
  "whenRemoved",
  "whenRestored",
  "thenSettles",
  "siblingsWhenRemoved",
  "siblingsWhenRestored",
]);

const patchSiblings = (
  items: StoryContextItem[],
  patches: Record<string, HostOutcome> | undefined,
) =>
  patches
    ? items.map((entry) =>
        entry.id in patches ? { ...entry, ...patches[entry.id] } : entry,
      )
    : items;
const SETTLE_MS = 600;

const laneItem = (item: StoryContextItem) =>
  Object.fromEntries(
    Object.entries(item).filter(([key]) => !HOST_ONLY.has(key)),
  ) as ComposerContextItem;

/**
 * Plays the host resolver: an ambient (x) turns the item suggested, a user
 * (x) drops it, + includes it again as seeded. Seeds mark which handlers a
 * chip has by carrying `noop`.
 */
export const useResolved = (
  seed: StoryContextItem[],
): ComposerContextItem[] => {
  const [items, setItems] = useState(seed);
  const original = useMemo(
    () => new Map(seed.map((item) => [item.id, item])),
    [seed],
  );
  return useMemo(
    () =>
      items.map((item) => {
        const update = (
          next: (entry: StoryContextItem) => StoryContextItem,
          siblings?: Record<string, HostOutcome>,
        ) =>
          setItems((current) =>
            patchSiblings(
              current.map((entry) =>
                entry.id === item.id ? next(entry) : entry,
              ),
              siblings,
            ),
          );
        const remove = () =>
          item.origin === "ambient"
            ? update(
                (entry) => ({
                  ...entry,
                  state: "suggested",
                  meta: undefined,
                  tone: undefined,
                  onRestore: noop,
                  ...entry.whenRemoved,
                }),
                item.siblingsWhenRemoved,
              )
            : setItems((current) =>
                patchSiblings(
                  current.filter((entry) => entry.id !== item.id),
                  item.siblingsWhenRemoved,
                ),
              );
        const restore = () => {
          const seeded = original.get(item.id) ?? item;
          update(
            () => ({
              ...seeded,
              state: "included",
              tone: undefined,
              onRemove: noop,
              ...seeded.whenRestored,
            }),
            seeded.siblingsWhenRestored,
          );
          if (seeded.thenSettles) {
            const settled = seeded.thenSettles;
            window.setTimeout(
              () => update((entry) => ({ ...entry, ...settled })),
              SETTLE_MS,
            );
          }
        };
        return {
          ...laneItem(item),
          onRemove: item.onRemove ? remove : undefined,
          onRestore: item.onRestore ? restore : undefined,
        };
      }),
    [items, original],
  );
};

const LANE_LIVE = ['[data-ui="composer-context-live"]'];

/**
 * Mirrors the polite live regions into the page, for screenshots and review:
 * the lane's, and any a host speaks through beside it.
 */
export const AnnouncementLog = ({
  regions = LANE_LIVE,
}: {
  regions?: string[];
}) => {
  const [entries, setEntries] = useState<string[]>([]);
  const lastRef = useRef(new Map<string, string>());
  useEffect(() => {
    const observer = new MutationObserver(() => {
      for (const selector of regions) {
        const text =
          document
            .querySelector(selector)
            ?.textContent?.replace(/\u200b/g, "")
            .trim() ?? "";
        if (text && text !== lastRef.current.get(selector)) {
          setEntries((current) => [text, ...current].slice(0, 5));
        }
        lastRef.current.set(selector, text);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [regions]);
  return (
    <ol
      data-testid="announcement-log"
      aria-hidden="true"
      className="mt-3 list-none space-y-1 p-0 text-xs text-theme-fg-secondary"
    >
      {entries.map((entry, index) => (
        <li key={`${entry}-${index}`}>{`Announced: ${entry}`}</li>
      ))}
    </ol>
  );
};

const documentCapability: FileCapability = {
  id: "pdf",
  extensions: ["pdf"],
  mime_types: ["application/pdf"],
  operations: ["extract_text"],
};

export const stagedFile = (id: string, filename: string): FileUploadItem => ({
  id,
  filename,
  download_url: `https://example.com/${id}`,
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
  file_capability: documentCapability,
});
