import { EntityRow, MailIcon } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { BehaviorTabContent } from "./BehaviorTabContent";
import { ClientActionsSettings } from "./ClientActionsSettings";
import {
  AddinSettingsDialogCore,
  type AddinSettingsDialogCoreProps,
} from "../../core/AddinSettingsDialogCore";

export function AddinSettingsDialog(props: AddinSettingsDialogCoreProps) {
  return (
    <AddinSettingsDialogCore
      {...props}
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
        serversToolsEntities: (
          <EntityRow
            icon={<MailIcon className="size-4 text-theme-fg-secondary" />}
            name={t({
              id: "officeAddin.settings.serversTools.outlookActions",
              message: "Outlook actions",
            })}
            caption={t({
              id: "officeAddin.settings.serversTools.outlookActions.caption",
              message: "Built into Outlook · this device",
            })}
            data-testid="servers-tools-outlook-actions-row"
          >
            <ClientActionsSettings />
          </EntityRow>
        ),
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
