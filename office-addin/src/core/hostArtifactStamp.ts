import type { HostArtifact, Message } from "@erato/frontend/library";

/** One assistant message as a host last stamped it, and what the stamp was built from. */
export interface HostArtifactStamp<M extends Message = Message> {
  readonly source: M;
  readonly inputs: readonly unknown[];
  readonly message: M;
}

const sameFields = (
  previous: object,
  next: object,
  isSame: (a: unknown, b: unknown) => boolean,
): boolean => {
  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const keys = Object.keys(previousRecord);
  return (
    keys.length === Object.keys(nextRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(nextRecord, key) &&
        isSame(previousRecord[key], nextRecord[key]),
    )
  );
};

const sameValueOrFields = (previous: unknown, next: unknown): boolean =>
  Object.is(previous, next) ||
  (typeof previous === "object" &&
    typeof next === "object" &&
    previous !== null &&
    next !== null &&
    sameFields(previous, next, Object.is));

/** Field by field, and one level into the arrays and objects a build makes anew each time. */
export const isSameHostArtifact = (
  previous: HostArtifact,
  next: HostArtifact,
): boolean =>
  previous === next || sameFields(previous, next, sameValueOrFields);

const sameInputs = (previous: readonly unknown[], next: readonly unknown[]) =>
  previous.length === next.length &&
  previous.every((input, index) => Object.is(input, next[index]));

/**
 * Stamps `source` with the artifact `build` makes from it and `inputs`.
 *
 * The message list re-renders a row whenever its message object changes, and
 * a streamed chunk rebuilds every host artifact, so the last stamp is kept
 * while its message and inputs are unchanged, and a rebuilt artifact equal to
 * the last one is kept too.
 */
export function stampHostArtifact<M extends Message>(
  last: HostArtifactStamp<M> | undefined,
  source: M,
  inputs: readonly unknown[],
  build: () => HostArtifact | undefined,
  stamp: (message: M, artifact: HostArtifact) => M,
): HostArtifactStamp<M> {
  if (last && last.source === source && sameInputs(last.inputs, inputs)) {
    return last;
  }
  const built = build();
  const lastArtifact = last ? last.message.hostArtifact : undefined;
  const artifact =
    built && lastArtifact && isSameHostArtifact(lastArtifact, built)
      ? lastArtifact
      : built;
  if (!artifact) return { source, inputs, message: source };
  const message =
    last && last.source === source && artifact === lastArtifact
      ? last.message
      : stamp(source, artifact);
  return { source, inputs, message };
}
