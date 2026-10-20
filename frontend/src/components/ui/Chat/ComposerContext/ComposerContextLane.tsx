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
  composerContextSpokenLabel,
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
  ComposerContextDetailAction,
  ComposerContextItem,
  ComposerContextState,
} from "./types";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from "react";

// Tab-stop keys for the two overflow chips, never shown.
// eslint-disable-next-line lingui/no-unlocalized-strings
const MORE_KEY = "__more";
// eslint-disable-next-line lingui/no-unlocalized-strings
const LESS_KEY = "__less";
/**
 * How long a click waits for the host to answer with a new state. A host
 * still loading keeps it waiting: what that loading ends in is the outcome.
 */
const PENDING_TIMEOUT_MS = 3000;

interface PendingAction {
  action: "remove" | "restore" | "detail";
  state: ComposerContextState;
  origin: ComposerContextItem["origin"];
  label: string;
  removedText?: string;
  /** A detail action's own words for a state it asked for. */
  detailText?: string;
  /** A user item's claimed files, unstaged once the host drops the item. */
  claimsFileIds?: string[];
  at: number;
  /** The lane's order when the user acted, to find the next chip if this one leaves. */
  order: string[];
}

const needsTheUser = (item: ComposerContextItem) =>
  item.state === "error" || item.state === "attention";

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
  /** Unstages a user item's claimed files once the host drops it after its (x). */
  onRemoveClaimedFiles?: (fileIds: string[]) => void;
  /** Speak through the owner's live region; omitted, the lane renders its own. */
  announce?: (text: string) => void;
  /** Wins over `componentRegistry.ComposerContextChipFace`. */
  chipFace?: ComponentType<ComposerContextChipFaceProps>;
  /** Names the list; defaults to "Message context". */
  label?: string;
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
  label,
}: ComposerContextLaneProps) {
  const Face =
    chipFace ??
    componentRegistry.ComposerContextChipFace ??
    DefaultComposerContextChipFace;
  const [ownAnnouncement, announceOwn] = useLiveAnnouncement();
  const say = announce ?? announceOwn;

  const ordered = useMemo(
    () => [
      ...items.filter((item) => (item.placement ?? item.origin) === "ambient"),
      ...items.filter((item) => (item.placement ?? item.origin) === "user"),
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
  const prevOrderRef = useRef<string[]>([]);
  const warnedRef = useRef(new Set<string>());
  const focusAfterExpandRef = useRef<number | null>(null);
  const focusAfterCollapseRef = useRef(false);
  // Whether "+N more" or "Show less" held focus last, so its unmounting
  // can hand focus on; a click elsewhere in the lane or page clears it.
  const overflowFocusRef = useRef(false);

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
  // A re-collapse never hides the chip the user is on, nor one that needs
  // the user (an error, a choice) behind "+N more".
  const focusedIndex = hasFocus
    ? ordered.findIndex((item) => item.id === activeKey)
    : -1;
  let lastNeedIndex = -1;
  ordered.forEach((item, index) => {
    if (needsTheUser(item)) {
      lastNeedIndex = index;
    }
  });
  const visibleCount = Math.min(
    ordered.length,
    Math.max(fitCount, focusedIndex + 1, lastNeedIndex + 1),
  );
  const shown =
    expanded || measuring ? ordered : ordered.slice(0, visibleCount);
  const hiddenCount = ordered.length - shown.length;
  const showMore = !expanded && (measuring || hiddenCount > 0);

  const stops = useMemo(() => {
    const keys = shown.map((item) => item.id);
    if (showMore) {
      keys.push(MORE_KEY);
    }
    if (expanded && ordered.length > 0) {
      keys.push(LESS_KEY);
    }
    return keys;
  }, [shown, showMore, expanded, ordered.length]);

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

  // The chip that takes the removed one's place, from the lane's order when
  // the user acted, so a chip folded behind "+N more" then still counts.
  const focusAfterRemoval = useCallback(
    (id: string, orderWhenActed: string[]) => {
      const present = new Set(ordered.map((item) => item.id));
      const index = orderWhenActed.indexOf(id);
      const after = orderWhenActed
        .slice(index + 1)
        .find((key) => present.has(key));
      const before = orderWhenActed
        .slice(0, Math.max(0, index))
        .reverse()
        .find((key) => present.has(key));
      const next = after ?? before;
      const target =
        next === undefined
          ? null
          : stops.includes(next)
            ? next
            : stops.includes(MORE_KEY)
              ? MORE_KEY
              : null;
      if (target) {
        focusKey(target);
      } else {
        onFocusComposer?.();
      }
    },
    [ordered, stops, focusKey, onFocusComposer],
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
      // A late change is not the answer to the click; a host still loading
      // has not answered yet.
      if (
        pending.state !== "loading" &&
        now - pending.at > PENDING_TIMEOUT_MS
      ) {
        pendingRef.current.delete(id);
        continue;
      }
      const item = byId.get(id);
      if (!item) {
        pendingRef.current.delete(id);
        handled.add(id);
        if (pending.action === "remove") {
          if (pending.claimsFileIds?.length) {
            onRemoveClaimedFiles?.(pending.claimsFileIds);
          }
          say(pending.removedText ?? announceRemoved(pending.label));
        } else if (pending.action === "detail" && pending.detailText) {
          // A choice that ends the item ("Use selected passage instead" on a
          // pick) still did what it said.
          say(pending.detailText);
        }
        if (isFocusAvailable(lane)) {
          focusAfterRemoval(id, pending.order);
        }
        continue;
      }
      // A user item whose (x) hands its id back to ambient context (a pick
      // that ends into the comment at the caret) was removed all the same,
      // whatever state the ambient item lands in; focus stays on it.
      if (pending.action === "remove" && item.origin !== pending.origin) {
        pendingRef.current.delete(id);
        handled.add(id);
        if (pending.claimsFileIds?.length) {
          onRemoveClaimedFiles?.(pending.claimsFileIds);
        }
        say(pending.removedText ?? announceRemoved(pending.label));
        if (isFocusAvailable(lane)) {
          focusKey(id);
        }
        continue;
      }
      if (item.state === pending.state) {
        continue;
      }
      if (item.state === "loading") {
        pending.state = "loading";
        pending.at = now;
        continue;
      }
      pendingRef.current.delete(id);
      handled.add(id);
      const spoken = composerContextSpokenLabel(item);
      if (pending.action === "detail" && pending.detailText) {
        say(
          needsTheUser(item)
            ? announceOutcome(spoken, item.meta ?? statePill(item.state))
            : pending.detailText,
        );
      } else if (pending.action === "remove" && item.state === "suggested") {
        say(item.announcements?.removed ?? announceRemovedAmbient(spoken));
      } else if (pending.action === "restore" && item.state === "included") {
        say(item.announcements?.restored ?? announceRestored(spoken));
      } else {
        // Not what the user asked for (a retry that failed again, a
        // selection that wins): say where it landed.
        say(announceOutcome(spoken, item.meta ?? statePill(item.state)));
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
        needsTheUser(item)
      ) {
        say(
          announceOutcome(
            composerContextSpokenLabel(item),
            item.meta ?? statePill(item.state),
          ),
        );
      }
    }
    prevStatesRef.current = new Map(
      ordered.map((item) => [item.id, item.state]),
    );

    if (openDetailId !== null && !byId.has(openDetailId)) {
      setOpenDetailId(null);
      if (!handled.has(openDetailId) && isFocusAvailable(lane)) {
        focusAfterRemoval(openDetailId, prevOrderRef.current);
      }
    }

    // A lane that empties, or whose items are all new (another email,
    // another document), starts folded again.
    const ids = ordered.map((item) => item.id);
    const previousIds = prevOrderRef.current;
    if (
      expanded &&
      (ids.length === 0 ||
        (previousIds.length > 0 && !ids.some((id) => previousIds.includes(id))))
    ) {
      setExpanded(false);
    }
    prevOrderRef.current = ids;
    // Only a new items array is an outcome; the other inputs are read as of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered]);

  useLayoutEffect(() => {
    prevStopsRef.current = stops;
    if (tabStop !== activeKey && tabStop !== null && activeKey !== null) {
      // "+N more" or "Show less" left while focused (a re-measure that
      // hides nothing, a lane that folds again): keep the user in the lane.
      const lostOverflowChip =
        overflowFocusRef.current &&
        (activeKey === MORE_KEY || activeKey === LESS_KEY) &&
        focusAfterExpandRef.current === null &&
        !focusAfterCollapseRef.current &&
        (document.activeElement === null ||
          document.activeElement === document.body);
      setActiveKey(tabStop);
      if (lostOverflowChip) {
        elementFor(tabStop)?.focus();
      }
    }
    // A focused chip the host took away leaves no blur behind; without this
    // the lane would keep unfolding for a chip nobody is on.
    if (hasFocus && !laneRef.current?.contains(document.activeElement)) {
      setHasFocus(false);
    }
  }, [stops, tabStop, activeKey, elementFor, hasFocus]);

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

  // Expanded only while folding is still needed: once every chip fits, the
  // lane goes back to its default.
  useLayoutEffect(() => {
    if (!expanded || budget === undefined) {
      return;
    }
    const lane = laneRef.current;
    const geometry = lane ? readLaneGeometry(lane) : null;
    if (
      geometry?.boxes.length === ordered.length &&
      fitChipsInBudget(geometry, budget) >= ordered.length
    ) {
      setExpanded(false);
    }
  }, [expanded, budget, itemsKey, laneWidth, ordered.length]);

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
      focusKey(
        stops.includes(MORE_KEY) ? MORE_KEY : (stops.at(-1) ?? MORE_KEY),
      );
    }
  }, [expanded, measuring, ordered, stops, focusKey]);

  // Claimed files leave with the item, after the host drops it, so a host
  // that keeps the chip never shows "included" over files no longer sent.
  const runRemove = useCallback(
    (item: ComposerContextItem) => {
      if (item.locked) {
        say(
          item.lockReason ?? announceLocked(composerContextSpokenLabel(item)),
        );
        return;
      }
      if (!item.onRemove) {
        return;
      }
      pendingRef.current.set(item.id, {
        action: "remove",
        state: item.state,
        origin: item.origin,
        label: composerContextSpokenLabel(item),
        removedText: item.announcements?.removed,
        claimsFileIds: item.origin === "user" ? item.claimsFileIds : undefined,
        at: Date.now(),
        order: prevOrderRef.current,
      });
      item.onRemove();
    },
    [say],
  );

  const runRestore = useCallback(
    (item: ComposerContextItem) => {
      if (item.locked) {
        say(
          item.lockReason ?? announceLocked(composerContextSpokenLabel(item)),
        );
        return;
      }
      if (!item.onRestore) {
        return;
      }
      pendingRef.current.set(item.id, {
        action: "restore",
        state: item.state,
        origin: item.origin,
        label: composerContextSpokenLabel(item),
        at: Date.now(),
        order: prevOrderRef.current,
      });
      item.onRestore();
    },
    [say],
  );

  // Recorded before the host's action runs, so a host that commits its new
  // state synchronously still finds the action waiting for it.
  const recordDetailAction = useCallback(
    (item: ComposerContextItem, action: ComposerContextDetailAction) => {
      if (!action.announcement) {
        return;
      }
      pendingRef.current.set(item.id, {
        action: "detail",
        state: item.state,
        origin: item.origin,
        label: composerContextSpokenLabel(item),
        detailText: action.announcement,
        at: Date.now(),
        order: prevOrderRef.current,
      });
    },
    [],
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

  const focusChip = useCallback((id: string) => {
    overflowFocusRef.current = false;
    setActiveKey(id);
  }, []);

  const focusOverflowChip = useCallback((key: string) => {
    overflowFocusRef.current = true;
    setActiveKey(key);
  }, []);

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
      const spoken = composerContextSpokenLabel(item);
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (control === "remove") {
          runRemove(item);
        } else if (control === "restore") {
          say(
            item.locked
              ? (item.lockReason ?? announceLocked(spoken))
              : announceNotIncluded(spoken),
          );
        } else {
          say(item.lockReason ?? announceCannotRemove(spoken));
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
        aria-label={laneLabel(label)}
        data-ui="composer-context-lane"
        className="flex min-w-0 flex-wrap items-start gap-1.5"
        onFocus={() => setHasFocus(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setHasFocus(false);
            if (event.relatedTarget !== null) {
              overflowFocusRef.current = false;
            }
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
            onFocus={focusChip}
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
              tabIndex={tabStop === MORE_KEY ? 0 : -1}
              aria-label={moreChipLabel(
                measuring ? ordered.length : hiddenCount,
              )}
              onFocus={() => focusOverflowChip(MORE_KEY)}
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
              onFocus={() => focusOverflowChip(LESS_KEY)}
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
          onAction={recordDetailAction}
        />
      ) : null}
      {liveRegion}
    </>
  );
});
