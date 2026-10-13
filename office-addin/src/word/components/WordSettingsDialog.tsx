import { DocumentIcon, EntityRow, RadioCard } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useMemo, useState } from "react";

import {
  AddinSettingsDialogCore,
  type AddinSettingsDialogCoreProps,
} from "../../core/AddinSettingsDialogCore";
import { ClientActionsSettings } from "../../core/clientActions/ClientActionsSettings";
import {
  useAvailableActionFacetArgs,
  useAvailableActionFacetIds,
} from "../../core/clientActions/useAvailableActionFacets";
import { useOffice } from "../../providers/OfficeProvider";
import { wordClientActionDecisionStore } from "../utils/clientActionPolicy";
import {
  clientActionDisplayLabel,
  offerableWordClientActions,
} from "../utils/wordClientActions";
import { wordCommentAdvertised } from "../utils/wordCommentSend";
import {
  readWordCompatibilityMode,
  writeWordCompatibilityMode,
} from "../utils/wordInPlaceSwitch";
import {
  useWordCommentPrecedence,
  useWordIncludeDocumentByDefault,
} from "../wordPreferences";

import type { WordCommentPrecedence } from "../utils/wordCommentSend";

export function WordSettingsDialog(props: AddinSettingsDialogCoreProps) {
  const { supportsAudioCapture } = useOffice();
  return (
    <AddinSettingsDialogCore
      {...props}
      audioInputSupported={supportsAudioCapture}
      hostContribution={{
        tabLabel: t({
          id: "officeAddin.word.settings.tab",
          message: "Word",
        }),
        heading: t({
          id: "officeAddin.word.settings.heading",
          message: "Word behavior",
        }),
        description: t({
          id: "officeAddin.word.settings.description",
          message: "Choose how new chats use the open document.",
        }),
        content: (
          <div className="space-y-5">
            <WordIncludeDocumentSetting />
            <WordCommentPrecedenceSetting />
          </div>
        ),
        systemDescription: t({
          id: "officeAddin.settings.appearance.system.description.word",
          message: "Follow your Word theme.",
        }),
        serversToolsEntities: (
          <EntityRow
            icon={<DocumentIcon className="size-4 text-theme-fg-secondary" />}
            name={t({
              id: "officeAddin.settings.serversTools.wordActions",
              message: "Word actions",
            })}
            caption={t({
              id: "officeAddin.settings.serversTools.wordActions.caption",
              message: "Built into Word · this device",
            })}
            data-testid="servers-tools-word-actions-row"
          >
            <ClientActionsSettings
              store={wordClientActionDecisionStore}
              offerableActions={offerableWordClientActions}
              displayLabel={clientActionDisplayLabel}
              copy={{
                intro: t({
                  id: "officeAddin.settings.addin.clientActions.intro.word",
                  message:
                    "Your decisions from the in-chat confirmation are stored here and can be changed any time. These actions write into the open document straight away.",
                }),
                alwaysAllowHelper: (action) =>
                  action === "word.insert_at_cursor"
                    ? t({
                        id: "officeAddin.word.settings.alwaysInsert",
                        message:
                          "Inserts text at the current cursor without asking. This action has no Erato Revert; use Word Undo if needed.",
                      })
                    : action === "word.apply_document_plan"
                      ? t({
                          id: "officeAddin.word.settings.alwaysPlan",
                          message:
                            "Applies the complete rewrite without asking, only if the document still matches the reviewed source. Erato Revert is available while the applied document remains unchanged.",
                        })
                      : action === "word.replace_selection"
                        ? t({
                            id: "officeAddin.word.settings.alwaysReplaceSelection",
                            message:
                              "Replaces the selected passage without asking, only if it is unchanged since your request. Undo is available while Track Changes is off.",
                          })
                        : t({
                            id: "officeAddin.settings.addin.clientActions.always.helper.word",
                            message:
                              "Writes into the open document without asking. Paragraphs you changed since asking are skipped, every change is listed afterwards, and a single Revert undoes the batch.",
                          }),
              }}
            />
            <WordCompatibilityModeSetting />
          </EntityRow>
        ),
      }}
    />
  );
}

function WordIncludeDocumentSetting() {
  const helperId = useId();
  const [includeDocument, setIncludeDocument] =
    useWordIncludeDocumentByDefault();
  return (
    <div className="space-y-1">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={includeDocument}
          aria-describedby={helperId}
          onChange={(event) => setIncludeDocument(event.target.checked)}
          className="size-4 accent-[var(--theme-fg-accent)] focus:ring-theme-fg-accent focus:ring-offset-0"
        />
        <span className="text-sm text-theme-fg-secondary">
          {t({
            id: "officeAddin.word.settings.includeDocument",
            message: "Include the open document in new chats",
          })}
        </span>
      </label>
      <p id={helperId} className="text-xs text-theme-fg-muted">
        {t({
          id: "officeAddin.word.settings.includeDocument.helper",
          message:
            "Erato reads the document when you send a message. You can remove it from any chat.",
        })}
      </p>
    </div>
  );
}

/** Only where a selection's comment can be sent as its own thread, the one thing it changes. */
function WordCommentPrecedenceSetting() {
  const name = useId();
  const facetIds = useAvailableActionFacetIds();
  const facetArgs = useAvailableActionFacetArgs();
  const advertised = useMemo(
    () => wordCommentAdvertised(facetIds, facetArgs),
    [facetIds, facetArgs],
  );
  const [precedence, setPrecedence] = useWordCommentPrecedence();
  if (!advertised.thread) return null;
  const options: {
    value: WordCommentPrecedence;
    label: string;
    helper: string;
  }[] = [
    {
      value: "selection",
      label: t({
        id: "officeAddin.word.settings.commentPrecedence.selection",
        message: "Work on the selected text (default)",
      }),
      helper: t({
        id: "officeAddin.word.settings.commentPrecedence.selection.helper",
        message:
          "Comments are sent along, and Erato can offer to replace the text.",
      }),
    },
    {
      value: "comment",
      label: t({
        id: "officeAddin.word.settings.commentPrecedence.comment",
        message: "Work on the comment",
      }),
      helper: t({
        id: "officeAddin.word.settings.commentPrecedence.comment.helper",
        message: "Erato does not offer to replace the text.",
      }),
    },
  ];
  return (
    <fieldset className="space-y-2" data-testid="word-comment-precedence">
      <legend className="text-sm font-medium text-theme-fg-primary">
        {t({
          id: "officeAddin.word.settings.commentPrecedence.legend",
          message: "When the text you select has comments, Erato should:",
        })}
      </legend>
      {options.map((option) => (
        <RadioCard
          key={option.value}
          name={name}
          value={option.value}
          checked={precedence === option.value}
          onChange={() => setPrecedence(option.value)}
          label={option.label}
          helper={option.helper}
        />
      ))}
    </fieldset>
  );
}

/** Per device; the checkbox shows what storage holds, so a failed write leaves it unchecked. */
function WordCompatibilityModeSetting() {
  const helperId = useId();
  const [enabled, setEnabled] = useState(readWordCompatibilityMode);
  return (
    <div className="mt-4 space-y-1">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          aria-describedby={helperId}
          onChange={(event) => {
            writeWordCompatibilityMode(event.target.checked);
            setEnabled(readWordCompatibilityMode());
          }}
          className="size-4 accent-[var(--theme-fg-accent)] focus:ring-theme-fg-accent focus:ring-offset-0"
        />
        <span className="text-sm text-theme-fg-secondary">
          {t({
            id: "officeAddin.word.settings.compatibilityMode",
            message:
              "Replace the whole document when applying (compatibility mode)",
          })}
        </span>
      </label>
      <p id={helperId} className="text-xs text-theme-fg-muted">
        {t({
          id: "officeAddin.word.settings.compatibilityMode.helper",
          message:
            "Rewrites go in as a complete replacement instead of editing only the changed passages. Use it if in-place edits cause problems. Rewrites can't be applied this way while Track Changes is on.",
        })}
      </p>
    </div>
  );
}
