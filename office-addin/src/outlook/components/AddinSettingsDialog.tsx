import {
  approvalToolRows,
  ClientToolDecisionList,
  EntityRow,
  MailIcon,
  useApprovalTools,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { BehaviorTabContent } from "./BehaviorTabContent";
import {
  AddinSettingsDialogCore,
  type AddinSettingsDialogCoreProps,
} from "../../core/AddinSettingsDialogCore";
import { carryOverMappingsFor } from "../../core/clientActions/proposalApply";
import { useOffice } from "../../providers/OfficeProvider";

export function AddinSettingsDialog(props: AddinSettingsDialogCoreProps) {
  const { supportsAudioCapture } = useOffice();
  const approvalTools = useApprovalTools();
  // Kept with the account, so every device has the same choice.
  const outlookTools = useMemo(() => {
    const keys = new Set(
      carryOverMappingsFor(approvalTools, "outlook").map(
        (mapping) => mapping.serverKey,
      ),
    );
    return approvalTools.filter((tool) => keys.has(tool.qualified_name));
  }, [approvalTools]);
  return (
    <AddinSettingsDialogCore
      {...props}
      supportsDisclaimers
      audioInputSupported={supportsAudioCapture}
      hostContribution={{
        tabLabel: t({
          id: "officeAddin.settings.tabs.outlook",
          message: "Outlook",
        }),
        heading: t({
          id: "officeAddin.settings.outlook.heading",
          message: "Outlook behavior",
        }),
        description: t({
          id: "officeAddin.settings.outlook.description",
          message:
            "Configure how switching between Outlook emails maps to chats.",
        }),
        systemDescription: t({
          id: "officeAddin.settings.appearance.system.description.outlook",
          message: "Follow your Outlook theme.",
        }),
        appearanceNotice: (
          <p className="text-xs text-theme-fg-muted">
            {t({
              id: "officeAddin.settings.appearance.outlook.staleness.note",
              message:
                "Outlook for Windows requires a full restart to pick up theme changes (known Office bug). Pick Light or Dark above to override the host theme.",
            })}
          </p>
        ),
        // Without an Outlook tool on the server, the tab has nothing of Outlook's to show.
        serversToolsEntities:
          outlookTools.length > 0 ? (
            <EntityRow
              icon={<MailIcon className="size-4 text-theme-fg-secondary" />}
              name={t({
                id: "officeAddin.settings.serversTools.outlookActions",
                message: "Outlook actions",
              })}
              caption={t({
                id: "officeAddin.settings.serversTools.outlookActions.everyDevice",
                message: "Built into Outlook · every device",
              })}
              data-testid="servers-tools-outlook-actions-row"
            >
              <ClientToolDecisionList
                tools={approvalToolRows(outlookTools)}
                defaultDecision="ask"
                heading={t({
                  id: "officeAddin.outlook.settings.serverActions",
                  message: "Actions",
                })}
                data-testid="outlook-server-tool-decisions"
              />
            </EntityRow>
          ) : undefined,
        content: (
          <BehaviorTabContent
            emptyStateText={t({
              id: "officeAddin.settings.placeholder.empty",
              message: "No settings available yet.",
            })}
          />
        ),
      }}
    />
  );
}
