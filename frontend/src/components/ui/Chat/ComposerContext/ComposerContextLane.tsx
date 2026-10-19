import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { componentRegistry } from "@/config/componentRegistry";
import { isImeComposing } from "@/utils/isImeComposing";

import {
  ComposerContextChip,
  DefaultComposerContextChipFace,
  composerContextControl,
} from "./ComposerContextChip";
import { ComposerContextDetail } from "./ComposerContextDetail";
import { fitChipsInBudget, readLaneGeometry } from "./composerContextLayout";
import {
  announceCannotRemove,
  announceExpanded,
  announceLocked,
  announceNotIncluded,
  announceOutcome,
  announceRemoved,
  announceRemovedAmbient,
  announceRestored,
  laneLabel,
  lessChipLabel,
  moreChipLabel,
  moreChipText,
  statePill,
} from "./composerContextStrings";
import { useLiveAnnouncement } from "./useLiveAnnouncement";

import type {
  ComposerContextChipFaceProps,
  ComposerContextItem,
  ComposerContextState,
} from "./types";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from "react";

// Tab-stop keys for the two overflow chips, never shown.
// eslint-disable-next-line lingui/no-unlocalized-strings
const MORE_KEY = "__more";
// eslint-disable-next-line lingui/no-unlocalized-strings
const LESS_KEY = "__less";
/** How long a click waits for the host to answer with a new state. */
const PENDING_TIMEOUT_MS = 3000;

interface PendingAction {
  action: "remove" | "restore";
  state: ComposerContextState;
  label: string;
  removedText?: string;
  at: number;
  /** The tab stops when the user acted, to find the next one if the chip leaves. */
  stops: string[];
}

export interface ComposerContextLaneProps {
  /**
   * Rendered as given: the lane never derives or caches a state. Pass a
   * memoized array; a new array re-measures the lane.
   */
  items: ComposerContextItem[];
  /** Height in px the chips may use before folding into "+N more"; omitted, they never fold. */
  budget?: number;
  /** Where focus goes when the last chip leaves; the composer's textarea. */
  onFocusComposer?: () => void;
  /** Removes a user item's claimed files, before its `onRemove` runs. */
  onRemoveClaimedFiles?: (fileIds: string[]) => void;
  /** Speak through the owner's live region; omitted, the lane renders its own. */
  announce?: (text: string) => void;
  /** Wins over `componentRegistry.ComposerContextChipFace`. */
  chipFace?: ComponentType<ComposerContextChipFaceProps>;
}

const isFocusAvailable = (lane: HTMLElement | null) => {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    Boolean(lane?.contains(active))
  );
};

/**
 * The composer's context chips: one tab stop, arrows between chips, Enter
 * opens a chip's detail, Delete or Backspace removes and + includes. Clicking
 * (x) never changes a chip by itself; the chip changes when the host hands
 * back a new state, and only then is the outcome announced.
 */
export const ComposerContextLane = memo(function ComposerContextLane({
  items,
  budget,
  onFocusComposer,
  onRemoveClaimedFiles,
  announce,
  chipFace,
}: ComposerContextLaneProps) {
  const Face =
    chipFace ??
    componentRegistry.ComposerContextChipFace ??
    DefaultComposerContextChipFace;
  const [ownAnnouncement, announceOwn] = useLiveAnnouncement();
  const say = announce ?? announceOwn;

  const ordered = useMemo(
    () => [
      ...items.filter((item) => item.origin === "ambient"),
      ...items.filter((item) => item.origin === "user"),
    ],
    [items],
  );

  const laneRef = useRef<HTMLDivElement>(null);
  const openRefs = useRef(new Map<string, HTMLButtonElement>());
  const moreRef = useRef<HTMLButtonElement>(null);
  const lessRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(new Map<string, PendingAction>());
  const prevStatesRef = useRef(new Map<string, ComposerContextState>());
  const prevStopsRef = useRef<string[]>([]);
  const warnedRef = useRef(new Set<string>());
  const focusAfterExpandRef = useRef<number | null>(null);
  const focusAfterCollapseRef = useRef(false);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [laneWidth, setLaneWidth] = useState(0);
  const [measured, setMeasured] = useState<{
    key: string;
    visible: number;
  } | null>(null);

  const itemsKey = useMemo(
    () =>
      ordered
        .map((item) =>
          [item.id, item.state, item.label, item.meta ?? "", item.locked]
            .map(String)
            .join("\u0000"),
        )
        .join("\u0001"),
    [ordered],
  );
  const measureKey =
    budget === undefined || expanded
      ? null
      : `${itemsKey}|${laneWidth}|${Math.round(budget)}`;
  const measuring = measureKey !== null && measured?.key !== measureKey;
  const fitCount =
    measureKey !== null && measured?.key === measureKey
      ? measured.visible
      : ordered.length;
  // A re-collapse never hides the chip the user is on.
  const focusedIndex = hasFocus
    ? ordered.findIndex((item) => item.id === activeKey)
    : -1;
  const visibleCount = Math.min(
    ordered.length,
    Math.max(fitCount, focusedIndex + 1),
  );
  const shown =
    expanded || measuring ? ordered : ordered.slice(0, visibleCount);
  const hiddenCount = ordered.length - shown.length;
  const showMore = !expanded && (measuring || hiddenCount > 0);

  const stops = useMemo(() => {
    const keys = shown.map((item) => item.id);
    if (showMore && !measuring) {
      keys.push(MORE_KEY);
    }
    if (expanded && ordered.length > 0) {
      keys.push(LESS_KEY);
    }
    return keys;
  }, [shown, showMore, measuring, expanded, ordered.length]);

  // The remembered stop, or its nearest surviving neighbour when it left.
  const tabStop = useMemo(() => {
    if (activeKey !== null && stops.includes(activeKey)) {
      return activeKey;
    }
    const previous = prevStopsRef.current;
    const index = activeKey === null ? -1 : previous.indexOf(activeKey);
    if (index >= 0) {
      const after = previous
        .slice(index + 1)
        .find((key) => stops.includes(key));
      const before = previous
        .slice(0, index)
        .reverse()
        .find((key) => stops.includes(key));
      return after ?? before ?? stops.at(0) ?? null;
    }
    return stops.at(0) ?? null;
  }, [activeKey, stops]);

  const elementFor = useCallback((key: string): HTMLElement | null => {
    if (key === MORE_KEY) {
      return moreRef.current;
    }
    if (key === LESS_KEY) {
      return lessRef.current;
    }
    return openRefs.current.get(key) ?? null;
  }, []);

  const focusKey = useCallback(
    (key: string) => {
      setActiveKey(key);
      elementFor(key)?.focus();
    },
    [elementFor],
  );

  const focusAfterRemoval = useCallback(
    (id: string, stopsWhenActed: string[]) => {
      const index = stopsWhenActed.indexOf(id);
      const after = stopsWhenActed
        .slice(index + 1)
        .find((key) => stops.includes(key));
      const before = stopsWhenActed
        .slice(0, Math.max(0, index))
        .reverse()
        .find((key) => stops.includes(key));
      const next = after ?? before;
      if (next) {
        focusKey(next);
      } else {
        onFocusComposer?.();
      }
    },
    [stops, focusKey, onFocusComposer],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    for (const item of ordered) {
      if (
        item.state === "suggested" &&
        !item.onRestore &&
        !warnedRef.current.has(item.id)
      ) {
        warnedRef.current.add(item.id);
        console.warn(
          `[ComposerContextLane] "${item.id}" is suggested but has no onRestore, so it cannot be included again.`,
        );
      }
    }
  }, [ordered]);

  // Outcomes, focus placement and async transitions, all from the commit that
  // delivers the host's new items.
  useLayoutEffect(() => {
    const now = Date.now();
    const byId = new Map(ordered.map((item) => [item.id, item]));
    const handled = new Set<string>();
    const lane = laneRef.current;

    for (const [id, pending] of pendingRef.current) {
      const item = byId.get(id);
      if (!item) {
        pendingRef.current.delete(id);
        handled.add(id);
        say(pending.removedText ?? announceRemoved(pending.label));
        if (isFocusAvailable(lane)) {
          focusAfterRemoval(id, pending.stops);
        }
        continue;
      }
      if (item.state === pending.state) {
        if (now - pending.at > PENDING_TIMEOUT_MS) {
          pendingRef.current.delete(id);
        }
        continue;
      }
      // Still working on it: wait for where it lands.
      if (item.state === "loading") {
        pending.state = "loading";
        pending.at = now;
        continue;
      }
      pendingRef.current.delete(id);
      handled.add(id);
      if (pending.action === "remove" && item.state === "suggested") {
        say(item.announcements?.removed ?? announceRemovedAmbient(item.label));
      } else if (pending.action === "restore" && item.state === "included") {
        say(item.announcements?.restored ?? announceRestored(item.label));
      }
      if (isFocusAvailable(lane)) {
        focusKey(id);
      }
    }

    for (const item of ordered) {
      const previous = prevStatesRef.current.get(item.id);
      if (
        !handled.has(item.id) &&
        previous === "loading" &&
        (item.state === "error" || item.state === "attention")
      ) {
        say(announceOutcome(item.label, item.meta ?? statePill(item.state)));
      }
    }
    prevStatesRef.current = new Map(
      ordered.map((item) => [item.id, item.state]),
    );

    if (openDetailId !== null && !byId.has(openDetailId)) {
      setOpenDetailId(null);
      if (!handled.has(openDetailId) && isFocusAvailable(lane)) {
        focusAfterRemoval(openDetailId, prevStopsRef.current);
      }
    }
    // Only a new items array is an outcome; the other inputs are read as of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered]);

  useLayoutEffect(() => {
    prevStopsRef.current = stops;
    if (tabStop !== activeKey && tabStop !== null && activeKey !== null) {
      setActiveKey(tabStop);
    }
  }, [stops, tabStop, activeKey]);

  // Measuring pass: every chip and the "+N more" chip are in the DOM, so one
  // read decides how many fit; the count commits before paint.
  useLayoutEffect(() => {
    if (!measuring || budget === undefined) {
      return;
    }
    const lane = laneRef.current;
    const geometry = lane ? readLaneGeometry(lane) : null;
    setMeasured({
      key: measureKey,
      visible: geometry ? fitChipsInBudget(geometry, budget) : ordered.length,
    });
  }, [measuring, measureKey, budget, ordered.length]);

  const hasItems = ordered.length > 0;
  const folds = budget !== undefined;
  useLayoutEffect(() => {
    const lane = laneRef.current;
    if (!lane || !folds) {
      return;
    }
    const read = () => {
      const width = Math.round(lane.getBoundingClientRect().width);
      setLaneWidth((current) => (current === width ? current : width));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(lane);
    return () => observer.disconnect();
  }, [hasItems, folds]);

  useLayoutEffect(() => {
    if (expanded && focusAfterExpandRef.current !== null) {
      const target = ordered.at(focusAfterExpandRef.current) ?? ordered.at(0);
      focusAfterExpandRef.current = null;
      if (target) {
        focusKey(target.id);
      }
    }
    if (!expanded && focusAfterCollapseRef.current && !measuring) {
      focusAfterCollapseRef.current = false;
      focusKey(stops.includes(MORE_KEY) ? MORE_KEY : (stops.at(0) ?? MORE_KEY));
    }
  }, [expanded, measuring, ordered, stops, focusKey]);

  const runRemove = useCallback(
    (item: ComposerContextItem) => {
      if (item.locked) {
        say(item.lockReason ?? announceLocked(item.label));
        return;
      }
      if (!item.onRemove) {
        return;
      }
      pendingRef.current.set(item.id, {
        action: "remove",
        state: item.state,
        label: item.label,
        removedText: item.announcements?.removed,
        at: Date.now(),
        stops: prevStopsRef.current,
      });
      if (item.origin === "user" && item.claimsFileIds?.length) {
        onRemoveClaimedFiles?.(item.claimsFileIds);
      }
      item.onRemove();
    },
    [say, onRemoveClaimedFiles],
  );

  const runRestore = useCallback(
    (item: ComposerContextItem) => {
      if (item.locked) {
        say(item.lockReason ?? announceLocked(item.label));
        return;
      }
      if (!item.onRestore) {
        return;
      }
      pendingRef.current.set(item.id, {
        action: "restore",
        state: item.state,
        label: item.label,
        at: Date.now(),
        stops: prevStopsRef.current,
      });
      item.onRestore();
    },
    [say],
  );

  const closeDetail = useCallback(
    ({ restoreFocus }: { restoreFocus: boolean }) => {
      const id = openDetailId;
      setOpenDetailId(null);
      if (restoreFocus && id !== null) {
        focusKey(id);
      }
    },
    [openDetailId, focusKey],
  );

  const openDetail = useCallback((item: ComposerContextItem) => {
    if (!item.detail) {
      return;
    }
    setActiveKey(item.id);
    setOpenDetailId((current) => (current === item.id ? null : item.id));
  }, []);

  const moveFrom = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, key: string) => {
      const index = stops.indexOf(key);
      let target: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        target = Math.min(stops.length - 1, index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        target = Math.max(0, index - 1);
      } else if (event.key === "Home") {
        target = 0;
      } else if (event.key === "End") {
        target = stops.length - 1;
      }
      if (target === null || index < 0) {
        return false;
      }
      event.preventDefault();
      focusKey(stops[target]);
      return true;
    },
    [stops, focusKey],
  );

  const handleChipKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLButtonElement>,
      item: ComposerContextItem,
    ) => {
      if (isImeComposing(event) || moveFrom(event, item.id)) {
        return;
      }
      const control = composerContextControl(item);
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (control === "remove") {
          runRemove(item);
        } else if (control === "restore") {
          say(
            item.locked
              ? (item.lockReason ?? announceLocked(item.label))
              : announceNotIncluded(item.label),
          );
        } else {
          say(item.lockReason ?? announceCannotRemove(item.label));
        }
      } else if (
        (event.key === "+" || event.key === "Insert") &&
        control === "restore"
      ) {
        event.preventDefault();
        runRestore(item);
      }
    },
    [moveFrom, runRemove, runRestore, say],
  );

  const setOpenRef = useCallback(
    (id: string) => (element: HTMLButtonElement | null) => {
      if (element) {
        openRefs.current.set(id, element);
      } else {
        openRefs.current.delete(id);
      }
    },
    [],
  );

  const detailItem =
    openDetailId === null
      ? undefined
      : ordered.find((item) => item.id === openDetailId);

  const liveRegion = announce ? null : (
    <div
      className="sr-only"
      aria-live="polite"
      aria-atomic="true"
      data-ui="composer-context-live"
    >
      {ownAnnouncement}
    </div>
  );

  if (!hasItems) {
    return liveRegion;
  }

  return (
    <>
      <div
        ref={laneRef}
        role="list"
        aria-label={laneLabel()}
        data-ui="composer-context-lane"
        className="flex min-w-0 flex-wrap items-start gap-1.5"
        onFocus={() => setHasFocus(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setHasFocus(false);
          }
        }}
      >
        {shown.map((item) => (
          <ComposerContextChip
            key={item.id}
            item={item}
            face={Face}
            tabIndex={tabStop === item.id ? 0 : -1}
            openRef={setOpenRef(item.id)}
            isDetailOpen={openDetailId === item.id}
            onOpen={openDetail}
            onRemove={runRemove}
            onRestore={runRestore}
            onFocus={setActiveKey}
            onKeyDown={handleChipKeyDown}
          />
        ))}
        {showMore ? (
          <div
            role="listitem"
            data-ui="composer-context-more"
            data-expanded="false"
            className="flex"
          >
            <button
              ref={moreRef}
              type="button"
              tabIndex={!measuring && tabStop === MORE_KEY ? 0 : -1}
              aria-label={moreChipLabel(
                measuring ? ordered.length : hiddenCount,
              )}
              onFocus={() => setActiveKey(MORE_KEY)}
              onKeyDown={(event) => {
                moveFrom(event, MORE_KEY);
              }}
              onClick={() => {
                focusAfterExpandRef.current = visibleCount;
                setExpanded(true);
                say(announceExpanded());
              }}
              className="composer-context-chip-geometry composer-context-chip-skin whitespace-nowrap px-2.5 text-xs font-semibold text-theme-fg-secondary hover:text-theme-fg-primary focus:outline-none"
            >
              {moreChipText(measuring ? ordered.length : hiddenCount)}
            </button>
          </div>
        ) : null}
        {expanded ? (
          <div
            role="listitem"
            data-ui="composer-context-more"
            data-expanded="true"
            className="flex"
          >
            <button
              ref={lessRef}
              type="button"
              tabIndex={tabStop === LESS_KEY ? 0 : -1}
              onFocus={() => setActiveKey(LESS_KEY)}
              onKeyDown={(event) => {
                moveFrom(event, LESS_KEY);
              }}
              onClick={() => {
                focusAfterCollapseRef.current = true;
                setExpanded(false);
              }}
              className="composer-context-chip-geometry composer-context-chip-skin whitespace-nowrap px-2.5 text-xs font-semibold text-theme-fg-secondary hover:text-theme-fg-primary focus:outline-none"
            >
              {lessChipLabel()}
            </button>
          </div>
        ) : null}
      </div>
      {detailItem ? (
        <ComposerContextDetail
          item={detailItem}
          anchor={
            openRefs.current
              .get(detailItem.id)
              ?.closest<HTMLElement>('[data-ui="composer-context-chip"]') ??
            null
          }
          trigger={openRefs.current.get(detailItem.id) ?? null}
          onClose={closeDetail}
          onRemove={(item) => {
            closeDetail({ restoreFocus: true });
            runRemove(item);
          }}
          onRestore={(item) => {
            closeDetail({ restoreFocus: true });
            runRestore(item);
          }}
        />
      ) : null}
      {liveRegion}
    </>
  );
});
