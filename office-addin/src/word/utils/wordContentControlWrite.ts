/** Stable native identities only; no Office proxies survive a rejected batch. */
export interface WordContentControlLock {
  readonly id: number;
  readonly parentId?: number;
  readonly depth: number;
  readonly cannotEdit: boolean;
  readonly cannotDelete: boolean;
}

export type WordContentControlLocks = readonly WordContentControlLock[];

export interface WordContentControlUnlockOptions {
  /** Save these records outside this Word.run before the first mutation. The
   * original full-file backup must already have been retained by the caller. */
  onLocksCaptured: (locks: WordContentControlLocks) => void;
  /** Called before any lock setter is queued, including a potentially failing
   * setter. The caller must now treat subsequent errors as interrupted writes. */
  onMutationStart: () => void;
}

interface NativeControl {
  control: Word.ContentControl;
  parentId?: number;
  cannotEdit: boolean;
  cannotDelete: boolean;
}

function rememberControl(
  controls: Map<number, NativeControl>,
  control: Word.ContentControl,
): void {
  if (
    !Number.isInteger(control.id) ||
    typeof control.cannotEdit !== "boolean" ||
    typeof control.cannotDelete !== "boolean"
  ) {
    throw new Error(
      "Word did not provide a complete content control identity.",
    );
  }
  if (!controls.has(control.id))
    controls.set(control.id, {
      control,
      cannotEdit: control.cannotEdit,
      cannotDelete: control.cannotDelete,
    });
}

function controlDepths(
  controls: Map<number, NativeControl>,
): Map<number, number> {
  const depths = new Map<number, number>();
  for (const id of controls.keys()) {
    const chain: number[] = [];
    const ancestors = new Set<number>();
    let current: number | undefined = id;
    while (current !== undefined && !depths.has(current)) {
      if (ancestors.has(current) || !controls.has(current))
        throw new Error("Word returned an invalid content control hierarchy.");
      ancestors.add(current);
      chain.push(current);
      current = controls.get(current)!.parentId;
    }
    let depth = current === undefined ? -1 : depths.get(current)!;
    for (const ancestor of chain.reverse()) depths.set(ancestor, ++depth);
  }
  return depths;
}

/** Temporarily remove ordinary content-control locks for an already authorized
 * full-file import. Never call this before retaining the exact original file.
 *
 * The document collection includes headers, footers and textboxes as well as the
 * body. Parents are discovered before writing, then unlocked outside-in: an
 * outer content lock can prevent changing an inner control's properties.
 *
 * This does not remove document Restrict Editing, rights management, passwords,
 * or other document protection. Office failures propagate unchanged.
 *
 * APIs: document.contentControls and lock flags, WordApi 1.1; safe parent lookup,
 * WordApi 1.3. https://learn.microsoft.com/javascript/api/word/word.contentcontrol
 * https://learn.microsoft.com/javascript/api/word/word.document
 */
export async function unlockWordContentControlsForImport(
  context: Word.RequestContext,
  options: WordContentControlUnlockOptions,
): Promise<WordContentControlLocks> {
  const collection = context.document.contentControls;
  collection.load("items/id,items/cannotEdit,items/cannotDelete");
  await context.sync();
  const controls = new Map<number, NativeControl>();
  for (const control of collection.items) rememberControl(controls, control);
  if (![...controls.values()].some((c) => c.cannotEdit || c.cannotDelete)) {
    const empty: WordContentControlLocks = Object.freeze([]);
    options.onLocksCaptured(empty);
    return empty;
  }

  // Some host collections omit a parent of a returned control. Follow those
  // native parent objects too instead of treating the child as a root.
  let pending = [...controls.entries()];
  while (pending.length) {
    const parents = pending.map(([id, item]) => {
      const parent = item.control.parentContentControlOrNullObject;
      parent.load("id,cannotEdit,cannotDelete");
      return { id, parent };
    });
    await context.sync();
    const discovered: number[] = [];
    for (const { id, parent } of parents) {
      if (parent.isNullObject) continue;
      const known = controls.has(parent.id);
      rememberControl(controls, parent);
      controls.get(id)!.parentId = parent.id;
      if (!known) discovered.push(parent.id);
    }
    pending = discovered.map((id) => [id, controls.get(id)!]);
  }
  const depths = controlDepths(controls);
  const locks: WordContentControlLocks = Object.freeze(
    [...controls.entries()]
      .filter(([, item]) => item.cannotEdit || item.cannotDelete)
      .map(([id, item]) =>
        Object.freeze({
          id,
          ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
          depth: depths.get(id)!,
          cannotEdit: item.cannotEdit,
          cannotDelete: item.cannotDelete,
        }),
      )
      .sort((a, b) => a.depth - b.depth || a.id - b.id),
  );
  options.onLocksCaptured(locks);
  options.onMutationStart();
  for (const depth of new Set(locks.map((item) => item.depth))) {
    const level = locks.filter((item) => item.depth === depth);
    for (const lock of level) {
      const control = controls.get(lock.id)!.control;
      if (lock.cannotEdit) control.cannotEdit = false;
      if (lock.cannotDelete) control.cannotDelete = false;
      control.load("cannotEdit,cannotDelete");
    }
    await context.sync();
    for (const lock of level) {
      const control = controls.get(lock.id)!.control;
      if (control.cannotEdit || control.cannotDelete)
        throw new Error("Word did not unlock a content control for import.");
    }
  }
  return locks;
}

interface WordControlRestoreHost {
  run<T>(callback: (context: Word.RequestContext) => Promise<T>): Promise<T>;
}

export interface WordContentControlRestoreResult {
  restored: number[];
  missing: number[];
  failed: number[];
}

/** Only use after a failed unlock/import. A successful import supplies its own
 * requested locks; restoring old flags then would undo the reviewed plan.
 *
 * Reacquire stable IDs in fresh contexts, inside-out, so relocking an outer
 * control cannot prevent recovery of its descendants. A missing/deleted control
 * is never recreated. The saved complete original remains authoritative when
 * any native write or this best-effort recovery is incomplete.
 */
export async function restoreWordContentControlLocks(
  host: WordControlRestoreHost,
  locks: WordContentControlLocks,
  options: { canRestore?: () => boolean } = {},
): Promise<WordContentControlRestoreResult> {
  const result: WordContentControlRestoreResult = {
    restored: [],
    missing: [],
    failed: [],
  };
  for (const lock of [...locks].sort(
    (a, b) => b.depth - a.depth || a.id - b.id,
  )) {
    try {
      const status = await host.run(async (context) => {
        if (options.canRestore && !options.canRestore()) return "failed";
        const control = context.document.contentControls.getByIdOrNullObject(
          lock.id,
        );
        control.load("id,cannotEdit,cannotDelete");
        await context.sync();
        if (control.isNullObject) return "missing";
        if (options.canRestore && !options.canRestore()) return "failed";
        const changeEdit = control.cannotEdit !== lock.cannotEdit;
        const changeDelete = control.cannotDelete !== lock.cannotDelete;
        if (changeEdit || changeDelete) {
          // Restoring cannotEdit last keeps this control editable while its
          // other original flag is re-established.
          if (changeDelete) control.cannotDelete = lock.cannotDelete;
          if (changeEdit) control.cannotEdit = lock.cannotEdit;
          control.load("cannotEdit,cannotDelete");
          await context.sync();
          if (
            control.cannotEdit !== lock.cannotEdit ||
            control.cannotDelete !== lock.cannotDelete
          )
            return "failed";
        }
        return "restored";
      });
      result[status].push(lock.id);
    } catch {
      result.failed.push(lock.id);
    }
  }
  return result;
}
