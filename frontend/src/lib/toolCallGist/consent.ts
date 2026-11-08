import { pointerSegments } from "./serverText";

/** Well-known members that hold what the model says the user decided, bare. */
const CONSENT_FLAGS = new Set(["hasuserapproved"]);
const MAX_CONSENT_MEMBER_CHARS = 32;

/**
 * A member that holds what the model says the user decided: `hasUserApproved`
 * in any letter case, with or without `_` or `-`. Only Erato's own approval
 * says that, so no card shows it as a fact. A name that only mentions consent
 * or approval, such as `marketing_consent` or `user_confirmed`, is data the
 * call writes. The backend rules' `is_consent_member`; the server's configured
 * approval argument never reaches the readable view.
 */
export const isConsentMember = (name: string): boolean => {
  if (name.length > MAX_CONSENT_MEMBER_CHARS) return false;
  const bare = name
    .replace(/[_-]/g, "")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return CONSENT_FLAGS.has(bare);
};

/** Whether any of the pointers sits at or below a consent member, whatever it holds. */
export const isConsentClaim = (...pointers: unknown[]): boolean =>
  pointers.some((pointer) => pointerSegments(pointer).some(isConsentMember));
