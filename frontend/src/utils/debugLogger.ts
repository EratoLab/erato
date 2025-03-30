// Debug logging utility for message streaming

// Enable/disable logging globally
const DEBUG_ENABLED = true;

// Enable specific categories
const ENABLED_CATEGORIES = {
  STREAM_STATE: true, // Track streaming state changes
  MESSAGE_UPDATE: true, // Track message updates
  RENDER: true, // Track component renders
  STREAMING_LIFECYCLE: true, // Track streaming lifecycle events
};

// Add timestamps to logs
const getTimeString = () => {
  const now = new Date();
  return `[${now.toISOString().split("T")[1].split(".")[0]}]`;
};

/**
 * Debug logger with categories
 */
export const debugLog = (
  category: keyof typeof ENABLED_CATEGORIES,
  message: string,
  data?: unknown,
) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!DEBUG_ENABLED || !ENABLED_CATEGORIES[category]) return;

  const prefix = `${getTimeString()} [${category}]`;

  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
};

/**
 * Specialized logger for tracking state transitions
 */
export const logStateTransition = (
  component: string,
  stateName: string,
  from: unknown,
  to: unknown,
) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!DEBUG_ENABLED) return;

  const prefix = `${getTimeString()} [STATE_TRANSITION]`;
  console.log(prefix, `${component} - ${stateName}:`, { from, to });
};
