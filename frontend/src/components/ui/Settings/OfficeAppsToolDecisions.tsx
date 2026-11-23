import { t } from "@lingui/core/macro";

import { useFacets } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { gistToolLine } from "@/lib/toolCallGist/gistLabels";

import { ClientToolDecisionList } from "./ClientToolDecisionList";
import { EntityRow } from "./EntityRow";
import { DocumentIcon } from "../icons";

import type { ApprovalToolInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const NO_TOOLS: ApprovalToolInfo[] = [];

/**
 * The tools the server calls to make a change the user approves in an
 * Office app, as the user's facets reach them. Empty where the deployment
 * has none.
 */
export const useApprovalTools = (
  enabled = true,
): readonly ApprovalToolInfo[] => {
  const { data } = useFacets({}, { enabled });
  return data?.approval_tools ?? NO_TOOLS;
};

/**
 * The approval tools as rows of the shared decision list, each named from its
 * label in the user's language. A tool without one, or one whose name would
 * read like another row's, keeps the deployment's title.
 */
export const approvalToolRows = (tools: readonly ApprovalToolInfo[]) => {
  const lines = tools.map((tool) => gistToolLine(tool.label));
  return tools.map((tool, index) => {
    const line = lines[index];
    const unique =
      line !== undefined &&
      lines.filter((other) => other === line).length === 1;
    return {
      qualifiedName: tool.qualified_name,
      label: unique ? line : tool.title,
      asksEveryTime: tool.approval === "every_call",
      "data-testid": `client-tool-decision-${tool.qualified_name}`,
    };
  });
};

/**
 * The Servers & Tools row for changes in Office apps: Ask, Always or Never
 * for each, stored with the account, so the same choice holds in the Word
 * pane, in any other Office app and here.
 */
export function OfficeAppsToolDecisions({
  tools,
}: {
  tools: readonly ApprovalToolInfo[];
}) {
  if (tools.length === 0) return null;
  return (
    <EntityRow
      icon={<DocumentIcon className="size-4 text-theme-fg-secondary" />}
      name={t({
        id: "preferences.dialog.officeApps.name",
        message: "Office apps",
      })}
      caption={t({
        id: "preferences.dialog.officeApps.caption",
        message: "Built into the Office apps · every device",
      })}
      data-testid="servers-tools-office-apps-row"
    >
      <p className="text-sm text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.officeApps.intro",
          message:
            "Choose whether Erato asks before it changes something in an Office app, such as the open document. Your choice applies wherever you use Erato.",
        })}
      </p>
      <ClientToolDecisionList
        tools={approvalToolRows(tools)}
        defaultDecision="ask"
        heading={t({
          id: "preferences.dialog.officeApps.tools.heading",
          message: "Changes",
        })}
        data-testid="office-apps-tool-decisions"
      />
    </EntityRow>
  );
}
