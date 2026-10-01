"""Offline tests for tenant isolation, additive changes and credential handling."""

from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("support", Path(__file__).resolve().parents[1] / "teams_bot_support.py")
support = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(support)

APP = "11111111-1111-1111-1111-111111111111"
CLI = ["--tenant-id", APP, "--subscription-id", APP, "--resource-group", "group",
       "--bot-name", "bot", "--base-url", "https://example.com", "--expected-bot-app-id", APP]
RESOURCE = "api://example.com/botid-" + APP
SCOPE_IDS = {name: f"permission-{index}" for index, name in enumerate(sorted(support.GRAPH_SCOPES))}


def application():
    return {
        "id": "object-id", "appId": APP, "signInAudience": "AzureADMyOrg",
        "identifierUris": ["api://existing-resource"],
        "api": {"requestedAccessTokenVersion": 1, "knownClientApplications": ["another-app"],
                "oauth2PermissionScopes": [{"id": "existing-scope", "value": "existing", "isEnabled": True}],
                "preAuthorizedApplications": [{"appId": support.TEAMS_CLIENTS["web"],
                                               "delegatedPermissionIds": ["existing-scope"]}]},
        "web": {"redirectUris": ["https://example.com/oauth2/callback"], "homePageUrl": "https://example.com"},
        "spa": {"redirectUris": ["brk-multihub://example.com"]},
        "requiredResourceAccess": [{"resourceAppId": "another-api", "resourceAccess": [{"id": "keep", "type": "Role"}]}],
    }


class SsoPatchTests(unittest.TestCase):
    def test_preserves_existing_application_settings(self):
        app = application()
        before = deepcopy(app)
        change = support.app_sso_patch(app, RESOURCE, SCOPE_IDS)
        self.assertEqual(app, before)
        self.assertNotIn("spa", change)
        self.assertEqual(change["identifierUris"], ["api://existing-resource", RESOURCE])
        self.assertIn("https://example.com/oauth2/callback", change["web"]["redirectUris"])
        self.assertEqual(change["web"]["homePageUrl"], "https://example.com")
        self.assertEqual(change["api"]["knownClientApplications"], ["another-app"])
        self.assertEqual(change["requiredResourceAccess"][0], before["requiredResourceAccess"][0])
        self.assertIn("existing-scope", change["api"]["preAuthorizedApplications"][0]["delegatedPermissionIds"])

    def test_second_environment_keeps_first_uri_and_scope_id(self):
        app = application()
        app.update(support.app_sso_patch(app, RESOURCE, SCOPE_IDS))
        first_scope = next(s for s in app["api"]["oauth2PermissionScopes"] if s["value"] == "access_as_user")
        second_uri = "api://staging.example.com/botid-" + APP
        second = support.app_sso_patch(app, second_uri, SCOPE_IDS)
        self.assertEqual(set(second), {"identifierUris"})
        self.assertIn(RESOURCE, second["identifierUris"])
        app.update(second)
        self.assertEqual(support.app_sso_patch(app, RESOURCE, SCOPE_IDS), {})
        self.assertEqual(next(s for s in app["api"]["oauth2PermissionScopes"] if s["value"] == "access_as_user"), first_scope)

    def test_existing_scope_id_and_consent_text_are_preserved(self):
        app = application()
        app["api"]["oauth2PermissionScopes"].append({"id": "keep-this-id", "value": "access_as_user", "isEnabled": False,
                                                    "adminConsentDisplayName": "Customer wording"})
        change = support.app_sso_patch(app, RESOURCE, SCOPE_IDS)
        scope = next(s for s in change["api"]["oauth2PermissionScopes"] if s["value"] == "access_as_user")
        self.assertTrue(scope["isEnabled"])
        self.assertEqual(scope["id"], "keep-this-id")
        self.assertEqual(scope["adminConsentDisplayName"], "Customer wording")

    def test_missing_permission_definition_fails_before_writing(self):
        with self.assertRaises(support.AuditError):
            support.app_sso_patch(application(), RESOURCE, {})


class AuditSafetyTests(unittest.TestCase):
    def test_wrong_tenant_stops_before_any_resource_access(self):
        args = support.parse_args(CLI)
        with patch.object(support, "az_json", return_value={"tenantId": "wrong-tenant"}), \
                patch.object(support, "rest_get") as api:
            with self.assertRaisesRegex(support.AuditError, "Wrong CLI tenant"):
                support.audit(args)
            api.assert_not_called()

    def test_default_mode_does_not_apply(self):
        report = {"exitCode": 1}
        with patch.object(support.shutil, "which", return_value="/bin/tool"), \
                patch.object(support, "audit", return_value=report), \
                patch.object(support, "apply_sso") as apply, \
                patch.object(support, "rest_write") as write, \
                patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(support.main([*CLI, "--json"]), 1)
            apply.assert_not_called()
            write.assert_not_called()

    def test_plan_does_not_apply(self):
        report = {"exitCode": 1}
        args = [*CLI, "--auth-app-id", APP, "--connection", "graph-sso", "--plan-sso", "--json"]
        with patch.object(support.shutil, "which", return_value="/bin/tool"), \
                patch.object(support, "audit", return_value=report), \
                patch.object(support, "sso_plan", return_value={"createConnection": True}), \
                patch.object(support, "rest_write") as write, \
                patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(support.main(args), 1)
            write.assert_not_called()

    def test_current_graph_connection_cannot_be_applied(self):
        with patch("sys.stderr", new_callable=io.StringIO), self.assertRaises(SystemExit):
            support.parse_args([*CLI, "--auth-app-id", APP, "--connection", "graph", "--apply-sso"])

    def test_consent_for_other_api_does_not_count(self):
        report = {"checks": [], "notes": [], "graphServicePrincipalId": "graph-sp",
                  "consent": [{"consentType": "AllPrincipals", "resourceId": "other-api",
                               "scope": " ".join(support.GRAPH_SCOPES)}]}
        support.evaluate(report, support.parse_args(CLI))
        self.assertEqual(report["checks"][0]["status"], "MISSING")

    def test_api_error_does_not_print_secret_body(self):
        response = subprocess.CompletedProcess([], 1, "", "ERROR Forbidden body contains SUPER_SECRET")
        with patch.object(support.subprocess, "run", return_value=response):
            with self.assertRaises(support.AuditError) as caught:
                support.command_json(["az", "rest"])
        self.assertNotIn("SUPER_SECRET", str(caught.exception))
        self.assertIn("access denied", str(caught.exception))


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.args = support.parse_args([*CLI, "--auth-app-id", APP,
                                       "--connection", "graph-sso", "--apply-sso"])
        self.plan = {"authAppId": APP, "authAppObjectId": "object-id", "connectionName": "graph-sso",
                     "applicationPatch": {"identifierUris": [RESOURCE]}, "createConnection": True,
                     "botResourceId": "/subscriptions/example/resourceGroups/group/providers/Microsoft.BotService/botServices/bot",
                     "connectionProperties": {"clientId": APP}, "remainingSteps": ["Grant consent"]}

    def test_secret_goes_only_to_new_connection_and_is_not_in_report(self):
        writes = []
        def write(method, url, body, query=None):
            writes.append((method, url, deepcopy(body)))
            if url.endswith("/addPassword"):
                return {"keyId": "new-key", "secretText": "SUPER_SECRET"}
            return {}
        with patch.object(support, "audit", return_value={"bot": {"location": "global"}}), \
                patch.object(support, "sso_plan", return_value=self.plan), \
                patch.object(support, "rest_write", side_effect=write):
            result = support.apply_sso(self.args)
        self.assertEqual([w[0] for w in writes], ["PATCH", "POST", "PUT"])
        self.assertTrue(writes[2][1].endswith("/connections/graph-sso?api-version=2022-09-15"))
        self.assertEqual(writes[2][2]["properties"]["clientSecret"], "SUPER_SECRET")
        self.assertNotIn("SUPER_SECRET", json.dumps(result))
        self.assertEqual(result["credential"]["keyId"], "new-key")
        self.assertFalse(any("oauth2PermissionGrants" in w[1] for w in writes))

    def test_repeated_apply_does_not_create_another_credential(self):
        self.plan.update(applicationPatch={}, createConnection=False)
        with patch.object(support, "audit", return_value={"bot": {"location": "global"}}), \
                patch.object(support, "sso_plan", return_value=self.plan), \
                patch.object(support, "rest_write") as write:
            support.apply_sso(self.args)
            write.assert_not_called()

    def test_failed_connection_reports_credential_id_without_secret(self):
        def write(method, url, body, query=None):
            if url.endswith("/addPassword"):
                return {"keyId": "new-key", "secretText": "SUPER_SECRET"}
            if method == "PUT":
                raise support.AuditError("request failed")
            return {}
        with patch.object(support, "audit", return_value={"bot": {"location": "global"}}), \
                patch.object(support, "sso_plan", return_value=self.plan), \
                patch.object(support, "rest_write", side_effect=write):
            with self.assertRaises(support.AuditError) as caught:
                support.apply_sso(self.args)
        self.assertIn("new-key", str(caught.exception))
        self.assertNotIn("SUPER_SECRET", str(caught.exception))

    def test_existing_connection_with_different_identity_is_rejected(self):
        args = support.parse_args([*CLI, "--auth-app-id", APP,
                                   "--connection", "graph-sso", "--plan-sso"])
        report = {"checks": [], "authApp": application(), "bot": {"name": "bot"},
                  "manifest": {"webApplicationInfo": {"id": APP, "nestedAppAuthInfo": [{}]}},
                  "botResourceId": "bot-resource", "expectedSsoResource": RESOURCE,
                  "connection": {"properties": {"clientId": "some-other-app"}}}
        graph = [{"oauth2PermissionScopes": [{"value": name, "id": id_, "isEnabled": True}
                                             for name, id_ in SCOPE_IDS.items()]}]
        with patch.object(support, "graph_list", return_value=graph), \
                patch.object(support, "rest_write") as write:
            with self.assertRaisesRegex(support.AuditError, "already exists with different settings"):
                support.sso_plan(report, args)
            write.assert_not_called()

    def test_tab_identity_mismatch_prevents_sso_apply(self):
        report = {"checks": [], "authApp": application(), "bot": {"name": "bot"},
                  "manifest": {"webApplicationInfo": {"id": "current-tab-app", "nestedAppAuthInfo": [{}]}}}
        with self.assertRaisesRegex(support.AuditError, "preserve NAA identity"):
            support.sso_plan(report, self.args)


class DeliveryTests(unittest.TestCase):
    def deployment(self):
        return {"baseUrl": "https://example.com", "botId": APP, "authAppId": APP,
                "ssoResource": RESOURCE, "currentConnection": "custom-old", "ssoConnection": "custom-new",
                "manifest": {"webApplicationInfo": {"id": APP}}}

    def test_download_defaults_to_audit_and_uses_separate_connection_for_setup(self):
        audit = support.parse_args([], self.deployment())
        self.assertFalse(audit.apply_sso)
        self.assertTrue(audit.discover)
        self.assertEqual(audit.connection, "custom-old")
        plan = support.parse_args(["--plan-sso"], self.deployment())
        self.assertEqual(plan.connection, "custom-new")
        self.assertEqual(plan.embedded_manifest, self.deployment()["manifest"])
        with patch("sys.stderr", new_callable=io.StringIO), self.assertRaises(SystemExit):
            support.parse_args(["--apply-sso", "--connection", "custom-old"], self.deployment())

    def test_discovery_stops_before_api_access_for_wrong_tenant_or_cloud(self):
        for account in ({"tenantId": APP, "environmentName": "AzureUSGovernment"},
                        {"tenantId": "different", "environmentName": "AzureCloud"}):
            args = support.parse_args(["--tenant-id", APP], self.deployment())
            with patch.object(support, "az_json", return_value=account), patch.object(support, "rest_get") as api:
                with self.assertRaises(support.AuditError):
                    support.discover_bot(args)
                api.assert_not_called()

    def test_discovery_requires_unique_bot_and_restricts_subscription(self):
        args = support.parse_args([], self.deployment())
        account = {"tenantId": APP, "id": APP, "environmentName": "AzureCloud"}
        bot = {"appId": APP, "id": f"/subscriptions/{APP}/resourceGroups/my-group/providers/Microsoft.BotService/botServices/my-bot"}
        with patch.object(support, "az_json", return_value=account), \
                patch.object(support, "rest_get", return_value={"value": [bot]}) as get:
            support.discover_bot(args)
        self.assertEqual((args.resource_group, args.bot_name), ("my-group", "my-bot"))
        self.assertIn(f"/subscriptions/{APP}/", get.call_args.args[0])
        for values in ([], [bot, bot]):
            args = support.parse_args([], self.deployment())
            with patch.object(support, "az_json", return_value=account), \
                    patch.object(support, "rest_get", return_value={"value": values}), \
                    self.assertRaises(support.AuditError):
                support.discover_bot(args)


if __name__ == "__main__":
    unittest.main()
