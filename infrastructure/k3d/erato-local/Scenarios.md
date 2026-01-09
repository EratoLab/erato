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

Enables the experimental assistants feature. This allows testing assistant creation, management, and usage workflows including file attachments and assistant-specific chat contexts.

## Scenario Infrastructure

### Directory Structure

```
infrastructure/k3d/erato-local/
├── config/
│   ├── erato.toml                          # Base configuration
│   ├── erato.scenario-basic.toml           # Basic scenario config
│   ├── erato.scenario-tight-budget.toml    # Tight-budget scenario config
│   └── erato.scenario-assistants.toml      # Assistants scenario config
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

Valid scenario names: `basic`, `tight-budget`, `assistants`

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

Tests are organized by scenario using Playwright project dependencies:
- Tests matching `*.tight-budget.spec.ts` depend on `setup-tight-budget`
- Tests matching `*.assistants.spec.ts` depend on `setup-assistants`
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
