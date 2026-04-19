const sidebarIcons = {
  "/docs": "simpleicons-nextra",
  "/docs/features": "iconoir-book",
  "/docs/configuration": "iconoir-settings",
  "/docs/integrations": "iconoir-rocket",
  "/docs/deployment": "iconoir-server",
  "/docs/architecture": "iconoir-folder",
  "sso_oidc": "iconoir-shield",
  "mcp_servers": "iconoir-server",
  "theming": "iconoir-settings",
  "component_customization": "iconoir-folder",
  "internationalization_i18n": "iconoir-folder",
  "sentry": "iconoir-server",
  "langfuse": "simpleicons-gitlab",
  "opentelemetry": "simpleicons-github",
  "prometheus": "simpleicons-kubernetes",
  "sharepoint": "simpleicons-docker",
  "infrastructure_overview": "iconoir-settings",
  "deployment_helm": "iconoir-rocket",
  "oauth2_proxy": "iconoir-shield",
  "frontend_architecture": "iconoir-settings",
};

function normalizeSidebarIconKey(value) {
  if (!value) {
    return "";
  }

  return value.replace(/\/$/, "");
}

export function getSidebarIcon(item) {
  if (!item) return undefined;

  const candidates = [
    normalizeSidebarIconKey(item.route),
    normalizeSidebarIconKey(item.href),
    item.name,
    ...(typeof item.title === "string" ? [item.title] : []),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (sidebarIcons[candidate]) {
      return sidebarIcons[candidate];
    }
  }

  return undefined;
}

export { sidebarIcons };

