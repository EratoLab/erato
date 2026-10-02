import { DocumentIcon, EntityRow } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import {
  AddinSettingsDialogCore,
  type AddinSettingsDialogCoreProps,
} from "../../core/AddinSettingsDialogCore";
import { ClientActionsSettings } from "../../core/clientActions/ClientActionsSettings";
import { useOffice } from "../../providers/OfficeProvider";
import { wordClientActionDecisionStore } from "../utils/clientActionPolicy";
import {
  clientActionDisplayLabel,
  offerableWordClientActions,
} from "../utils/wordClientActions";
import {
  readWordCompatibilityMode,
  writeWordCompatibilityMode,
} from "../utils/wordInPlaceSwitch";

export function WordSettingsDialog(props: AddinSettingsDialogCoreProps) {
  const { supportsAudioCapture } = useOffice();
  return (
    <AddinSettingsDialogCore
      {...props}
      audioInputSupported={supportsAudioCapture}
      hostContribution={{
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
