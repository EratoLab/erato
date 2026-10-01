#!/usr/bin/env python3
"""Teams bot/SSO support using Azure CLI, Python 3 and curl; read-only by default.

Works in Azure Cloud Shell Bash and locally. --plan-sso previews additions;
--apply-sso adds SSO to an existing Entra app and creates a separate OAuth
connection. It never deploys Erato or installs Teams packages.
Exit codes: 0 = configuration checks pass, 1 = missing settings, 2 = incomplete audit.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import quote, urlencode, urlsplit
from uuid import UUID, NAMESPACE_URL, uuid5


GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000"
AAD_V2_PROVIDER = "30dd229c-58e3-4a48-bdfd-91ec48eb906c"
TEAMS_CLIENTS = {
    "desktop/mobile": "1fec8e78-bce4-4aaf-ab1b-5451cc387264",
    "web": "5e3ce6c0-2b1f-4285-8d4b-75ee78787346",
}
GRAPH_SCOPES = set("openid profile email offline_access User.Read GroupMember.Read.All "
                   "Files.Read.All Sites.Read.All Chat.Read ChannelMessage.Read.All".split())
BOT_QUERY = ("{id:id,name:name,location:location,properties:{endpoint:properties.endpoint,"
             "msaAppId:properties.msaAppId,msaAppTenantId:properties.msaAppTenantId,"
             "msaAppType:properties.msaAppType,enabledChannels:properties.enabledChannels}}")
# Whitelist public metadata in the CLI itself: do not return clientSecret or provider secrets.
CONNECTION_QUERY = (
    "{name:name,properties:{clientId:properties.clientId,scopes:properties.scopes,"
    "serviceProviderId:properties.serviceProviderId,parameters:properties.parameters"
    "[?key=='tenantId' || key=='tokenExchangeUrl']}}"
)
APP_SELECT = "id,appId,displayName,signInAudience,identifierUris,api,web,spa,requiredResourceAccess"


class AuditError(Exception):
    pass


def command_json(arguments: list[str]) -> dict | list:
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise AuditError(f"Could not run {arguments[0]}: {type(error).__name__}") from error
    if result.returncode:
        # No raw API bodies or CLI output: support reports must never contain credentials.
        reason = "request failed"
        for label, patterns in [
            ("not found", ("404", "ResourceNotFound", "Request_ResourceNotFound")),
            ("access denied", ("403", "Forbidden", "AuthorizationFailed", "Insufficient privileges")),
            ("sign-in required", ("az login", "AADSTS", "expired", "401")),
            ("TLS validation failed", ("certificate", "SSL")),
        ]:
            if any(pattern.lower() in result.stderr.lower() for pattern in patterns):
                reason = label
                break
        raise AuditError(f"{arguments[0]}: {reason} (exit {result.returncode})")
    try:
        return json.loads(result.stdout) if result.stdout.strip() else {}
    except ValueError as error:
        raise AuditError(f"{arguments[0]} returned non-JSON data (possibly an authentication page)") from error


def az_json(*arguments: str) -> dict | list:
    return command_json(["az", *arguments, "--only-show-errors", "--output", "json"])


def rest_get(url: str, query: str | None = None) -> dict | list:
    if not url.startswith(("https://graph.microsoft.com/v1.0/", "https://management.azure.com/")):
        raise AuditError("Refusing an API URL outside public Azure/Graph")
    arguments = ["rest", "--method", "GET", "--url", url]
    if query:
        arguments += ["--query", query]
    return az_json(*arguments)


def rest_write(method: str, url: str, body: dict, query: str | None = None) -> dict:
    """Keep request bodies (including a new OAuth secret) out of command arguments."""
    if method not in ("PATCH", "POST", "PUT") or not url.startswith((
            "https://graph.microsoft.com/v1.0/", "https://management.azure.com/")):
        raise AuditError("Refusing unexpected write target")
    # NamedTemporaryFile is mode 0600 and removed even when the CLI fails.
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".json", encoding="utf-8") as handle:
        json.dump(body, handle)
        handle.flush()
        arguments = ["rest", "--method", method, "--url", url,
                     "--headers", "Content-Type=application/json", "--body", "@" + handle.name]
        if query:
            arguments += ["--query", query]
        return az_json(*arguments)


def graph_list(path: str, **parameters: str) -> list[dict]:
    url = f"https://graph.microsoft.com/v1.0/{path}?{urlencode(parameters)}"
    values = []
    for _ in range(100):
        page = rest_get(url)
        if not isinstance(page, dict) or not isinstance(page.get("value"), list):
            raise AuditError("Unexpected Graph collection response")
        values.extend(page["value"])
        url = page.get("@odata.nextLink")
        if not url:
            return values
    raise AuditError("Graph pagination did not finish")


def valid_guid(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError as error:
        raise argparse.ArgumentTypeError("expected a GUID") from error


def parse_args(arguments: list[str] | None = None, deployment: dict | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discover", action="store_true", help="Find the bot by app ID in the selected CLI subscription")
    parser.add_argument("--tenant-id", type=valid_guid)
    parser.add_argument("--subscription-id", type=valid_guid)
    parser.add_argument("--resource-group")
    parser.add_argument("--bot-name")
    parser.add_argument("--base-url", help="Erato HTTPS origin, without /office-addin")
    parser.add_argument("--expected-bot-app-id", type=valid_guid)
    parser.add_argument("--connection", help="OAuth connection to audit or create (default: graph for audit, graph-sso for SSO setup)")
    parser.add_argument("--auth-app-id", type=valid_guid,
                        help="Inspect a proposed SSO app instead of the current OAuth client")
    parser.add_argument("--sso-resource", help="Expected Application ID URI; otherwise use the connection or a proposed URI")
    parser.add_argument("--manifest", type=Path, help="Inspect a saved manifest.json instead of downloading it")
    parser.add_argument("--json", action="store_true", help="Print a sanitized JSON support report")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan-sso", action="store_true", help="Preview SSO additions; no cloud writes")
    mode.add_argument("--apply-sso", action="store_true", help="Apply SSO additions and create the named OAuth connection")
    args = parser.parse_args(arguments)
    setup_mode = args.plan_sso or args.apply_sso
    if deployment:
        args.discover = True
        defaults = {"base_url": deployment["baseUrl"], "expected_bot_app_id": deployment["botId"],
                    "auth_app_id": deployment["authAppId"], "sso_resource": deployment["ssoResource"],
                    "connection": deployment["ssoConnection"] if setup_mode else deployment["currentConnection"]}
        for key, value in defaults.items():
            if getattr(args, key) is None:
                setattr(args, key, value)
    args.embedded_manifest = deployment.get("manifest") if deployment else None
    args.connection = args.connection or ("graph-sso" if setup_mode else "graph")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", args.connection):
        parser.error("--connection must contain 1-64 letters, digits, underscores or hyphens")
    required = ("base_url", "expected_bot_app_id") if args.discover else (
        "tenant_id", "subscription_id", "resource_group", "bot_name", "base_url", "expected_bot_app_id")
    for key in required:
        if not getattr(args, key):
            parser.error(f"--{key.replace('_', '-')} is required")
    for key in ("tenant_id", "subscription_id", "expected_bot_app_id", "auth_app_id"):
        if getattr(args, key):
            try:
                setattr(args, key, valid_guid(getattr(args, key)))
            except argparse.ArgumentTypeError as error:
                parser.error(f"--{key.replace('_', '-')}: {error}")
    origin = urlsplit(args.base_url)
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.query or origin.fragment or origin.path not in ("", "/")):
        parser.error("--base-url must be an HTTPS origin without credentials, path or query")
    args.base_url = args.base_url.rstrip("/")
    if args.sso_resource and not args.sso_resource.startswith("api://"):
        parser.error("--sso-resource must start with api://")
    if (args.plan_sso or args.apply_sso) and not args.auth_app_id:
        parser.error("SSO setup requires an explicit --auth-app-id; use the shared add-in app for a combined tab/bot")
    if setup_mode and (args.connection == "graph" or (deployment and args.connection == deployment["currentConnection"])):
        parser.error("SSO setup requires a separate --connection, for example graph-sso; the existing graph connection is preserved")
    return args


def discover_bot(args: argparse.Namespace) -> None:
    """Resolve an existing bot only in the selected subscription, never across tenants."""
    current = az_json("account", "show", "--query", "{tenantId:tenantId,id:id,environmentName:environmentName}")
    if current.get("environmentName") != "AzureCloud":
        raise AuditError("This helper supports public Azure only")
    if args.tenant_id and current.get("tenantId") != args.tenant_id:
        raise AuditError("Wrong CLI tenant; select the intended tenant before running the helper")
    args.tenant_id = args.tenant_id or valid_guid(current["tenantId"])
    args.subscription_id = args.subscription_id or valid_guid(current["id"])
    target = az_json("account", "show", "--subscription", args.subscription_id,
                     "--query", "{tenantId:tenantId,id:id}")
    if target.get("tenantId") != args.tenant_id:
        raise AuditError("Wrong CLI tenant for the target subscription")
    if args.resource_group and args.bot_name:
        return  # audit() verifies the requested resource's identity and tenant.
    url = (f"https://management.azure.com/subscriptions/{args.subscription_id}"
           "/providers/Microsoft.BotService/botServices?api-version=2022-09-15")
    matches = []
    for _ in range(100):
        page = rest_get(url, "{value:value[].{id:id,name:name,appId:properties.msaAppId},nextLink:nextLink}")
        for item in page.get("value") or []:
            if str(item.get("appId", "")).lower() != args.expected_bot_app_id.lower():
                continue
            match = re.fullmatch(r"/subscriptions/([^/]+)/resourceGroups/([^/]+)/providers/Microsoft.BotService/botServices/([^/]+)",
                                 item.get("id", ""), re.IGNORECASE)
            if not match or match[1].lower() != args.subscription_id.lower():
                raise AuditError("Unexpected bot resource ID returned by Azure")
            if args.resource_group and match[2].lower() != args.resource_group.lower():
                continue
            if args.bot_name and match[3].lower() != args.bot_name.lower():
                continue
            matches.append((match[2], match[3]))
        url = page.get("nextLink")
        if not url:
            break
    else:
        raise AuditError("Bot discovery pagination did not finish")
    if len(matches) != 1:
        raise AuditError(f"Found {len(matches)} bots matching {args.expected_bot_app_id} in subscription {args.subscription_id}. "
                         "Select the bot's subscription with az account set --subscription ID; "
                         "use --resource-group and --bot-name to disambiguate existing bots.")
    args.resource_group, args.bot_name = matches[0]


def add_check(report: dict, name: str, success: bool, detail: str) -> None:
    report["checks"].append({"name": name, "status": "PASS" if success else "MISSING", "detail": detail})


def incomplete(report: dict, name: str, error: Exception) -> None:
    report["checks"].append({"name": name, "status": "UNKNOWN", "detail": str(error)})


def evaluate(report: dict, args: argparse.Namespace) -> None:
    """Evaluate only collected metadata; absent/unreadable data is never a pass."""
    bot = report.get("bot")
    connection = report.get("connection")
    app = report.get("authApp")
    manifest = report.get("manifest")
    if bot:
        p = bot.get("properties") or {}
        add_check(report, "bot tenant", p.get("msaAppTenantId") == args.tenant_id, args.tenant_id)
        add_check(report, "single-tenant bot", p.get("msaAppType") == "SingleTenant", str(p.get("msaAppType")))
        if args.expected_bot_app_id:
            add_check(report, "bot identity", p.get("msaAppId") == args.expected_bot_app_id, args.expected_bot_app_id)
        add_check(report, "messaging endpoint", p.get("endpoint") == args.base_url + "/api/integrations/ms_teams/messages",
                  str(p.get("endpoint")))
        add_check(report, "Teams channel", "msteams" in (p.get("enabledChannels") or []), "msteams")
    resource = report.get("expectedSsoResource")
    if connection:
        p = connection.get("properties") or {}
        params = {item["key"]: item.get("value") for item in p.get("parameters") or []}
        add_check(report, "OAuth provider", p.get("serviceProviderId") == AAD_V2_PROVIDER, "Azure Active Directory v2")
        add_check(report, "OAuth tenant", params.get("tenantId") == args.tenant_id, str(params.get("tenantId")))
        add_check(report, "OAuth client ID", p.get("clientId") == report.get("authAppId"), str(p.get("clientId")))
        add_check(report, "Token Exchange URL", bool(resource) and params.get("tokenExchangeUrl") == resource,
                  str(params.get("tokenExchangeUrl") or "not configured"))
        missing = GRAPH_SCOPES - set((p.get("scopes") or "").split())
        add_check(report, "OAuth Graph scopes", not missing, "missing: " + ", ".join(sorted(missing)) if missing else "all required scopes requested")
    if app:
        api = app.get("api") or {}
        add_check(report, "authentication app tenant type", app.get("signInAudience") == "AzureADMyOrg", str(app.get("signInAudience")))
        add_check(report, "exposed Application ID URI", bool(resource) and resource in (app.get("identifierUris") or []), str(resource))
        add_check(report, "v2 access tokens", api.get("requestedAccessTokenVersion") == 2, str(api.get("requestedAccessTokenVersion")))
        scopes = [scope for scope in api.get("oauth2PermissionScopes") or []
                  if scope.get("value") == "access_as_user" and scope.get("isEnabled")]
        scope_ids = {scope["id"] for scope in scopes}
        add_check(report, "access_as_user scope", bool(scope_ids), "enabled scope required")
        for client, client_id in TEAMS_CLIENTS.items():
            granted = set()
            for entry in api.get("preAuthorizedApplications") or []:
                if entry.get("appId") == client_id:
                    granted.update(entry.get("delegatedPermissionIds") or [])
            add_check(report, f"Teams {client} pre-authorization", bool(scope_ids & granted), client_id)
        callback = "https://token.botframework.com/.auth/web/redirect"
        add_check(report, "OAuth web callback", callback in ((app.get("web") or {}).get("redirectUris") or []), callback)
        if "graphPermissions" in report:
            permission_names = report["graphPermissions"]
            requested = set()
            for access in app.get("requiredResourceAccess") or []:
                if access.get("resourceAppId") == GRAPH_APP_ID:
                    requested.update(permission_names.get(item["id"]) for item in access.get("resourceAccess") or []
                                     if item.get("type") == "Scope")
            missing = GRAPH_SCOPES - requested
            add_check(report, "Entra delegated Graph permissions", not missing,
                      "missing: " + ", ".join(sorted(missing)) if missing else "all required delegated permissions configured")
    if "consent" in report:
        granted = set()
        for grant in report["consent"]:
            if grant.get("consentType") == "AllPrincipals" and grant.get("resourceId") == report.get("graphServicePrincipalId"):
                granted.update((grant.get("scope") or "").split())
        missing = GRAPH_SCOPES - granted
        add_check(report, "tenant-wide Graph consent", not missing,
                  "missing: " + ", ".join(sorted(missing)) if missing else "all required delegated scopes granted")
    if manifest:
        web = manifest.get("webApplicationInfo") or {}
        bot_id = ((bot or {}).get("properties") or {}).get("msaAppId") or args.expected_bot_app_id
        add_check(report, "manifest bot ID", any(b.get("botId") == bot_id for b in manifest.get("bots") or []), str(bot_id))
        add_check(report, "manifest SSO app ID", web.get("id") == report.get("authAppId"), str(web.get("id")))
        add_check(report, "manifest SSO resource", bool(resource) and web.get("resource") == resource, str(web.get("resource")))
        add_check(report, "manifest token-service domain", "token.botframework.com" in (manifest.get("validDomains") or []), "token.botframework.com")
        if app and web.get("id") == app.get("appId"):
            redirects = set((app.get("spa") or {}).get("redirectUris") or [])
            for entry in web.get("nestedAppAuthInfo") or []:
                uri = entry.get("redirectUri")
                add_check(report, "tab NAA redirect", uri in redirects, str(uri))
        elif web.get("nestedAppAuthInfo"):
            report["notes"].append("The tab currently uses a different Entra app from the selected OAuth app. "
                                   "Choose the shared add-in app for OAuth/SSO or verify the tab before changing webApplicationInfo.id.")


def audit(args: argparse.Namespace) -> dict:
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "environment": args.bot_name,
              "tenantId": args.tenant_id, "subscriptionId": args.subscription_id,
              "connectionName": args.connection, "checks": [], "notes": []}
    # Graph uses the current CLI tenant; a subscription argument alone does not select its tenant.
    current = az_json("account", "show", "--query", "{tenantId:tenantId,id:id}")
    target = az_json("account", "show", "--subscription", args.subscription_id, "--query", "{tenantId:tenantId,id:id}")
    if current.get("tenantId") != args.tenant_id or target.get("tenantId") != args.tenant_id:
        raise AuditError(f"Wrong CLI tenant. Sign in with az login --tenant {args.tenant_id}; no API audit was performed.")
    add_check(report, "CLI tenant", True, args.tenant_id)
    resource_id = (f"/subscriptions/{args.subscription_id}/resourceGroups/{quote(args.resource_group, safe='')}"
                   f"/providers/Microsoft.BotService/botServices/{quote(args.bot_name, safe='')}")
    url = "https://management.azure.com" + resource_id
    report["botResourceId"] = resource_id
    for key, path, query in [("bot", "", BOT_QUERY),
                             ("connection", "/connections/" + quote(args.connection, safe=""), CONNECTION_QUERY)]:
        try:
            report[key] = rest_get(url + path + "?api-version=2022-09-15", query)
        except AuditError as error:
            if "not found" in str(error):
                add_check(report, key + " exists", False, str(error))
            else:
                incomplete(report, key + " metadata", error)
    properties = (report.get("connection") or {}).get("properties") or {}
    app_id = args.auth_app_id or properties.get("clientId")
    if app_id:
        try:
            app_id = valid_guid(app_id)
        except argparse.ArgumentTypeError as error:
            raise AuditError("OAuth client ID is not a GUID") from error
        report["authAppId"] = app_id
        params = {p["key"]: p.get("value") for p in properties.get("parameters") or []}
        resource = args.sso_resource or params.get("tokenExchangeUrl")
        if not resource:
            resource = f"api://{urlsplit(args.base_url).netloc}/botid-{app_id}"
            report["notes"].append("No Token Exchange URL is configured. expectedSsoResource is a proposed bot+tab URI, not a live setting.")
        report["expectedSsoResource"] = resource
        try:
            report["authApp"] = rest_get(f"https://graph.microsoft.com/v1.0/applications(appId='{app_id}')?$select={APP_SELECT}")
        except AuditError as error:
            incomplete(report, "Entra authentication app", error)
        try:
            graph = graph_list("servicePrincipals", **{"$filter": f"appId eq '{GRAPH_APP_ID}'", "$select": "id,oauth2PermissionScopes"})
            service_principals = graph_list("servicePrincipals", **{"$filter": f"appId eq '{app_id}'", "$select": "id"})
            if len(graph) != 1 or len(service_principals) != 1:
                raise AuditError("Could not uniquely resolve Graph and authentication service principals")
            report["graphServicePrincipalId"] = graph[0]["id"]
            report["graphPermissions"] = {s["id"]: s["value"] for s in graph[0].get("oauth2PermissionScopes") or []}
            report["consent"] = graph_list("oauth2PermissionGrants", **{
                "$filter": f"clientId eq '{service_principals[0]['id']}'", "$select": "consentType,resourceId,scope"})
        except AuditError as error:
            incomplete(report, "Graph permission/consent metadata", error)
    else:
        incomplete(report, "SSO authentication app", AuditError("No OAuth client ID available; supply --auth-app-id for a proposed setup"))
    try:
        if args.embedded_manifest and not args.manifest:
            manifest = args.embedded_manifest
            report["manifestSource"] = "Setup-page download snapshot; re-download after deploying configuration changes"
        elif args.manifest:
            manifest = json.loads(args.manifest.read_text())
            report["manifestSource"] = str(args.manifest)
        else:
            manifest_url = args.base_url + "/office-addin/teams/manifest.json"
            manifest = command_json(["curl", "--silent", "--show-error", "--fail", "--max-time", "30", manifest_url])
            report["manifestSource"] = manifest_url
        if not isinstance(manifest, dict) or not isinstance(manifest.get("webApplicationInfo"), dict):
            raise AuditError("Response is not a Teams manifest")
        report["manifest"] = {key: manifest.get(key) for key in ("id", "version", "bots", "webApplicationInfo", "validDomains")}
    except (AuditError, OSError, ValueError) as error:
        incomplete(report, "Teams manifest", error)
    evaluate(report, args)
    report["notes"].extend([
        "Read-only audit: no cloud settings, credentials, Helm values or installed Teams apps were changed.",
        "The generated/downloaded manifest does not prove which package is installed in Teams.",
        "Consent metadata does not prove the OAuth secret is valid or that silent sign-in succeeds. Test the connection and the Teams client.",
        "This helper targets public Azure and the global Bot Framework token service; regional/sovereign endpoints need their matching configuration.",
    ])
    report.pop("graphPermissions", None)
    report["exitCode"] = 2 if any(c["status"] == "UNKNOWN" for c in report["checks"]) else int(any(c["status"] == "MISSING" for c in report["checks"]))
    return report


def print_report(report: dict) -> None:
    print(f"Teams bot audit: {report['environment']} ({report['checkedAt']})")
    for check in report["checks"]:
        print(f"{check['status']:7} {check['name']}: {check['detail']}")
    if report.get("authAppId"):
        print("\nProposed/existing SSO settings (merge into the existing bot section):")
        print('[integrations.ms_office.teams.bot]')
        print(f'oauth_connection_name = {json.dumps(report["connectionName"])}')
        print(f'sso_app_id = {json.dumps(report["authAppId"])}')
        print(f'sso_resource = {json.dumps(report["expectedSsoResource"])}')
    for note in report["notes"]:
        print(f"\nNote: {note}")
    if "ssoPlan" in report:
        print("\nSSO change plan (not applied):")
        print(json.dumps(report["ssoPlan"], indent=2))


def app_sso_patch(app: dict, resource: str, graph_scope_ids: dict[str, str]) -> dict:
    """Add SSO settings, preserving all existing scopes, redirects and permissions."""
    desired = deepcopy(app)
    uris = desired.setdefault("identifierUris", [])
    if resource not in uris:
        uris.append(resource)
    api = desired.setdefault("api", {})
    api["requestedAccessTokenVersion"] = 2
    scopes = api.setdefault("oauth2PermissionScopes", [])
    scope = next((s for s in scopes if s.get("value") == "access_as_user"), None)
    if scope is None:
        scope = {
            "id": str(uuid5(NAMESPACE_URL, app["appId"] + "/access_as_user")),
            "value": "access_as_user", "type": "User", "isEnabled": True,
            "adminConsentDisplayName": "Access Erato as the signed-in user",
            "adminConsentDescription": "Allow Microsoft Teams to sign the user in to Erato.",
            "userConsentDisplayName": "Access Erato as you",
            "userConsentDescription": "Allow Microsoft Teams to sign you in to Erato.",
        }
        scopes.append(scope)
    else:
        scope["isEnabled"] = True
    preauthorized = api.setdefault("preAuthorizedApplications", [])
    for app_id in TEAMS_CLIENTS.values():
        client = next((c for c in preauthorized if c.get("appId") == app_id), None)
        if client is None:
            client = {"appId": app_id, "delegatedPermissionIds": []}
            preauthorized.append(client)
        if scope["id"] not in client["delegatedPermissionIds"]:
            client["delegatedPermissionIds"].append(scope["id"])
    web = desired.setdefault("web", {})
    redirects = web.setdefault("redirectUris", [])
    callback = "https://token.botframework.com/.auth/web/redirect"
    if callback not in redirects:
        redirects.append(callback)
    access = desired.setdefault("requiredResourceAccess", [])
    graph = next((a for a in access if a.get("resourceAppId") == GRAPH_APP_ID), None)
    if graph is None:
        graph = {"resourceAppId": GRAPH_APP_ID, "resourceAccess": []}
        access.append(graph)
    for name in sorted(GRAPH_SCOPES):
        if name not in graph_scope_ids:
            raise AuditError(f"Graph delegated scope could not be resolved: {name}")
        permission = {"id": graph_scope_ids[name], "type": "Scope"}
        if permission not in graph["resourceAccess"]:
            graph["resourceAccess"].append(permission)
    change = {key: desired[key] for key in ("identifierUris", "api", "web", "requiredResourceAccess")
              if desired[key] != app.get(key)}
    if "web" in change:
        # Graph can return additional fields such as redirectUriSettings that are
        # not writable webApplication properties. Preserve the documented settings.
        change["web"] = {k: v for k, v in change["web"].items()
                         if k in ("homePageUrl", "implicitGrantSettings", "logoutUrl", "redirectUris")}
    return change


def connection_matches(connection: dict, desired: dict) -> bool:
    properties = connection.get("properties") or {}
    params = {p["key"]: p.get("value") for p in properties.get("parameters") or []}
    return (all(properties.get(k) == desired[k] for k in ("clientId", "serviceProviderId"))
            and set(desired["scopes"].split()) <= set((properties.get("scopes") or "").split())
            and all(params.get(p["key"]) == p["value"] for p in desired["parameters"]))


def sso_plan(report: dict, args: argparse.Namespace) -> dict:
    if any(c["status"] == "UNKNOWN" for c in report["checks"]):
        raise AuditError("Complete the read-only audit before planning/applying SSO; UNKNOWN checks remain")
    app = report.get("authApp")
    bot = report.get("bot")
    if not app or not bot or not report.get("manifest"):
        raise AuditError("An existing bot, authentication app and readable Teams manifest are required")
    failed_basics = {"CLI tenant", "bot tenant", "single-tenant bot", "bot identity", "Teams channel",
                     "messaging endpoint", "manifest bot ID", "authentication app tenant type"}
    if any(c["name"] in failed_basics and c["status"] != "PASS" for c in report["checks"]):
        raise AuditError("Bot identity, tenant, channel, endpoint and manifest must agree before applying SSO")
    web = report["manifest"].get("webApplicationInfo") or {}
    if web.get("nestedAppAuthInfo") and web.get("id") != args.auth_app_id:
        raise AuditError("Combined tab/bot: select the current tab's Entra app with --auth-app-id to preserve NAA identity")
    graph = graph_list("servicePrincipals", **{"$filter": f"appId eq '{GRAPH_APP_ID}'", "$select": "oauth2PermissionScopes"})
    if len(graph) != 1:
        raise AuditError("Could not resolve Microsoft Graph permission definitions")
    scope_ids = {s["value"]: s["id"] for s in graph[0].get("oauth2PermissionScopes") or [] if s.get("isEnabled")}
    properties = {
        "clientId": args.auth_app_id, "serviceProviderId": AAD_V2_PROVIDER,
        "scopes": " ".join(sorted(GRAPH_SCOPES)),
        "parameters": [{"key": "tenantId", "value": args.tenant_id},
                       {"key": "tokenExchangeUrl", "value": report["expectedSsoResource"]}],
    }
    existing = report.get("connection")
    if existing and not connection_matches(existing, properties):
        raise AuditError("The selected OAuth connection already exists with different settings. "
                         "Use a new connection name or reconcile it manually; the helper will not overwrite it.")
    return {"authAppId": args.auth_app_id, "authAppObjectId": app["id"],
            "botResourceId": report["botResourceId"], "connectionName": args.connection,
            "applicationPatch": app_sso_patch(app, report["expectedSsoResource"], scope_ids),
            "createConnection": existing is None, "connectionProperties": properties,
            "credentialLifetimeDays": 365,
            "remainingSteps": ["Grant tenant admin consent for any additional delegated Graph permissions.",
                               "Set oauth_connection_name, sso_app_id and sso_resource in the deployment; bump the package version.",
                               "Deploy and upload the updated Teams package; test bot SSO and the existing tab/add-ins."]}


def apply_sso(args: argparse.Namespace) -> dict:
    """No bot identity changes, existing connection updates, secret reads or consent grants."""
    # Re-read and re-plan just before writing so another environment's URI is preserved.
    fresh = audit(args)
    plan = sso_plan(fresh, args)
    result = {"authAppId": plan["authAppId"], "connectionName": plan["connectionName"], "changes": []}
    app_url = f"https://graph.microsoft.com/v1.0/applications/{plan['authAppObjectId']}"
    if plan["applicationPatch"]:
        rest_write("PATCH", app_url, plan["applicationPatch"])
        result["changes"].append("Added Entra SSO settings and any missing delegated Graph permissions")
    if plan["createConnection"]:
        expires = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(timespec="seconds").replace("+00:00", "Z")
        label = f"Erato Teams SSO {args.bot_name}/{args.connection}"
        credential = rest_write("POST", app_url + "/addPassword", {
            "passwordCredential": {"displayName": label, "endDateTime": expires}})
        key_id = credential.get("keyId", "unknown")
        secret = credential.pop("secretText", None)
        if not secret:
            raise AuditError(f"Entra did not return a new secret; inspect credential {key_id} on app {args.auth_app_id}")
        body = {"location": fresh["bot"].get("location") or "global", "properties": deepcopy(plan["connectionProperties"])}
        body["properties"]["clientSecret"] = secret
        try:
            url = ("https://management.azure.com" + plan["botResourceId"] + "/connections/"
                   + quote(args.connection, safe="") + "?api-version=2022-09-15")
            rest_write("PUT", url, body, CONNECTION_QUERY)
        except AuditError as error:
            raise AuditError(f"OAuth creation did not complete cleanly after adding credential {key_id} "
                             f"({label}) to app {args.auth_app_id}. Entra changes may be applied. "
                             "Inspect the connection before retrying or removing that credential. " + str(error)) from error
        finally:
            body["properties"].pop("clientSecret", None)
            secret = None
        result["credential"] = {"keyId": key_id, "displayName": label, "expiresAt": expires}
        result["changes"].append("Created OAuth connection with a dedicated credential; existing credentials retained")
    result["remainingSteps"] = plan["remainingSteps"]
    result["note"] = "Azure/Entra SSO setup only. Erato deployment, admin consent and Teams installation are separate."
    return result


def main(arguments: list[str] | None = None, deployment: dict | None = None) -> int:
    args = parse_args(arguments, deployment)
    for binary in ("az", "curl"):
        if not shutil.which(binary):
            print(f"Required command missing: {binary}", file=sys.stderr)
            return 2
    try:
        if args.discover:
            discover_bot(args)
        report = audit(args)
        if args.plan_sso or args.apply_sso:
            plan = sso_plan(report, args)
            if args.apply_sso:
                # --apply-sso is the operator's explicit authorization; never implied by audit/plan.
                result = apply_sso(args)
                print(json.dumps(result, indent=2))
                return 0
            report["ssoPlan"] = plan
    except AuditError as error:
        message = str(error)
        if args.apply_sso:
            message += " SSO setup may have partially completed; inspect current state before retrying."
        if args.json:
            print(json.dumps({"error": message, "exitCode": 2}))
        else:
            print(f"{'SSO setup failed' if args.apply_sso else 'Audit incomplete'}: {message}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_report(report)
    return report["exitCode"]


if __name__ == "__main__":
    sys.exit(main(deployment=json.loads(os.environ.get("ERATO_TEAMS_SETUP", "null"))))
