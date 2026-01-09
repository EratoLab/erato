# E2E Tests

End-to-end tests for Erato using [Playwright](https://playwright.dev/).

## Getting Started

### Prerequisites

- Node.js 22.10.0 or later
- pnpm
- A running Erato instance (k3d cluster or local development)

### Installation

```bash
pnpm install
pnpm exec playwright install chromium firefox
```

### Running Tests

#### Run all tests

```bash
pnpm exec playwright test
```

#### Run tests for a specific browser

```bash
pnpm exec playwright test --project=chromium-basic
pnpm exec playwright test --project=firefox-basic
```

#### Run tests with UI mode

```bash
pnpm exec playwright test --ui
```

#### Run tests in headed mode (see browser)

```bash
pnpm exec playwright test --headed
```

#### Run specific test file

```bash
pnpm exec playwright test tests/chat.spec.ts
```

#### Run only CI-tagged tests

```bash
pnpm exec playwright test --grep @ci
```

## Test Organization

Tests are organized by scenario. Each scenario configures Erato differently to test specific features or behaviors.

### Test Scenarios

See [Scenarios Documentation](../infrastructure/k3d/erato-local/Scenarios.md) for detailed information about available test scenarios.

**Quick Overview:**

- **`basic`** - Default scenario for general testing
- **`tight-budget`** - Budget enforcement testing with low limits
- **`assistants`** - Tests for the experimental assistants feature

### Test File Naming Convention

Test files are named according to the scenario they require:

- `*.spec.ts` - Runs in the `basic` scenario (default)
- `*.tight-budget.spec.ts` - Runs in the `tight-budget` scenario
- `*.assistants.spec.ts` - Runs in the `assistants` scenario

### Setup Files

Each scenario has a setup file that ensures the k3d cluster is configured correctly:

- `auth.setup.ts` - Base authentication setup (runs first)
- `basic.setup.ts` - Switches to basic scenario
- `tight-budget.setup.ts` - Switches to tight-budget scenario
- `assistants.setup.ts` - Switches to assistants scenario

## Configuration

### Environment Variables

Create a `.env` file in the `e2e-tests` directory:

```bash
BASE_URL=https://app.erato.internal  # For k3d testing
# or
BASE_URL=http://localhost:4180       # For local development
```

### Playwright Configuration

Test configuration is in `playwright.config.ts`. Key settings:

- **Projects**: Organized by browser and scenario (e.g., `chromium-basic`, `firefox-assistants`)
- **Workers**: CI runs with 1 worker, local runs use all available
- **Retries**: CI retries failed tests 2 times, local doesn't retry
- **Timeout**: Default timeout is 30 seconds per test

## Writing Tests

### Test Structure

```typescript
import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat } from "./shared";

test("My test", { tag: TAG_CI }, async ({ page }) => {
  await page.goto("/");
  await chatIsReadyToChat(page);

  // Your test logic here
});
```

### Tagging Tests

Tests can be tagged with `@ci` to indicate they should run in CI:

```typescript
test("Important test", { tag: TAG_CI }, async ({ page }) => {
  // This test will run in CI
});
```

Tests without the `@ci` tag will only run locally.

### Helper Functions

Common test helpers are in `tests/shared.ts`:

- `chatIsReadyToChat(page)` - Wait for chat UI to be ready
- `ensureTestScenario(page, scenario)` - Switch to a specific scenario
- `ensureOpenSidebar(page)` - Open the sidebar if collapsed
- `login(page, email, password)` - Log in a user
- `createAuthenticatedContext(browser, email)` - Create a new browser context with auth

### Scenario-Specific Tests

For tests requiring a specific scenario:

1. Name your test file with the scenario suffix: `myfeature.assistants.spec.ts`
2. The test will automatically run in the correct scenario via Playwright project dependencies

```typescript
// tests/myfeature.assistants.spec.ts
import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";

test("Test assistants feature", { tag: TAG_CI }, async ({ page }) => {
  // This test will automatically run in the assistants scenario
  await page.goto("/assistants");
  // ...
});
```

## CI Integration

Tests run automatically in CI via GitHub Actions (`.github/workflows/docker-build.yml`).

### CI Test Execution

- Only tests tagged with `@ci` run in CI
- Tests run in parallel across scenarios and browsers
- Each scenario runs in its own matrix job
- Failed tests are retried up to 2 times

### Viewing Test Results

Test reports are uploaded as artifacts in GitHub Actions:

1. Go to the failed workflow run
2. Scroll to "Artifacts"
3. Download `playwright-report-<scenario>`
4. Extract and open `index.html` in a browser

## Debugging

### View test traces

```bash
pnpm exec playwright show-trace trace.zip
```

Traces are automatically captured on first retry when tests fail.

### Debug specific test

```bash
pnpm exec playwright test tests/chat.spec.ts --debug
```

### View last HTML report

```bash
pnpm exec playwright show-report
```

## Troubleshooting

### Tests timing out

- Increase timeout in test: `test.setTimeout(60000)`
- Check if the app is responding: visit the `BASE_URL` in your browser

### Authentication failures

- Delete `playwright/.auth/user.json` and re-run tests
- Check that the auth setup in `tests/auth.setup.ts` matches your environment

### Scenario switching failures

- Ensure you're running in a k3d environment
- Manually switch scenario: `infrastructure/scripts/switch-test-scenario --scenario basic`
- Check Kubernetes deployment status: `kubectl get pods`

### Tests passing locally but failing in CI

- Ensure tests are tagged with `@ci`
- Check that tests don't depend on local-only state
- Verify tests run in the correct scenario

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Erato Scenarios Documentation](../infrastructure/k3d/erato-local/Scenarios.md)
- [Erato Configuration Documentation](../site/content/docs/configuration.mdx)
