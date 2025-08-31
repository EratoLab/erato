# Helm Unit Tests for Erato Chart

This directory contains unit tests for the Erato Helm chart using [helm-unittest](https://github.com/helm-unittest/helm-unittest).

## Prerequisites

1. **Install helm-unittest plugin:**
   ```bash
   helm plugin install https://github.com/helm-unittest/helm-unittest
   ```

2. **Verify installation:**
   ```bash
   helm unittest --help
   ```

## Running Tests

### Run all tests
```bash
# From the chart directory
cd infrastructure/charts/erato
helm unittest .
```

### Run specific test files
```bash
# Run only backend deployment tests
helm unittest -f 'tests/backend-deployment_test.yaml' .

# Run multiple specific test files
helm unittest -f 'tests/backend-*_test.yaml' .
```

### Run with verbose output
```bash
helm unittest -v .
```

### Run tests with coverage
```bash
helm unittest --with-subchart=false --strict .
```

### Generate JUnit XML output (for CI/CD)
```bash
helm unittest --output-type JUnit --output-file test-results.xml .
```

## Test Structure

Each test file follows the helm-unittest format:

```yaml
suite: test description
templates:
  - template-name.yaml
tests:
  - it: should test something
    set:
      # Override values for this test
      key: value
    asserts:
      - isKind:
          of: Deployment
      - equal:
          path: metadata.name
          value: expected-value
```

## Test Files

| Test File | Description |
|-----------|-------------|
| `backend-deployment_test.yaml` | Tests for the main backend deployment |
| `services_test.yaml` | Tests for the backend service |
| `ingress_test.yaml` | Tests for the ingress configuration |
| `oauth2-proxy-deployment_test.yaml` | Tests for OAuth2 proxy deployment |
| `oauth2-proxy-service_test.yaml` | Tests for OAuth2 proxy service |
| `oauth2-proxy-configmap_test.yaml` | Tests for OAuth2 proxy configuration |
| `azurite_test.yaml` | Tests for Azurite storage components |
| `azurite-init-job_test.yaml` | Tests for Azurite initialization job |
| `helpers_test.yaml` | Tests for template helper functions |

## Common Test Patterns

### Testing Conditional Rendering
```yaml
- it: should not render when disabled
  set:
    component.enabled: false
  asserts:
    - hasDocuments:
        count: 0
```

### Testing Environment Variables
```yaml
- it: should set environment variables
  set:
    backend.extraEnvVars:
      - name: TEST_VAR
        value: test-value
  asserts:
    - contains:
        path: spec.template.spec.containers[0].env
        content:
          name: TEST_VAR
          value: test-value
```

### Testing Resource Configuration
```yaml
- it: should set resource limits
  set:
    backend.resources:
      limits:
        cpu: 500m
        memory: 512Mi
  asserts:
    - equal:
        path: spec.template.spec.containers[0].resources.limits.cpu
        value: 500m
```

### Testing Labels and Selectors
```yaml
- it: should include proper labels
  asserts:
    - equal:
        path: metadata.labels["app.kubernetes.io/name"]
        value: erato
    - equal:
        path: metadata.labels["app.kubernetes.io/instance"]
        value: RELEASE-NAME
```

## Assertion Types

Common assertion types used in the tests:

- `isKind: {of: ResourceType}` - Verify resource type
- `equal: {path: "path.to.field", value: "expected"}` - Exact value match
- `contains: {path: "path.to.array", content: {}}` - Array contains item
- `matchRegex: {path: "path", pattern: "regex"}` - Regex pattern match
- `isNotEmpty: {path: "path"}` - Field is not empty
- `isNull: {path: "path"}` - Field is null/undefined
- `hasDocuments: {count: N}` - Document count validation

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run Helm Unit Tests
  run: |
    helm plugin install https://github.com/helm-unittest/helm-unittest
    cd infrastructure/charts/erato
    helm unittest --output-type JUnit --output-file test-results.xml .
    
- name: Publish Test Results
  uses: dorny/test-reporter@v1
  if: always()
  with:
    name: Helm Unit Tests
    path: infrastructure/charts/erato/test-results.xml
    reporter: java-junit
```

### GitLab CI Example
```yaml
helm-unittest:
  stage: test
  script:
    - helm plugin install https://github.com/helm-unittest/helm-unittest
    - cd infrastructure/charts/erato
    - helm unittest --output-type JUnit --output-file test-results.xml .
  artifacts:
    reports:
      junit: infrastructure/charts/erato/test-results.xml
```

## Writing New Tests

1. Create a new test file in the `tests/` directory
2. Name it according to the template being tested: `{template-name}_test.yaml`
3. Follow the existing test patterns
4. Include tests for:
   - Default configuration
   - Custom values
   - Conditional rendering
   - Edge cases
   - Security configurations

## Debugging Tests

### Check template rendering
```bash
# Render templates with specific values
helm template test-release . --set oauth2Proxy.enabled=false

# Debug specific template
helm template test-release . --show-only templates/backend-deployment.yaml
```

### Validate test syntax
```bash
# Dry run to check test syntax
helm unittest --dry-run .
```

## Best Practices

1. **Test Coverage**: Aim to test all configurable options
2. **Isolation**: Each test should be independent
3. **Clarity**: Use descriptive test names with "should" statements
4. **Edge Cases**: Test both enabled and disabled states
5. **Security**: Verify security-related configurations
6. **Documentation**: Keep this README updated with new tests

## Troubleshooting

### Common Issues

1. **Plugin not found**: Ensure helm-unittest is installed
2. **Template not found**: Check template paths in test files
3. **Assertion failures**: Use `helm template` to debug rendered output
4. **Path errors**: Verify YAML paths using tools like `yq`

## Package Exclusion

The test files are automatically excluded from Helm chart packages via the `.helmignore` file in the chart root. This ensures that:

- Test files (`tests/` directory) are not included in published chart packages
- The `unittest.yaml` configuration file is excluded
- Other development artifacts are properly filtered out

To verify exclusion:
```bash
# Package the chart and check contents
helm package .
tar -tzf erato-*.tgz | grep tests || echo "Tests correctly excluded"
```

For more information, see the [helm-unittest documentation](https://github.com/helm-unittest/helm-unittest).
