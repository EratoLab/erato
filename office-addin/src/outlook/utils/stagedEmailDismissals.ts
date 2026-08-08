export interface StagedEmailDismissals {
  bodyDismissed: boolean;
  attachmentIds: ReadonlySet<string>;
}

export type StagedEmailDismissalsMap = ReadonlyMap<
  string,
  StagedEmailDismissals
>;

const EMPTY_ATTACHMENTS: ReadonlySet<string> = new Set();

export function getDismissals(
  state: StagedEmailDismissalsMap,
  key: string,
): StagedEmailDismissals {
  return (
    state.get(key) ?? { bodyDismissed: false, attachmentIds: EMPTY_ATTACHMENTS }
  );
}

export function dismissBody(
  state: StagedEmailDismissalsMap,
  key: string,
): StagedEmailDismissalsMap {
  const existing = state.get(key);
  if (existing?.bodyDismissed) {
    return state;
  }
  const next = new Map(state);
  next.set(key, {
    bodyDismissed: true,
    attachmentIds: existing?.attachmentIds ?? EMPTY_ATTACHMENTS,
  });
  return next;
}

export function restoreBody(
  state: StagedEmailDismissalsMap,
  key: string,
): StagedEmailDismissalsMap {
  const existing = state.get(key);
  if (!existing?.bodyDismissed) {
    return state;
  }
  const next = new Map(state);
  if (existing.attachmentIds.size === 0) {
    next.delete(key);
  } else {
    next.set(key, {
      bodyDismissed: false,
      attachmentIds: existing.attachmentIds,
    });
  }
  return next;
}

export function dismissAttachment(
  state: StagedEmailDismissalsMap,
  key: string,
  attachmentId: string,
): StagedEmailDismissalsMap {
  const existing = state.get(key);
  if (existing?.attachmentIds.has(attachmentId)) {
    return state;
  }
  const nextAttachments = new Set(existing?.attachmentIds ?? []);
  nextAttachments.add(attachmentId);
  const next = new Map(state);
  next.set(key, {
    bodyDismissed: existing?.bodyDismissed ?? false,
    attachmentIds: nextAttachments,
  });
  return next;
}

export function restoreAttachment(
  state: StagedEmailDismissalsMap,
  key: string,
  attachmentId: string,
): StagedEmailDismissalsMap {
  const existing = state.get(key);
  if (!existing?.attachmentIds.has(attachmentId)) {
    return state;
  }
  const nextAttachments = new Set(existing.attachmentIds);
  nextAttachments.delete(attachmentId);
  const next = new Map(state);
  if (!existing.bodyDismissed && nextAttachments.size === 0) {
    next.delete(key);
  } else {
    next.set(key, {
      bodyDismissed: existing.bodyDismissed,
      attachmentIds: nextAttachments,
    });
  }
  return next;
}
