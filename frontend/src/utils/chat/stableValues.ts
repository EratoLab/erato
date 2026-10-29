import { useRef } from "react";

import type { ChatMessage } from "@/components/ui/MessageList/MessageList";

// A key missing on one side never matches an `undefined` value on the other,
// so `{ canEdit: true }` and `{ canEdit: true, isSharedDialog: undefined }` differ.
const shallowEqualBy = (
  previous: unknown,
  next: unknown,
  isSameValue: (key: string, previous: unknown, next: unknown) => boolean,
): boolean => {
  if (Object.is(previous, next)) return true;
  if (
    typeof previous !== "object" ||
    typeof next !== "object" ||
    previous === null ||
    next === null
  ) {
    return false;
  }
  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const keys = Object.keys(previousRecord);
  return (
    keys.length === Object.keys(nextRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(nextRecord, key) &&
        isSameValue(key, previousRecord[key], nextRecord[key]),
    )
  );
};

export const shallowEqual = (previous: unknown, next: unknown): boolean =>
  shallowEqualBy(previous, next, (_key, a, b) => Object.is(a, b));

// The chat providers rebuild every message object, and its `loading` object,
// on each streamed update even when nothing in it changed.
export const isSameMessage = (
  previous: ChatMessage,
  next: ChatMessage,
): boolean =>
  shallowEqualBy(
    previous,
    next,
    (key, a, b) => Object.is(a, b) || (key === "loading" && shallowEqual(a, b)),
  );

/** The previous value for as long as `isEqual` says nothing changed. */
export function useStableValue<T>(
  value: T,
  isEqual: (previous: T, next: T) => boolean = shallowEqual,
): T {
  const ref = useRef(value);
  if (!isEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}

/**
 * Keeps each entry's previous object while it is equal to the new one, and
 * the previous record while every entry is.
 */
export function useStableEntries<T>(
  record: Record<string, T>,
  isEqual: (previous: T, next: T) => boolean,
): Record<string, T> {
  const ref = useRef({ input: record, output: record });
  if (ref.current.input !== record) {
    const previous = ref.current.output;
    const keys = Object.keys(record);
    let changed = keys.length !== Object.keys(previous).length;
    const next: Record<string, T> = {};
    for (const key of keys) {
      const prior = previous[key];
      if (Object.hasOwn(previous, key) && isEqual(prior, record[key])) {
        next[key] = prior;
      } else {
        next[key] = record[key];
        changed = true;
      }
    }
    ref.current = { input: record, output: changed ? next : previous };
  }
  return ref.current.output;
}

/** Message objects that keep their identity while their content is unchanged. */
export function useStableChatMessages<T extends ChatMessage>(
  messages: Record<string, T>,
): Record<string, T> {
  return useStableEntries(messages, isSameMessage);
}
