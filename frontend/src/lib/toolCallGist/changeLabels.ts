import { plural, t } from "@lingui/core/macro";

import { listReplaceIsUnknown } from "./change";

import type {
  ChangeBatch,
  ChangeBatchField,
  ChangeBatchRow,
  ChangeCounts,
  ChangeLayout,
  ChangeRecipients,
  ChangeValue,
  GistChange,
} from "./change";
import type { GistAction } from "./gist";
import type {
  ToolCallAction,
  ToolCallChangeNote,
  ToolCallOpaqueKind,
  ToolCallRecipientKind,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The words of a change card. Kept under `lib/` so the component registry
 * does not put them on the kit surface.
 */

const joinParts = (parts: readonly string[]) => parts.join(", ");

const countParts = (
  counts: ChangeCounts,
  texts: number,
  listsMaybeReplaced: boolean,
): string[] =>
  [
    counts.emptied > 0
      ? t({
          id: "toolChange.count.emptied",
          message: plural(counts.emptied, {
            one: "# emptied",
            other: "# emptied",
          }),
        })
      : undefined,
    counts.listReplaced > 0
      ? listsMaybeReplaced
        ? t({
            id: "toolChange.count.listMaybeReplaced",
            message: plural(counts.listReplaced, {
              one: "# list maybe replaced",
              other: "# lists maybe replaced",
            }),
          })
        : t({
            id: "toolChange.count.listReplaced",
            message: plural(counts.listReplaced, {
              one: "# list replaced",
              other: "# lists replaced",
            }),
          })
      : undefined,
    counts.listRemoved > 0
      ? t({
          id: "toolChange.count.listRemoved",
          message: plural(counts.listRemoved, {
            one: "# with items removed",
            other: "# with items removed",
          }),
        })
      : undefined,
    counts.changed > 0
      ? t({
          id: "toolChange.count.changed",
          message: plural(counts.changed, {
            one: "# changed",
            other: "# changed",
          }),
        })
      : undefined,
    counts.listAdded > 0
      ? t({
          id: "toolChange.count.listAdded",
          message: plural(counts.listAdded, {
            one: "# with items added",
            other: "# with items added",
          }),
        })
      : undefined,
    counts.set > 0
      ? t({
          id: "toolChange.count.set",
          message: plural(counts.set, { one: "# set", other: "# set" }),
        })
      : undefined,
    counts.unreadable > 0
      ? t({
          id: "toolChange.count.unreadable",
          message: plural(counts.unreadable, {
            one: "# not readable",
            other: "# not readable",
          }),
        })
      : undefined,
    texts > 0
      ? t({
          id: "toolChange.count.text",
          message: plural(texts, { one: "# text", other: "# texts" }),
        })
      : undefined,
  ].flatMap((part) => (part === undefined ? [] : [part]));

const changingOf = (counts: ChangeCounts, texts: number) =>
  counts.emptied +
  counts.listReplaced +
  counts.listRemoved +
  counts.listAdded +
  counts.changed +
  counts.set +
  counts.unreadable +
  texts;

/** A verb that writes over what is there: only there can old values and losses be told. */
const changesValuesInPlace = (action: GistAction | undefined): boolean =>
  action === undefined || action === "update" || action === "upsert";

/**
 * The line that says how many values do what, such as "30 fields change: 3
 * emptied, 5 changed, 22 set", only where it says what the rows below do
 * not: changes behind See more. Values that stay the same are always behind
 * See more, whose label counts them. A create's count states what every
 * create does, and the values of a run, a send or a share are no record's
 * fields, so they get none.
 */
export const changeSummaryLine = (
  change: GistChange,
  layout: ChangeLayout,
  action?: GistAction,
): string | undefined => {
  const { counts } = change;
  const texts = change.texts.length;
  const changing = changingOf(counts, texts);
  const parts = countParts(counts, texts, listReplaceIsUnknown(change));
  if (changing < 2 || !changesValuesInPlace(action)) return undefined;
  const hidden =
    layout.collapsed.filter((effect) => effect.effect !== "unchanged").length +
    layout.beyondCap;
  if (hidden === 0) return undefined;
  const head = t({
    id: "toolChange.summary.fields",
    message: plural(changing, {
      one: "# field changes",
      other: "# fields change",
    }),
  });
  return parts.length > 1 ? `${head}: ${joinParts(parts)}` : head;
};

/** The same counts for a trace row, past tense: "3 changed, 10 unchanged". */
export const changeRowCounts = (change: GistChange): string | undefined => {
  const parts = countParts(
    change.counts,
    change.texts.length,
    listReplaceIsUnknown(change),
  );
  if (change.counts.unchanged > 0) {
    parts.push(
      t({
        id: "toolChange.count.unchanged",
        message: plural(change.counts.unchanged, {
          one: "# unchanged",
          other: "# unchanged",
        }),
      }),
    );
  }
  return parts.length > 0 ? joinParts(parts) : undefined;
};

/**
 * The truthful line that opens a collapsed part of a card, from the counts of
 * what is behind it. "None is emptied" needs the whole call read and every
 * loss already on the card.
 */
export const changeSeeMoreLine = (
  change: GistChange,
  layout: ChangeLayout,
  action?: GistAction,
): string => {
  const { counts } = change;
  const total = layout.collapsed.length + layout.beyondCap;
  const behind = (
    kind: "changed" | "set" | "unchanged" | "list_added",
    count: number,
  ) =>
    count - layout.firstRows.filter((effect) => effect.effect === kind).length;
  const changed = behind("changed", counts.changed);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
  const added = behind("list_added", counts.listAdded);
  const set = behind("set", counts.set);
  const unchanged = behind("unchanged", counts.unchanged);
  const losses =
    counts.emptied -
    layout.emptied.length +
    counts.listReplaced -
    layout.lists.length +
    counts.listRemoved -
    layout.removedFromLists.length +
    counts.unreadable -
    layout.unreadable.length;
  const noLoss = change.complete && losses <= 0;
  if (unchanged === total) {
    return t({
      id: "toolChange.seeMore.unchanged",
      message: plural(total, {
        one: "See # unchanged field",
        other: "See # unchanged fields",
      }),
    });
  }
  // A new record has no old values to know and nothing to empty.
  if (set === total && noLoss && !changesValuesInPlace(action)) {
    return t({
      id: "toolChange.seeMore.setOnNew",
      message: plural(total, {
        one: "See # more field",
        other: "See # more fields",
      }),
    });
  }
  if (set === total && noLoss) {
    return t({
      id: "toolChange.seeMore.allSet",
      message: plural(total, {
        one: "See # more field, set with the old value unknown (none is emptied)",
        other:
          "See # more fields, all set with the old value unknown (none is emptied)",
      }),
    });
  }
  const parts = [
    losses > 0
      ? t({
          id: "toolChange.seeMore.part.losses",
          message: plural(losses, {
            one: "# emptied or replaced",
            other: "# emptied or replaced",
          }),
        })
      : undefined,
    changed > 0
      ? t({
          id: "toolChange.seeMore.part.changed",
          message: plural(changed, { one: "# changed", other: "# changed" }),
        })
      : undefined,
    added > 0
      ? t({
          id: "toolChange.seeMore.part.added",
          message: plural(added, {
            one: "# with items added",
            other: "# with items added",
          }),
        })
      : undefined,
    set > 0
      ? t({
          id: "toolChange.seeMore.part.set",
          message: plural(set, { one: "# set", other: "# set" }),
        })
      : undefined,
    unchanged > 0
      ? t({
          id: "toolChange.seeMore.part.unchanged",
          message: plural(unchanged, {
            one: "# unchanged",
            other: "# unchanged",
          }),
        })
      : undefined,
  ].flatMap((part) => (part === undefined ? [] : [part]));
  const detail = joinParts(parts);
  return noLoss
    ? t({
        id: "toolChange.seeMore.mixed",
        message: plural(total, {
          one: `See # more field: ${detail} (none is emptied)`,
          other: `See # more fields: ${detail} (none is emptied)`,
        }),
      })
    : t({
        id: "toolChange.seeMore.counts",
        message: plural(total, {
          one: `See # more field: ${detail}`,
          other: `See # more fields: ${detail}`,
        }),
      });
};

/** Under a See more line, for values counted but not stored. */
export const fieldsInDetails = (count: number): string =>
  t({
    id: "toolChange.seeMore.inDetails",
    message: plural(count, {
      one: "The other # field is in Technical details.",
      other: "The other # fields are in Technical details.",
    }),
  });

/** The first-view warning on a description that could not read everything. */
export const incompleteLines = (change: GistChange): string[] => {
  const conditions = change.filter?.omitted ?? 0;
  const statements = change.opaqueOmitted;
  const texts = change.textsOmitted;
  const counted = [
    conditions > 0
      ? t({
          id: "toolChange.incomplete.conditions",
          message: plural(conditions, {
            one: "# condition",
            other: "# conditions",
          }),
        })
      : undefined,
    statements > 0
      ? t({
          id: "toolChange.incomplete.statements",
          message: plural(statements, {
            one: "# statement",
            other: "# statements",
          }),
        })
      : undefined,
    texts > 0
      ? t({
          id: "toolChange.incomplete.texts",
          message: plural(texts, { one: "# text", other: "# texts" }),
        })
      : undefined,
  ].flatMap((part) => (part === undefined ? [] : [part]));
  const notShown = joinParts(counted);
  return [
    t({
      id: "toolChange.incomplete",
      message:
        "This call is too large to read in full, so it may do more than the card says. Technical details has the whole call.",
    }),
    ...(counted.length > 0
      ? [
          t({
            id: "toolChange.incomplete.notShown",
            message: `Not shown here: ${notShown}.`,
          }),
        ]
      : []),
  ];
};

/** A See more line with the names of the fields it holds, so its label says what is inside. */
export const seeMoreWithNames = (
  line: string,
  names: string,
  more: number,
): string =>
  names.length === 0
    ? line
    : more > 0
      ? t({
          id: "toolChange.seeMore.namedMore",
          message: `${line} · ${names} +${more}`,
        })
      : t({ id: "toolChange.seeMore.named", message: `${line} · ${names}` });

export const machineIdPhrase = (): string =>
  t({ id: "toolChange.value.anId", message: "an ID (see Technical details)" });

export const linkPhrase = (name: string | undefined): string =>
  name === undefined
    ? t({
        id: "toolChange.value.aLink",
        message: "a link (see Technical details)",
      })
    : t({ id: "toolChange.value.linkTo", message: `link to ${name}` });

/** Before a name a call gives a record nobody read, so it reads as a new value. */
export const newNamePhrase = (): string =>
  t({ id: "toolChange.value.newName", message: "set to" });

export const cutValuePhrase = (): string =>
  t({
    id: "toolChange.value.cut",
    message: "cut here (see Technical details)",
  });

export const emptyValuePhrase = (): string =>
  t({ id: "toolChange.value.empty", message: "(empty)" });

export const emptiedLabel = (): string =>
  t({ id: "toolChange.row.emptied", message: "Emptied" });

export const emptiedWasLabel = (name: string, was: string): string =>
  t({ id: "toolChange.row.emptiedWas", message: `${name} (was ${was})` });

export const beingEmptiedLabel = (name: string): string =>
  t({ id: "toolChange.row.beingEmptied", message: `${name} is emptied` });

export const listRemovedLabel = (name: string): string =>
  t({ id: "toolChange.list.removed", message: `${name} removed` });

export const listWouldGoLabel = (name: string): string =>
  t({ id: "toolChange.list.wouldGo", message: `${name} that would go` });

export const listWouldStayLabel = (name: string): string =>
  t({ id: "toolChange.list.wouldStay", message: `${name} that would stay` });

export const listKeptLabel = (name: string): string =>
  t({ id: "toolChange.list.kept", message: `${name} kept` });

export const listAddedLabel = (name: string): string =>
  t({ id: "toolChange.list.added", message: `${name} added` });

export const listSetLabel = (name: string): string =>
  t({ id: "toolChange.list.setTo", message: `${name} set to` });

export const listAddsClaim = (): string =>
  t({
    id: "toolChange.list.addsClaim",
    message: "Only added, the tool says",
  });

export const listRemovesClaim = (): string =>
  t({
    id: "toolChange.list.removesClaim",
    message: "Only removed, the tool says",
  });

/** Under a trace row, the values the card could not read. */
export const unreadableLabel = (): string =>
  t({ id: "toolChange.row.unreadable", message: "Not readable" });

export const recipientKindWord = (kind: ToolCallRecipientKind): string => {
  switch (kind) {
    case "cc":
      return t({ id: "toolChange.recipients.kind.cc", message: "Cc" });
    case "bcc":
      return t({ id: "toolChange.recipients.kind.bcc", message: "Bcc" });
    default:
      return t({ id: "toolChange.recipients.kind.to", message: "To" });
  }
};

export const recipientsLine = (recipients: ChangeRecipients): string => {
  const groups =
    recipients.groups.length > 1
      ? `: ${joinParts(
          recipients.groups.map(
            (group) => `${group.count} ${recipientKindWord(group.kind)}`,
          ),
        )}`
      : "";
  return t({
    id: "toolChange.recipients.total",
    message: plural(recipients.total, {
      one: `To # address${groups}`,
      other: `To # addresses${groups}`,
    }),
  });
};

/** Beside an address the organisation does not own. */
export const outsideBadgeLabel = (): string =>
  t({
    id: "toolChange.recipients.outsideBadge",
    message: "outside your organisation",
  });

/** Before the people a share gives access to. */
export const shareWithLabel = (): string =>
  t({ id: "toolChange.recipients.with", message: "With" });

export const recipientsSeeAll = (total: number): string =>
  t({
    id: "toolChange.recipients.seeAll",
    message: plural(total, {
      one: "See the # address",
      other: "See all # addresses",
    }),
  });

export const outsideLine = (recipients: ChangeRecipients): string => {
  const names = joinParts(recipients.outside);
  const count = recipients.outside.length + recipients.outsideOmitted;
  const more =
    recipients.outsideOmitted > 0 ? `, +${recipients.outsideOmitted}` : "";
  return t({
    id: "toolChange.recipients.outside",
    message: plural(count, {
      one: `# address is outside your organisation: ${names}${more}`,
      other: `# addresses are outside your organisation: ${names}${more}`,
    }),
  });
};

export const uncheckedLine = (unchecked: number): string =>
  t({
    id: "toolChange.recipients.unchecked",
    message: plural(unchecked, {
      one: "# recipient has no address that can be checked",
      other: "# recipients have no address that can be checked",
    }),
  });

export const everyRecordLine = (): string =>
  t({
    id: "toolChange.filter.everyRecord",
    message: "This applies to every record: the filter is empty.",
  });

export const filterLabel = (): string =>
  t({ id: "toolChange.filter.where", message: "Where" });

export const filterEmptyPart = (name: string): string =>
  t({ id: "toolChange.filter.isEmpty", message: `${name} is empty` });

/** Only options the call turns on are listed, so the label says so. */
export const flagsLabel = (): string =>
  t({ id: "toolChange.flags", message: "Turned on" });

/**
 * Before the tool's own name for the call, where the card can only call
 * what it acts on an "item"; the name is the tool's word, never Erato's.
 */
export const toolTitleLabel = (): string =>
  t({ id: "toolChange.toolTitle", message: "The tool calls this" });

export const dryRunLabel = (name: string): string =>
  t({ id: "toolChange.flag.dryRun", message: `Dry run (${name})` });

const opaqueKindWord = (kind: ToolCallOpaqueKind): string => {
  switch (kind) {
    case "sql":
      return t({ id: "toolChange.opaque.sql", message: "SQL" });
    case "shell":
      return t({ id: "toolChange.opaque.shell", message: "command" });
    case "code":
      return t({ id: "toolChange.opaque.code", message: "code" });
    case "instruction":
      return t({
        id: "toolChange.opaque.instruction",
        message: "instruction",
      });
  }
};

export const foundLine = (
  kind: ToolCallOpaqueKind,
  found: readonly string[],
): string => {
  const what = opaqueKindWord(kind);
  const words = joinParts(found);
  return t({
    id: "toolChange.opaque.found",
    message: `Found in this ${what}: ${words}.`,
  });
};

export const writeInsideReadLine = (): string =>
  t({
    id: "toolChange.opaque.writeInsideRead",
    message: "It sits inside a statement that opens like a read.",
  });

export const opaqueCutLine = (): string =>
  t({
    id: "toolChange.opaque.cut",
    message: "Only the start is shown here. Technical details has the rest.",
  });

/** Size is only worth a heading on text too long to take in at a glance. */
const LONG_TEXT_LINES = 3;
const LONG_TEXT_CHARS = 240;

export const textHeading = (
  name: string,
  lines: number,
  chars: number,
  replaced: boolean,
): string => {
  if (lines <= LONG_TEXT_LINES && chars < LONG_TEXT_CHARS) {
    return replaced
      ? t({ id: "toolChange.text.replacedShort", message: `${name} replaced` })
      : name;
  }
  const size = chars.toLocaleString();
  return replaced
    ? t({
        id: "toolChange.text.replaced",
        message: plural(lines, {
          one: `${name} replaced by # line, ${size} characters`,
          other: `${name} replaced by # lines, ${size} characters`,
        }),
      })
    : t({
        id: "toolChange.text.size",
        message: plural(lines, {
          one: `${name}: # line, ${size} characters`,
          other: `${name}: # lines, ${size} characters`,
        }),
      });
};

export const textSeeAll = (hiddenLines: number): string =>
  t({
    id: "toolChange.text.seeAll",
    message: plural(hiddenLines, {
      one: "See the full text (+# line)",
      other: "See the full text (+# lines)",
    }),
  });

export const textOldLabel = (): string =>
  t({ id: "toolChange.text.old", message: "Text it replaces" });

export const batchSameLine = (): string =>
  t({
    id: "toolChange.batch.same",
    message: "Every row changes the same way",
  });

export const batchDifferentLine = (): string =>
  t({ id: "toolChange.batch.different", message: "Each row is different." });

/**
 * Whether any row loses something, or a statement that none does. Where only
 * the tool says its lists are added to, that statement would be the tool's.
 */
export const batchLossLines = (
  batch: ChangeBatch,
  listsMaybeReplaced = false,
  toolSaysOnlyAdds = false,
  /** Every row is in view and says what it empties or removes itself. */
  rowsInView = false,
): string[] => {
  const lines: string[] = [];
  if (batch.rowsEmptying > 0 && !rowsInView) {
    const emptying = batch.rowsEmptying;
    lines.push(
      t({
        id: "toolChange.batch.losses.emptying",
        message: plural(emptying, {
          one: "# row empties a field",
          other: "# rows empty a field",
        }),
      }),
    );
  }
  if (batch.rowsReplacingLists > 0) {
    const replacing = batch.rowsReplacingLists;
    lines.push(
      listsMaybeReplaced
        ? t({
            id: "toolChange.batch.losses.listsMaybe",
            message: plural(replacing, {
              one: "# row may replace a list",
              other: "# rows may replace a list",
            }),
          })
        : t({
            id: "toolChange.batch.losses.lists",
            message: plural(replacing, {
              one: "# row replaces a list",
              other: "# rows replace a list",
            }),
          }),
    );
  }
  if (batch.rowsRemovingFromLists > 0 && !rowsInView) {
    const removing = batch.rowsRemovingFromLists;
    lines.push(
      t({
        id: "toolChange.batch.losses.removing",
        message: plural(removing, {
          one: "# row removes items from a list, the tool says",
          other: "# rows remove items from a list, the tool says",
        }),
      }),
    );
  }
  if (
    batch.rowsEmptying === 0 &&
    batch.rowsReplacingLists === 0 &&
    batch.rowsRemovingFromLists === 0 &&
    batch.deletions === 0 &&
    batch.readAll &&
    !toolSaysOnlyAdds
  ) {
    lines.push(
      t({
        id: "toolChange.batch.losses.none",
        message: "No row deletes or empties anything.",
      }),
    );
  }
  return lines;
};

/** What one field does across a batch's rows, in the first view. */
export const batchFieldLine = (
  field: ChangeBatchField,
  total: number,
  listsMaybeReplaced = false,
): string => {
  const { emptied, listsRemoved: removed, listsAdded: added } = field;
  const replaced = field.listsReplaced;
  const scopeOf = (rows: number) =>
    rows === total
      ? t({
          id: "toolChange.batch.scope.all",
          message: plural(rows, { one: "on # row", other: "on all # rows" }),
        })
      : t({
          id: "toolChange.batch.scope.some",
          message: `on ${rows} of ${total} rows`,
        });
  if (emptied === field.rows) {
    const scope = scopeOf(field.rows);
    return t({
      id: "toolChange.batch.field.allEmptied",
      message: `Emptied ${scope}`,
    });
  }
  const written = field.rows - emptied - replaced - removed - added;
  const samples = field.samples.map(plainChangeValue).join(", ");
  // The values are what is removed or added only when no row writes one and
  // every row holds the same ones.
  const named =
    written === 0 &&
    emptied === 0 &&
    samples.length > 0 &&
    field.distinct === 1 &&
    !field.distinctCapped;
  const distinct = field.distinct;
  const parts: string[] = [];
  if (written > 0) {
    const scope = scopeOf(written);
    if (field.distinctCapped) {
      parts.push(
        t({
          id: "toolChange.batch.field.many",
          message: `Many different values ${scope}: ${samples}`,
        }),
      );
    } else if (distinct > 1) {
      parts.push(
        t({
          id: "toolChange.batch.field.distinct",
          message: `${distinct} different values ${scope}: ${samples}`,
        }),
      );
    } else if (samples.length > 0) {
      parts.push(
        t({
          id: "toolChange.batch.field.setTo",
          message: `Set to ${samples} ${scope}`,
        }),
      );
    } else {
      parts.push(
        t({ id: "toolChange.batch.field.set", message: `Set ${scope}` }),
      );
    }
  }
  if (emptied > 0) {
    parts.push(
      t({
        id: "toolChange.batch.field.emptied",
        message: plural(emptied, {
          one: "emptied on # row",
          other: "emptied on # rows",
        }),
      }),
    );
  }
  if (removed > 0) {
    const scope = scopeOf(removed);
    parts.push(
      named && added === 0 && replaced === 0
        ? t({
            id: "toolChange.batch.field.removedValues",
            message: `${samples} removed ${scope}, the tool says`,
          })
        : t({
            id: "toolChange.batch.field.removed",
            message: plural(removed, {
              one: "items removed on # row, the tool says",
              other: "items removed on # rows, the tool says",
            }),
          }),
    );
  }
  if (added > 0) {
    const scope = scopeOf(added);
    parts.push(
      named && removed === 0 && replaced === 0
        ? t({
            id: "toolChange.batch.field.addedValues",
            message: `${samples} added ${scope}, the tool says`,
          })
        : t({
            id: "toolChange.batch.field.added",
            message: plural(added, {
              one: "items added on # row, the tool says",
              other: "items added on # rows, the tool says",
            }),
          }),
    );
  }
  if (replaced > 0) {
    parts.push(
      listsMaybeReplaced
        ? t({
            id: "toolChange.batch.field.listsMaybe",
            message: plural(replaced, {
              one: "list may be replaced on # row",
              other: "list may be replaced on # rows",
            }),
          })
        : t({
            id: "toolChange.batch.field.lists",
            message: plural(replaced, {
              one: "list replaced on # row",
              other: "list replaced on # rows",
            }),
          }),
    );
  }
  return parts.join(" · ");
};

export const batchFieldsMore = (more: number): string =>
  t({
    id: "toolChange.batch.fieldsMore",
    message: plural(more, { one: "+# more field", other: "+# more fields" }),
  });

const operationWord = (action: ToolCallAction, count: number): string => {
  switch (action) {
    case "create":
      return t({
        id: "toolChange.batch.op.create",
        message: plural(count, { one: "# create", other: "# create" }),
      });
    case "update":
      return t({
        id: "toolChange.batch.op.update",
        message: plural(count, { one: "# update", other: "# update" }),
      });
    case "delete":
      return t({
        id: "toolChange.batch.op.delete",
        message: plural(count, { one: "# delete", other: "# delete" }),
      });
    case "move":
      return t({
        id: "toolChange.batch.op.move",
        message: plural(count, { one: "# move", other: "# move" }),
      });
    case "send":
      return t({
        id: "toolChange.batch.op.send",
        message: plural(count, { one: "# send", other: "# send" }),
      });
    case "comment":
      return t({
        id: "toolChange.batch.op.comment",
        message: plural(count, { one: "# comment", other: "# comment" }),
      });
    case "share":
      return t({
        id: "toolChange.batch.op.share",
        message: plural(count, { one: "# share", other: "# share" }),
      });
    case "run":
      return t({
        id: "toolChange.batch.op.run",
        message: plural(count, { one: "# run", other: "# run" }),
      });
    case "upsert":
      return t({
        id: "toolChange.batch.op.upsert",
        message: plural(count, {
          one: "# create or update",
          other: "# create or update",
        }),
      });
    case "archive":
      return t({
        id: "toolChange.batch.op.archive",
        message: plural(count, { one: "# archive", other: "# archive" }),
      });
    case "upload":
      return t({
        id: "toolChange.batch.op.upload",
        message: plural(count, { one: "# upload", other: "# upload" }),
      });
    default:
      return t({
        id: "toolChange.batch.op.other",
        message: plural(count, { one: "# other", other: "# other" }),
      });
  }
};

/**
 * A batch's operations in the order its rows read: deletes first, as what is
 * lost, and creates last.
 */
export const batchOperationsLine = (batch: ChangeBatch): string => {
  const rank = (action: ToolCallAction) =>
    action === "delete" ? 0 : action === "create" ? 2 : 1;
  const ordered = batch.operations
    .map((operation, index) => ({ operation, index }))
    .sort(
      (a, b) =>
        rank(a.operation.action) - rank(b.operation.action) ||
        a.index - b.index,
    )
    .map(({ operation }) => operation);
  const parts = joinParts(
    ordered.map(({ action, count }) => operationWord(action, count)),
  );
  return t({
    id: "toolChange.batch.operations",
    message: plural(batch.total, {
      one: `# operation in one call: ${parts}`,
      other: `# operations in one call: ${parts}`,
    }),
  });
};

export const batchDeletionsLine = (
  deletions: number,
  names: readonly string[],
): string => {
  const listed = joinParts(names);
  return names.length > 0
    ? t({
        id: "toolChange.batch.deletionsNamed",
        message: plural(deletions, {
          one: `# deletion: ${listed}`,
          other: `# deletions: ${listed}`,
        }),
      })
    : t({
        id: "toolChange.batch.deletions",
        message: plural(deletions, {
          one: "# deletion",
          other: "# deletions",
        }),
      });
};

export const batchRowLabel = (row: ChangeBatchRow): string => {
  const { number } = row;
  return (
    row.name ?? t({ id: "toolChange.batch.row", message: `Row ${number}` })
  );
};

export const batchSeeMore = (more: number): string =>
  t({
    id: "toolChange.batch.seeMore",
    message: plural(more, {
      one: "See # more row",
      other: "See # more rows",
    }),
  });

export const batchRestInDetails = (rest: number): string =>
  t({
    id: "toolChange.batch.rest",
    message: plural(rest, {
      one: "The other # row is in Technical details.",
      other: "The other # rows are in Technical details.",
    }),
  });

export const changeNoteLabel = (note: ToolCallChangeNote): string => {
  switch (note) {
    case "marked_destructive":
      return t({
        id: "toolChange.note.markedDestructive",
        message: "The tool marks this as destructive.",
      });
    case "operator_marked_destructive":
      return t({
        id: "toolChange.note.operatorMarkedDestructive",
        message: "Your organisation has marked this tool as destructive.",
      });
    case "delete_outcome_unknown":
      return t({
        id: "toolChange.note.deleteOutcomeUnknown",
        message:
          "What else goes with it, and whether it can be restored, is not known.",
      });
    case "tool_says_permanent":
      return t({
        id: "toolChange.note.toolSaysPermanent",
        message: "The tool says this cannot be undone.",
      });
    case "tool_says_restorable":
      return t({
        id: "toolChange.note.toolSaysRestorable",
        message: "The tool says this can be restored.",
      });
    case "tool_says_replaces_list":
      return t({
        id: "toolChange.note.toolSaysReplacesList",
        message: "The tool says it replaces the current list.",
      });
    case "tool_says_adds_to_list":
      return t({
        id: "toolChange.note.toolSaysAddsToList",
        message: "The tool says it only adds to the list.",
      });
    case "list_replace_unknown":
      return t({
        id: "toolChange.note.listReplaceUnknown",
        message:
          "Whether this replaces the current list or adds to it is not known.",
      });
    case "tool_says_ignored_if_missing":
      return t({
        id: "toolChange.note.toolSaysIgnoredIfMissing",
        message:
          "The tool says it ignores this silently if the record does not exist.",
      });
    case "row_count_unknown":
      return t({
        id: "toolChange.note.rowCountUnknown",
        message: "Erato cannot tell how many rows this touches.",
      });
    case "instruction_outcome_unknown":
      return t({
        id: "toolChange.note.instructionOutcomeUnknown",
        message:
          "Erato does not ask you about the steps the tool takes with this text and cannot tell what will change.",
      });
    case "old_values_from_earlier":
      return t({
        id: "toolChange.note.oldValuesFromEarlier",
        message:
          "Old values are from earlier in this chat and may have changed.",
      });
    case "nothing_changes":
      return t({
        id: "toolChange.note.nothingChanges",
        message:
          "Every value equals what was read earlier in this chat, so nothing seems to change.",
      });
    default:
      return "";
  }
};

/**
 * The footnote that says where underlined and old values come from, or
 * nothing when the card shows neither.
 */
export const earlierValuesFootnote = (
  dotted: boolean,
  old: boolean,
): string | undefined => {
  if (dotted && old) {
    return t({
      id: "toolChange.note.dottedAndOld",
      message:
        "Dotted and old values are from earlier in this chat and may have changed.",
    });
  }
  if (dotted) {
    return t({
      id: "toolChange.note.dotted",
      message:
        "Dotted values are from earlier in this chat and may have changed.",
    });
  }
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
  return old ? changeNoteLabel("old_values_from_earlier") : undefined;
};

/** Stand-ins a coded value's frame is split at, so each part gets its own colour. */
export const CODE_SLOT = "\uE003";
export const MEANING_SLOT = "\uE004";
export const CODED_SLOTS = /([\uE003\uE004])/;

/**
 * The words around a coded value and the tool's meaning, with the two in
 * slots, as `codedValueText` reads in the language shown.
 */
export const codedValueFrame = (value: ChangeValue): string | undefined =>
  value.meaning === undefined
    ? undefined
    : codedValueText({
        ...value,
        text: CODE_SLOT,
        meaning: { ...value.meaning, label: MEANING_SLOT },
      });

/**
 * A coded value with its meaning: for the operator's glossary the label first
 * and the value as written beside it; for a meaning the tool's schema or an
 * earlier result of it gives, the value and the tool's claim.
 */
export const codedValueText = (value: ChangeValue): string => {
  const { text, meaning } = value;
  if (meaning === undefined) return text;
  const label = meaning.label;
  return meaning.source === "glossary"
    ? t({ id: "toolChange.value.meaning", message: `${label} (${text})` })
    : t({
        id: "toolChange.value.toolSaysMeaning",
        message: `${text} (the tool says: ${label})`,
      });
};

/** A value as plain text, for a trace row's one-line summary. */
export const plainChangeValue = (value: ChangeValue): string =>
  value.machineId && value.text.length === 0
    ? machineIdPhrase()
    : codedValueText(value);
