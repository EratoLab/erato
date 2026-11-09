import { plural, t } from "@lingui/core/macro";

import type {
  ChangeBatch,
  ChangeBatchField,
  ChangeBatchRow,
  ChangeCounts,
  ChangeEffect,
  ChangeRecipients,
  ChangeValue,
  GistChange,
} from "./change";
import type {
  ToolCallAction,
  ToolCallChangeNote,
  ToolCallOpaqueKind,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The words of a change card. Kept under `lib/` so the component registry
 * does not put them on the kit surface.
 */

const joinParts = (parts: readonly string[]) => parts.join(", ");

const countParts = (counts: ChangeCounts): string[] =>
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
      ? t({
          id: "toolChange.count.listReplaced",
          message: plural(counts.listReplaced, {
            one: "# list replaced",
            other: "# lists replaced",
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
  ].flatMap((part) => (part === undefined ? [] : [part]));

const changingOf = (counts: ChangeCounts) =>
  counts.emptied +
  counts.listReplaced +
  counts.changed +
  counts.set +
  counts.unreadable;

/**
 * The line that says how many values do what, such as "30 fields change: 3
 * emptied, 5 changed, 22 set". One value needs no such line: its row says it.
 */
export const changeSummaryLine = (change: GistChange): string | undefined => {
  const { counts } = change;
  const changing = changingOf(counts);
  const parts = countParts(counts);
  if (changing === 0 || (changing < 2 && counts.unchanged === 0)) {
    return undefined;
  }
  const head = t({
    id: "toolChange.summary.fields",
    message: plural(changing, {
      one: "# field changes",
      other: "# fields change",
    }),
  });
  const line = parts.length > 1 ? `${head}: ${joinParts(parts)}` : head;
  if (counts.unchanged === 0) return line;
  const stay = t({
    id: "toolChange.summary.staySame",
    message: plural(counts.unchanged, {
      one: "# stays the same",
      other: "# stay the same",
    }),
  });
  return `${line}, ${stay}`;
};

/** The same counts for a trace row, past tense: "3 changed, 10 unchanged". */
export const changeRowCounts = (change: GistChange): string | undefined => {
  const parts = countParts(change.counts);
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

/** The truthful line that opens a collapsed part of a card. */
export const changeSeeMoreLine = (
  collapsed: readonly ChangeEffect[],
  beyondCap: number,
  complete: boolean,
): string => {
  const total = collapsed.length + beyondCap;
  const has = (kind: ChangeEffect["effect"]) =>
    collapsed.filter((effect) => effect.effect === kind).length;
  const changed = has("changed");
  const set = has("set");
  const unchanged = has("unchanged");
  if (!complete) {
    return t({
      id: "toolChange.seeMore.incomplete",
      message: plural(total, {
        one: "See # more field, some values could not be read",
        other: "See # more fields, some values could not be read",
      }),
    });
  }
  if (unchanged === total) {
    return t({
      id: "toolChange.seeMore.unchanged",
      message: plural(total, {
        one: "See # unchanged field",
        other: "See # unchanged fields",
      }),
    });
  }
  if (set === total) {
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
    changed > 0
      ? t({
          id: "toolChange.seeMore.part.changed",
          message: plural(changed, { one: "# changed", other: "# changed" }),
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
  return t({
    id: "toolChange.seeMore.mixed",
    message: plural(total, {
      one: `See # more field: ${detail} (none is emptied)`,
      other: `See # more fields: ${detail} (none is emptied)`,
    }),
  });
};

export const changeNamesOnly = (names: string, more: number): string =>
  more > 0
    ? t({
        id: "toolChange.namesOnly.more",
        message: `Names only: ${names}, +${more} more`,
      })
    : t({ id: "toolChange.namesOnly", message: `Names only: ${names}` });

export const machineIdPhrase = (): string =>
  t({ id: "toolChange.value.anId", message: "an ID (see Technical details)" });

export const linkPhrase = (name: string | undefined): string =>
  name === undefined
    ? t({
        id: "toolChange.value.aLink",
        message: "a link (see Technical details)",
      })
    : t({ id: "toolChange.value.linkTo", message: `link to ${name}` });

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

export const listReplacedLine = (
  name: string,
  removed: number,
  kept: number,
): string => {
  const goes = t({
    id: "toolChange.list.goes",
    message: plural(removed, { one: "# goes", other: "# go" }),
  });
  const stays =
    kept > 0
      ? t({
          id: "toolChange.list.stays",
          message: plural(kept, { one: "# stays", other: "# stay" }),
        })
      : undefined;
  const parts = stays === undefined ? goes : `${goes}, ${stays}`;
  return t({
    id: "toolChange.list.replaced",
    message: `The list ${name} is replaced: ${parts}`,
  });
};

export const listRemovedLabel = (name: string): string =>
  t({ id: "toolChange.list.removed", message: `${name} removed` });

export const listKeptLabel = (name: string): string =>
  t({ id: "toolChange.list.kept", message: `${name} kept` });

export const listSetLabel = (name: string): string =>
  t({ id: "toolChange.list.setTo", message: `${name} set to` });

export const recipientsLine = (recipients: ChangeRecipients): string => {
  const groups =
    recipients.groups.length > 1
      ? ` (${joinParts(
          recipients.groups.map((group) => `${group.count} ${group.rawName}`),
        )})`
      : "";
  return t({
    id: "toolChange.recipients.total",
    message: plural(recipients.total, {
      one: `To # address${groups}`,
      other: `To # addresses${groups}`,
    }),
  });
};

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

export const flagsLabel = (): string =>
  t({ id: "toolChange.flags", message: "Options" });

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

export const textHeading = (
  name: string,
  lines: number,
  chars: number,
  replaced: boolean,
): string => {
  const size = chars.toLocaleString();
  return replaced
    ? t({
        id: "toolChange.text.replaced",
        message: plural(lines, {
          one: `${name} replaced: # line, ${size} characters`,
          other: `${name} replaced: # lines, ${size} characters`,
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

/** Whether any row loses something, or a statement that none does. */
export const batchLossLines = (batch: ChangeBatch): string[] => {
  const lines: string[] = [];
  if (batch.rowsEmptying > 0) {
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
      t({
        id: "toolChange.batch.losses.lists",
        message: plural(replacing, {
          one: "# row replaces a list",
          other: "# rows replace a list",
        }),
      }),
    );
  }
  if (lines.length === 0 && batch.deletions === 0 && batch.readAll) {
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
): string => {
  const { rows } = field;
  const scope =
    rows === total
      ? t({
          id: "toolChange.batch.scope.all",
          message: plural(rows, { one: "on # row", other: "on all # rows" }),
        })
      : t({
          id: "toolChange.batch.scope.some",
          message: `on ${rows} of ${total} rows`,
        });
  if (field.emptied === rows) {
    return t({
      id: "toolChange.batch.field.allEmptied",
      message: `Emptied ${scope}`,
    });
  }
  const samples = field.samples.map(plainChangeValue).join(", ");
  const distinct = field.distinct;
  const written = field.distinctCapped
    ? t({
        id: "toolChange.batch.field.many",
        message: `Many different values ${scope}: ${samples}`,
      })
    : distinct > 1
      ? t({
          id: "toolChange.batch.field.distinct",
          message: `${distinct} different values ${scope}: ${samples}`,
        })
      : `${samples} ${scope}`;
  const parts = [written];
  if (field.emptied > 0) {
    const emptied = field.emptied;
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
  if (field.listsReplaced > 0) {
    const replaced = field.listsReplaced;
    parts.push(
      t({
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
    default:
      return t({
        id: "toolChange.batch.op.other",
        message: plural(count, { one: "# other", other: "# other" }),
      });
  }
};

export const batchOperationsLine = (batch: ChangeBatch): string => {
  const parts = joinParts(
    batch.operations.map(({ action, count }) => operationWord(action, count)),
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
          "Another assistant decides what to do. Erato cannot tell what will change.",
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

/** A value as plain text, for a trace row's one-line summary. */
export const plainChangeValue = (value: ChangeValue): string =>
  value.machineId && value.text.length === 0 ? machineIdPhrase() : value.text;
