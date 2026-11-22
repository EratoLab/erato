// Polyfills first: `scheduler` reads the timers when it loads.
import "./polyfills";

import { approvalItem, loadCatalogs, resultRow } from "./toolCallCards";

import type { Messages } from "@lingui/core";

/** Filled in by the build with the messages the bundled code uses. */
declare const __ADAPTIVE_CARD_CATALOGS__: Record<string, Messages>;

loadCatalogs(__ADAPTIVE_CARD_CATALOGS__);

/** Every call takes and returns JSON text, so the host needs no object bridge. */
const overJson =
  <T, R>(render: (request: T) => R) =>
  (request: string): string =>
    JSON.stringify(render(JSON.parse(request) as T));

(globalThis as Record<string, unknown>).EratoAdaptiveCards = {
  version: 1,
  approvalItem: overJson(approvalItem),
  resultRow: overJson(resultRow),
};
