import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";

import { useListMcpServerTools } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { Alert } from "../Feedback/Alert";
import { SettledInfoPill } from "../Trace/steps/ToolStatusPill";

import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// The server's tool roster only moves on a redeploy, and the backend serves
// a repeat expand from its own session cache within this window anyway.
const TOOLS_STALE_TIME_MS = 5 * 60 * 1000;

const NEUTRAL_PILL = "bg-theme-bg-tertiary text-theme-fg-secondary";
const ATTENTION_PILL = "bg-theme-warning-bg text-theme-warning-fg";

/**
 * Every badge is a straight lookup on a field the backend already decided;
 * the same function that gates a run produced these values, so nothing here
 * may re-derive them (an unannotated tool is NOT read-only under protocol
 * defaults, and only the backend knows the configured preset).
 */
const toolBadges = (tool: McpServerTool) => {
  const badges: { label: string; toneClassName: string }[] = [];
  if (tool.annotations.read_only_hint) {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.readsOnly",
        message: "Reads only",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  } else {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.canModify",
        message: "Can modify",
      }),
      toneClassName: ATTENTION_PILL,
    });
  }
  if (tool.annotations.open_world_hint) {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.reachesOtherSystems",
        message: "Reaches other systems",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  }
  if (!tool.annotations.annotated) {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.notDeclared",
        message: "Not declared by the server",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  }
  if (tool.approval === "ask") {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.asksBeforeRunning",
        message: "Asks before running",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  }
  return badges;
};

function McpServerToolRow({ tool }: { tool: McpServerTool }) {
  return (
    <li
      className="space-y-1"
      data-testid="mcp-server-tool-row"
      data-tool-name={tool.name}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-theme-fg-primary">
          {tool.title}
        </span>
        {tool.title !== tool.name ? (
          <span className="font-mono text-xs text-theme-fg-muted">
            {tool.name}
          </span>
        ) : null}
      </div>
      {tool.description ? (
        <p className="text-xs text-theme-fg-secondary">{tool.description}</p>
      ) : null}
      <ul className="flex flex-wrap gap-1" aria-label={tool.title}>
        {toolBadges(tool).map((badge) => (
          <li key={badge.label}>
            <SettledInfoPill
              label={badge.label}
              toneClassName={badge.toneClassName}
            />
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Read-only roster of one MCP server's tools as the user's generations see
 * them. Mounted inside the server's entity row, whose details unmount on
 * collapse, so mounting IS the expand and the fetch happens once per expand
 * — repeat expands inside the stale window come from the query cache.
 */
export function McpServerToolList({
  serverId,
  isActive,
}: {
  serverId: string;
  /** Gates the fetch to the tab actually being shown. */
  isActive: boolean;
}) {
  const { data, error, isLoading } = useListMcpServerTools(
    isActive ? { pathParams: { serverId } } : skipToken,
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: TOOLS_STALE_TIME_MS,
    },
  );

  let body: ReactNode = null;
  if (error) {
    body = (
      <Alert type="error">
        {t({
          id: "preferences.dialog.mcpServers.tools.loadError",
          message: "Could not load the tools of this server. Please try again.",
        })}
      </Alert>
    );
  } else if (isLoading || !data) {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.loading",
          message: "Loading tools...",
        })}
      </p>
    );
  } else if (data.status === "NEEDS_AUTHENTICATION") {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.needsAuthentication",
          message: "Connect to see tools.",
        })}
      </p>
    );
  } else if (data.status !== "SUCCESS") {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.failure",
          message:
            "The tools could not be listed because the server is unreachable.",
        })}
      </p>
    );
  } else if (data.tools.length === 0) {
    body = (
      <p className="text-sm italic text-theme-fg-muted">
        {t({
          id: "preferences.dialog.mcpServers.tools.empty",
          message: "This server exposes no tools to you.",
        })}
      </p>
    );
  } else {
    body = (
      <ul className="space-y-3">
        {data.tools.map((tool) => (
          <McpServerToolRow key={tool.name} tool={tool} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-3" data-testid="mcp-server-tool-list">
      <h3 className="text-sm font-medium text-theme-fg-primary">
        {t({
          id: "preferences.dialog.mcpServers.tools.heading",
          message: "Tools",
        })}
      </h3>
      {body}
    </div>
  );
}
