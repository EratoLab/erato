/**
 * Build the single `.eml` File for the current Outlook conversation thread —
 * the *actual* bytes that will be uploaded on send.
 *
 * This is the one source of truth for "the current-thread email file". The
 * provider memoizes the result and hands the SAME File to both the token
 * estimator (as a virtual file) and the upload/send path, so the estimate
 * measures exactly what is sent — no size-proxy placeholder, no divergence.
 *
 * Returns `null` when no message is included (every message dismissed), which
 * the caller treats as "no email body to send".
 *
 * Pure and synchronous (composes `buildThreadSynthInputs` + `synthesizeThreadEml`,
 * both synchronous), so it is safe to call inside a `useMemo`.
 *
 * Not byte-deterministic across calls: `synthesizeThreadEml` draws random MIME
 * boundaries, so the same thread synthesized twice yields different bytes. This
 * is fine for the estimate=send invariant (the provider memoizes one File and
 * hands that exact instance to both paths), but it means there is no stable
 * content hash for the thread — any cross-session dedup/cache keyed on the eml
 * bytes will not hit.
 */

import { buildThreadSynthInputs } from "./buildThreadSynthInputs";
import { synthesizeThreadEml } from "./synthesizeThreadEml";

import type { ParsedThread, ThreadMessage } from "./parsedThread";

export function buildThreadEmlFile(
  thread: ParsedThread,
  includedMessages: ThreadMessage[],
  dismissedAttachmentIds: ReadonlySet<string>,
): File | null {
  if (includedMessages.length === 0) return null;
  const messages = buildThreadSynthInputs(
    includedMessages,
    dismissedAttachmentIds,
    thread.incomplete,
  );
  return synthesizeThreadEml({
    subject: thread.subject,
    messages,
  });
}
