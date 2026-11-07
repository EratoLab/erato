import { pointerSegments } from "./serverText";

/**
 * Consent flags such as `hasUserApproved: true` or `user_confirmed: "yes"`
 * say what the model claims the user decided; only Erato's own approval says
 * that, so no card shows them as a fact. The same test as the backend
 * rules' `is_consent`.
 */
export const isConsentMember = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.includes("consent") ||
    (lower.includes("user") &&
      ["approv", "confirm", "agree"].some((word) => lower.includes(word)))
  );
};

const YES_OR_NO = new Set(["true", "false", "yes", "no"]);
const MAX_YES_OR_NO_CHARS = 16;

export const isYesOrNo = (value: unknown): boolean =>
  typeof value === "boolean" ||
  (typeof value === "string" &&
    value.length <= MAX_YES_OR_NO_CHARS &&
    YES_OR_NO.has(value.trim().toLowerCase()));

/** Whether `value` is a yes or no under a consent member in any of the pointers. */
export const isConsentClaim = (
  value: unknown,
  ...pointers: unknown[]
): boolean =>
  isYesOrNo(value) &&
  pointers.some((pointer) => pointerSegments(pointer).some(isConsentMember));
