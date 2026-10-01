# Teams bot setup helper

Customers enter through `/office-addin/setup` → **Teams**. The page generates a
self-contained `erato-teams-setup.sh` download from this Python source and the
rendered manifest. They upload it to Azure Cloud Shell (Bash), which already has
the required runtime and Azure CLI. No local installation or private repository
access is part of customer setup.

The implementation remains Python because it handles JSON merge/preservation and
uses only the standard library. `src/pages/teamsBotSetup.ts` owns the Bash wrapper
and deployment defaults. The manifest is a snapshot, and the page cannot infer
the current OAuth connection name from it; that input must be checked by the admin.

- Default: audit the current connection; no cloud writes.
- `--plan-sso`: preview additive SSO changes for a separate OAuth connection.
- `--apply-sso`: explicitly apply the reviewed Entra/Azure changes. Admin consent,
  Erato deployment and Teams package installation remain operator steps.

The helper supports existing single-tenant bots in public Azure using the global
Bot Framework token service. It intentionally does not migrate bot identities,
create bot resources, overwrite conflicting connections or grant consent.

Run offline checks from the repository root:

```sh
python3 -m unittest discover -s office-addin/scripts/teams-bot/tests -v
```

The Office add-in tests cover wrapper quoting and package identity handling.
Customer instructions live in `site/content/docs/integrations/ms_teams.mdx`.
