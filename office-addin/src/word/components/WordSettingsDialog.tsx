import { DocumentIcon, EntityRow, RadioCard } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useMemo, useState } from "react";

import {
  AddinSettingsDialogCore,
  type AddinSettingsDialogCoreProps,
} from "../../core/AddinSettingsDialogCore";
import { ClientActionsSettings } from "../../core/clientActions/ClientActionsSettings";
import {
  useActionFacetClientActions,
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
  useWordCommentAuthor,
  useWordCommentPrecedence,
  useWordIncludeDocumentByDefault,
} from "../wordPreferences";

import type { WordCommentPrecedence } from "../utils/wordCommentSend";
import type { WordCommentAuthorMode } from "@erato/frontend/word-review";

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
            <WordCommentAuthorSetting />
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

/** Only where a facet offers new comments; a deployment may lock it (O-28). */
function WordCommentAuthorSetting() {
  const name = useId();
  const facets = useActionFacetClientActions();
  const [author, setAuthor, enforced] = useWordCommentAuthor();
  const offered = [...facets.values()].some((facet) =>
    facet.clientActions.includes("word.add_comments"),
  );
  if (!offered) return null;
  const options: {
    value: WordCommentAuthorMode;
    label: string;
    helper: string;
  }[] = [
    {
      value: "user",
      label: t({
        id: "officeAddin.word.settings.commentAuthor.user",
        message: "Me, with an AI label (default)",
      }),
      helper: t({
        id: "officeAddin.word.settings.commentAuthor.user.helper",
        message:
          "Word shows you as the author; each comment starts with the AI label.",
      }),
    },
    {
      value: "assistant",
      label: t({
        id: "officeAddin.word.settings.commentAuthor.assistant",
        message: "Erato, on my behalf",
      }),
      helper: t({
        id: "officeAddin.word.settings.commentAuthor.assistant.helper",
        message:
          "Word shows Erato, on your behalf, as the author of new comments in Word for Windows and Mac. You can still edit or delete them in Word. Co-authors on Word for the web may briefly see your name until they reload. Replies, and comments in Word for the web, carry your name with the AI label.",
      }),
    },
  ];
  return (
    <fieldset className="space-y-2" data-testid="word-comment-author">
      <legend className="text-sm font-medium text-theme-fg-primary">
        {t({
          id: "officeAddin.word.settings.commentAuthor.legend",
          message: "Post new comments as:",
        })}
      </legend>
      {options.map((option) => (
        <RadioCard
          key={option.value}
          name={name}
          value={option.value}
          checked={author === option.value}
          disabled={enforced}
          onChange={() => setAuthor(option.value)}
          label={option.label}
          helper={option.helper}
        />
      ))}
      {enforced && (
        <p className="text-xs text-theme-fg-muted">
          {t({
            id: "officeAddin.word.settings.commentAuthor.enforced",
            message: "Your organization sets this.",
          })}
        </p>
      )}
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
