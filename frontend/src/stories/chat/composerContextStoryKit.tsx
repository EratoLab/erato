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
    "state" | "meta" | "tone" | "removeLabel" | "restoreLabel" | "announcements"
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
};

const HOST_ONLY = new Set(["whenRemoved", "whenRestored", "thenSettles"]);
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
        const update = (next: (entry: StoryContextItem) => StoryContextItem) =>
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id ? next(entry) : entry,
            ),
          );
        const remove = () =>
          item.origin === "ambient"
            ? update((entry) => ({
                ...entry,
                state: "suggested",
                meta: undefined,
                tone: undefined,
                onRestore: noop,
                ...entry.whenRemoved,
              }))
            : setItems((current) =>
                current.filter((entry) => entry.id !== item.id),
              );
        const restore = () => {
          const seeded = original.get(item.id) ?? item;
          update(() => ({
            ...seeded,
            state: "included",
            tone: undefined,
            onRemove: noop,
            ...seeded.whenRestored,
          }));
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

/** Mirrors the polite live region into the page, for screenshots and review. */
export const AnnouncementLog = () => {
  const [entries, setEntries] = useState<string[]>([]);
  const lastRef = useRef("");
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const region = document.querySelector(
        '[data-ui="composer-context-live"]',
      );
      const text = region?.textContent?.replace(/\u200b/g, "").trim() ?? "";
      if (text && text !== lastRef.current) {
        setEntries((current) => [text, ...current].slice(0, 5));
      }
      lastRef.current = text;
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);
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
