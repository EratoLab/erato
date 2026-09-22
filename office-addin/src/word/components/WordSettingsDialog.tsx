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

/**
 * The Word settings surface: the shared dialog plus one entity in the "MCP &
 * Apps" pane carrying the per-action decision rows.
 *
 * Word contributes NO host tab. It has no host behaviour to configure — the
 * include-document chip is a per-chat gesture, not a setting — so it supplies
 * only `serversToolsEntities`, which is enough to spawn the shared pane. That
 * is why `AddinSettingsHostContribution`'s four tab fields are optional and
 * the tab is gated on `content`: otherwise reaching the client-action rows
 * would have cost an empty "Word" tab.
 *
 * The copy diverges from Outlook's deliberately. Outlook can promise "nothing
 * is sent until you press Send", because its actions only ever open a
 * prefilled form. A Word `always` grant writes into the open document
 * immediately, with no later gate — so the copy names the real safety net:
 * each action describes its own source checks and recovery limits.
 */
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
