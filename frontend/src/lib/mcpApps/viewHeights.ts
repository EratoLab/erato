import { MAX_VIEW_HEIGHT } from "./hostContext";

/**
 * The heights views showed at, so that a view's frame starts at the height it
 * had last time instead of growing from nothing: kept in memory and, so that
 * a reload keeps them, in the tab's session storage. A call's own height
 * comes first; for a call shown for the first time, the height its server's
 * view had at about the same width.
 */

const STORAGE_KEY = "erato.mcpApps.viewHeights";

/** The most heights kept; the oldest go first. */
const MAX_ENTRIES = 200;

/** Widths that differ by less than this share a view's height. */
const WIDTH_STEP_PX = 40;

/** Which view, and where, a height belongs to. */
export interface ViewHeightKey {
  /** The tool call the view shows, when it has an id. */
  callId?: string;
  serverId: string;
  uri: string;
  /** The width the view has, once measured. */
  width?: number;
}

const isHeight = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= MAX_VIEW_HEIGHT;

let heights: Map<string, number> | undefined;

/** The heights kept, read from session storage the first time. */
const kept = (): Map<string, number> => {
  if (heights) return heights;
  heights = new Map();
  try {
    const stored: unknown = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          isHeight(entry[1])
        ) {
          heights.set(entry[0], entry[1]);
        }
      }
    }
  } catch {
    // No storage, or nothing readable in it: the heights live in memory.
  }
  return heights;
};

const store = (map: Map<string, number>) => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...map]));
  } catch {
    // No storage, or it is full: the heights live in memory.
  }
};

const keysOf = ({ callId, serverId, uri, width }: ViewHeightKey) => ({
  call: callId === undefined ? undefined : JSON.stringify(["call", callId]),
  view:
    width === undefined
      ? undefined
      : JSON.stringify([
          "view",
          serverId,
          uri,
          Math.round(width / WIDTH_STEP_PX),
        ]),
});

/** The height the view had last time, if it is known. */
export const rememberedViewHeight = (
  key: ViewHeightKey,
): number | undefined => {
  const map = kept();
  const { call, view } = keysOf(key);
  return (
    (call === undefined ? undefined : map.get(call)) ??
    (view === undefined ? undefined : map.get(view))
  );
};

/** Keeps `height` as the one the view had. */
export const rememberViewHeight = (key: ViewHeightKey, height: number) => {
  if (!isHeight(height)) return;
  const map = kept();
  const keys = Object.values(keysOf(key)).filter(
    (entry): entry is string => entry !== undefined,
  );
  if (keys.every((entry) => map.get(entry) === height)) return;
  for (const entry of keys) {
    // Last in the map's order, so the oldest go first.
    map.delete(entry);
    map.set(entry, height);
  }
  for (const oldest of map.keys()) {
    if (map.size <= MAX_ENTRIES) break;
    map.delete(oldest);
  }
  store(map);
};

/** Drops what is kept for the view, which did not show. */
export const forgetViewHeight = (key: ViewHeightKey) => {
  const map = kept();
  let changed = false;
  for (const entry of Object.values(keysOf(key))) {
    if (entry !== undefined) changed = map.delete(entry) || changed;
  }
  if (changed) store(map);
};

/** Reads the heights from session storage again, as a reload would; for tests. */
export const resetViewHeights = () => {
  heights = undefined;
};
