/**
 * Enough of a brief to tell two sub-tasks apart and choose by, not the whole of
 * it. One value for every surface that quotes a brief, so none of them shortens
 * it differently.
 */
export const TASK_BRIEF_PREVIEW_CHARS = 160;

/**
 * The brief a model wrote for a sub-task, read off a `delegate_task` call's
 * own arguments.
 *
 * Shared by the trace step and the approval cards: a task has no assistant
 * name standing in for it, so the brief is the only thing that says which task
 * is being reported on or decided, and the two surfaces must not shorten it
 * differently.
 */
export const taskBriefFromInput = (
  input: unknown,
  maxChars: number,
): string | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const task = (input as Record<string, unknown>).task;
  if (typeof task !== "string") {
    return undefined;
  }
  const text = task.trim();
  if (text.length === 0) {
    return undefined;
  }
  const characters = [...text];
  return characters.length > maxChars
    ? `${characters.slice(0, maxChars).join("")}…`
    : text;
};
