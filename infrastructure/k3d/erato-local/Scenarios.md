# K3D Test Scenarios

This document describes the test scenarios available for e2e testing in the k3d environment. Each scenario configures the Erato deployment differently to test specific features or behaviors.

## Available Scenarios

### `basic` - Default Test Scenario

**Configuration File:** `config/erato.scenario-basic.toml`

The default scenario with standard Erato configuration. This is the baseline scenario for general purpose testing that doesn't require special feature flags or configuration.

### `tight-budget` - Budget Enforcement Testing

**Configuration File:** `config/erato.scenario-tight-budget.toml`

Configures budget tracking with an extremely low budget limit and artificially high token costs. This allows testing budget warnings and enforcement without consuming significant real resources. Budget tracking is enabled with thresholds that trigger warnings and errors during normal test execution.

### `assistants` - Assistants Feature Testing

**Configuration File:** `config/erato.scenario-assistants.toml`

Enables the assistants feature. This allows testing assistant creation, management, and usage workflows including file attachments and assistant-specific chat contexts.

Also enables in-chat delegation, which needs a scripted delegate: the mock LLM is the sole chat provider here, because a delegated child inherits the first entry of `priority_order` rather than the parent's provider. A mock MCP server gives the delegate a real tool to call.

### `approvals` - Parked Approval Testing

**Configuration File:** `config/erato.scenario-approvals.toml`

`assistants` plus the approval half of `many-models`, because neither drives a
parked approval on its own: `assistants` has the task route and the mock LLM as
sole chat provider (so a parent and its child are both scriptable) but no
approval configuration, while `many-models` has the restrictive preset and the
gated mock MCP server but no tasks and a live default model, which answers the
child turn itself.

Approval is deliberately not enabled inside `assistants`: its specs complete the
calls this scenario parks on. The gated server is left out of the planning
facet's allowlist, so while a turn is narrowed to that facet a call under
decision can only have come from a task child. A turn with no facet selected
reaches every authorized server, which is how the same scenario also drives a
gated call the origin chat makes itself.

It offers both task run modes, which is what lets one scenario drive both
places a child can raise a question. An awaited child asks in the slot it holds
on the origin turn; a detached (`async`) child has no such slot and asks on its
own card, with the origin told about it by a delivered `task_result` row and
told the answer by a second one. Offering `async` also un-inerts the shipped
`[delegation.tasks.approval]` default, so every detached dispatch here is asked
about before it happens — which is that default's whole purpose and is only
reachable in a deployment that offers the mode.

It carries two planning facets rather than one. `plan` overrides nothing, so a
turn under it runs the shipped global `[delegation.tasks.approval]` default
`async_only`; `plan_gate` sets `mode = "plan"` through
`[facets.facets.plan_gate.delegation.approval]`. The dispatch-approval policy is
per-deployment configuration, and a second scenario for it would cost a cluster
switch and a CI matrix entry, so the two facets express the two policies inside
one scenario — selecting one or the other is then the only difference between a
planned batch that parks and the same batch that dispatches.

### `many-models` - Model Selector Testing

**Configuration File:** `config/erato.scenario-many-models.toml`

Configures a large set of chat models to validate model selector behavior (menu size, scrolling, selection) in the UI.

### `multi-replica` - Shared Streaming State Testing

**Configuration File:** `config/erato.scenario-multi-replica.toml`

Deploys two backend replicas and enables the mock-LLM provider. The dedicated
E2E test keeps a long-running generation active while reloading the page five
times, exercising cross-replica event replay through the Kubernetes Service.
The scenario also enables the Erato intermediate load balancer; setup installs
Traefik's standard Kubernetes Ingress provider while retaining nginx as the
cluster's external ingress.

## Scenario Infrastructure

### Directory Structure

```
infrastructure/k3d/erato-local/
├── config/
│   ├── erato.toml                          # Base configuration
│   ├── erato.scenario-basic.toml           # Basic scenario config
│   ├── erato.scenario-tight-budget.toml    # Tight-budget scenario config
│   ├── erato.scenario-assistants.toml      # Assistants scenario config
│   ├── erato.scenario-approvals.toml       # Approvals scenario config
│   └── erato.scenario-many-models.toml     # Many-models scenario config
├── templates/
│   └── erato-test-scenario-configmap.yaml  # Mounts scenario TOML as ConfigMap
├── Chart.yaml
├── values.yaml                              # Contains testScenarioConfig settings
└── Scenarios.md                             # This file
```

### Scenario Switching

Scenarios can be switched using the `switch-test-scenario` script:

```bash
infrastructure/scripts/switch-test-scenario --scenario <scenario-name>
```

Valid scenario names: `basic`, `tight-budget`, `assistants`, `approvals`, `many-models`, `multi-replica`

The script:
1. Validates the scenario name
2. Updates the Helm deployment with the new scenario config file
3. Waits for the Kubernetes deployment to complete rollout
4. The new scenario takes effect immediately

### Automatic Scenario Management in Tests

E2E tests automatically detect and switch to the correct scenario using the `ensureTestScenario()` function from `tests/shared.ts`.

The test setup files handle scenario switching:
- `tests/basic.setup.ts` - Switches to basic scenario
- `tests/tight-budget.setup.ts` - Switches to tight-budget scenario
- `tests/assistants.setup.ts` - Switches to assistants scenario
- `tests/many-models.setup.ts` - Switches to many-models scenario

Tests are organized by scenario using Playwright project dependencies:
- Tests matching `*.tight-budget.spec.ts` depend on `setup-tight-budget`
- Tests matching `*.assistants.spec.ts` depend on `setup-assistants`
- Tests matching `*.many-models.spec.ts` depend on `setup-many-models`
- All other tests depend on `setup-basic`

## Adding a New Scenario

To add a new test scenario:

1. **Create the scenario config file:**
   ```bash
   touch infrastructure/k3d/erato-local/config/erato.scenario-<name>.toml
   ```

2. **Add your configuration:**
   ```toml
   # Your scenario-specific configuration here

   [frontend.additional_environment]
   K3D_TEST_SCENARIO = "<name>"
   ```

3. **Register the scenario in `k3d_common.py`:**
   ```python
   VALID_SCENARIOS = ["basic", "tight-budget", "assistants", "<name>"]
   ```

   Also add it to the scenario list in
   `templates/erato-scenario-secrets.yaml`. That range is what creates the
   Secret holding the generated `.auto.toml`, and `setup-dev` mounts that
   Secret by name - a scenario missing from the list fails the install on a
   secret that does not exist.

4. **Create a setup file:**
   ```typescript
   // e2e-tests/tests/<name>.setup.ts
   import { test as setup } from "@playwright/test";
   import { ensureTestScenario } from "./shared";

   setup("switch to <name> scenario", async ({ page }) => {
     await ensureTestScenario(page, "<name>");
   });
   ```

5. **Update TypeScript types in `shared.ts`:**
   ```typescript
   requiredScenario: "basic" | "tight-budget" | "assistants" | "<name>"
   ```

6. **Add Playwright projects in `playwright.config.ts`:**
   ```typescript
   {
     name: "setup-<name>",
     testMatch: /<name>\.setup\.ts/,
     use: { storageState: "playwright/.auth/user.json" },
     dependencies: ["setup"],
   },
   {
     name: "chromium-<name>",
     testMatch: /.*\.<name>\.spec\.ts$/,
     use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
     dependencies: ["setup-<name>"],
   },
   ```

7. **Update CI workflow** (`.github/workflows/docker-build.yml`):
   ```yaml
   strategy:
     matrix:
       scenario: [basic, tight-budget, assistants, <name>]
       projects: ["-p chromium-basic", "-p chromium-tight-budget", "-p chromium-assistants", "-p chromium-<name>"]
   ```

8. **Document the scenario** in this file.

## Scenario Detection

Tests can detect the current scenario at runtime by checking the `K3D_TEST_SCENARIO` environment variable exposed to the frontend:

```typescript
const scenario = await page.evaluate(() => {
  return (window as any).K3D_TEST_SCENARIO;
});
```

This allows tests to:
- Verify they're running in the correct scenario
- Automatically switch scenarios if needed
- Adapt test behavior based on the scenario
