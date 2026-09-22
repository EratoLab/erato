import { DocumentIcon, EntityRow } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import {
  AddinSettingsDialogCore,
  type AddinSettingsDialogCoreProps,
} from "../../core/AddinSettingsDialogCore";
import { ClientActionsSettings } from "../../core/clientActions/ClientActionsSettings";
import { wordClientActionDecisionStore } from "../utils/clientActionPolicy";
import {
  clientActionDisplayLabel,
  offerableWordClientActions,
} from "../utils/wordClientActions";

export function WordSettingsDialog(props: AddinSettingsDialogCoreProps) {
  return (
    <AddinSettingsDialogCore
      {...props}
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
          </EntityRow>
        ),
      }}
    />
  );
}
