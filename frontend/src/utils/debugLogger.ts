/**
 * Debug logger utility for conditional logging
 * Only logs in development and when debug is enabled through localStorage
 */

// Debug categories
type DebugCategory =
  | "UI" // UI component rendering
  | "RENDER" // Render lifecycle
  | "API" // API calls
  | "STATE" // State changes
  | "HOOK" // Hook execution
  | "EVENT" // Event handling
  | "NETWORK" // Network activity
  | "ERROR" // Errors
  | "ALL"; // All categories

/**
 * Check if debug logging is enabled
 * Can be enabled with localStorage.setItem('DEBUG', 'true')
 * Or for specific categories: localStorage.setItem('DEBUG_CATEGORIES', 'UI,API,STATE')
 */
function isDebugEnabled(category: DebugCategory): boolean {
  // Check if we're in the browser environment
  if (typeof window === "undefined") return false;

  // Only log in development by default
  if (process.env.NODE_ENV !== "development") {
    // Allow explicit override in production with localStorage.DEBUG_FORCE
    if (localStorage.getItem("DEBUG_FORCE") !== "true") {
      return false;
    }
  }

  const isDebugModeOn = localStorage.getItem("DEBUG") === "true";
  if (!isDebugModeOn) return false;

  // Check for category filtering
  const debugCategories = localStorage.getItem("DEBUG_CATEGORIES");
  if (!debugCategories) return true; // If no categories specified, log all

  const categories = debugCategories.split(",");
  return categories.includes(category) || categories.includes("ALL");
}

/**
 * Debug log with category filtering
 */
export function debugLog(
  category: DebugCategory,
  message: string,
  data?: unknown,
): void {
  if (!isDebugEnabled(category)) return;

  const timestamp = new Date().toISOString().split("T")[1].replace("Z", "");
  const prefix = `[${timestamp}][${category}]`;

  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

/**
 * Time execution of a function with debug logging
 */
export function debugTime<T>(
  category: DebugCategory,
  label: string,
  fn: () => T,
): T {
  if (!isDebugEnabled(category)) {
    return fn();
  }

  console.time(`[${category}] ${label}`);
  const result = fn();
  console.timeEnd(`[${category}] ${label}`);
  return result;
}

/**
 * Create a logger instance for a specific component or module
 */
export function createLogger(
  defaultCategory: DebugCategory,
  componentName: string,
) {
  return {
    log: (message: string, data?: unknown) =>
      debugLog(defaultCategory, `[${componentName}] ${message}`, data),
    warn: (message: string, data?: unknown) => {
      const timestamp = new Date().toISOString().split("T")[1].replace("Z", "");
      const prefix = `[${timestamp}][${defaultCategory}][${componentName}]`;
      if (data !== undefined) {
        console.warn(`${prefix} ${message}`, data);
      } else {
        console.warn(`${prefix} ${message}`);
      }
    },
    error: (message: string, error?: unknown) => {
      const timestamp = new Date().toISOString().split("T")[1].replace("Z", "");
      const prefix = `[${timestamp}][${defaultCategory}][${componentName}]`;
      if (error !== undefined) {
        console.error(`${prefix} ${message}`, error);
      } else {
        console.error(`${prefix} ${message}`);
      }
    },
    time: <T>(label: string, fn: () => T) =>
      debugTime(defaultCategory, `[${componentName}] ${label}`, fn),
  };
}
