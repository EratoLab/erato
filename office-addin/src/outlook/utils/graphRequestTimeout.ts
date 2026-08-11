import { GraphTimeoutError } from "../../utils/graph/graphRequestTimeout";

export const OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS = 10_000;
export const OUTLOOK_GRAPH_THREAD_TIMEOUT_MS = 20_000;

export { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";
export { GraphTimeoutError as OutlookGraphTimeoutError };
