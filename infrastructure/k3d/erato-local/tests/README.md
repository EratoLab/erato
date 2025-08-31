# Helm Unit Tests for Erato-Local Chart

This directory contains unit tests for the Erato-Local Helm chart using [helm-unittest](https://github.com/helm-unittest/helm-unittest).

## Running Tests

### Run Only Erato-Local Tests (Recommended)
```bash
# From the chart directory
cd infrastructure/k3d/erato-local
helm unittest --with-subchart=false .
```

This runs only the tests for the erato-local specific templates (Azurite, Dex, PostgreSQL cluster, etc.) and excludes the tests from the erato subchart dependency.

### Run All Tests (Including Subcharts)
```bash
helm unittest .
```

This runs all tests including those from the erato subchart. Note that some subchart tests may fail due to different configuration in the erato-local environment.

### Run Specific Test Files
```bash
# Run only Azurite tests
helm unittest -f 'tests/azurite*_test.yaml' --with-subchart=false .
```

## Test Files

| Test File | Description |
|-----------|-------------|
| `azurite_test.yaml` | Tests for Azurite storage components (PVC, Service, Deployment) |
| `azurite-init-job_test.yaml` | Tests for Azurite initialization job |

## Erato-Local Specific Templates

The erato-local chart includes these local development templates:
- `azurite.yaml` - Local blob storage for development
- `azurite-init-job.yaml` - Initializes Azurite storage
- `dex-*.yaml` - Local authentication provider
- `postgres-cluster.yaml` - Local PostgreSQL database
- `erato-toml-secret.yaml` - Configuration secret

## Configuration

The `unittest.yaml` file contains test configuration. The key setting for erato-local is to exclude subchart tests by default since they have different expectations.

## Expected Results

When running `helm unittest --with-subchart=false .`:
- ✅ **12 Azurite tests should pass**
- ✅ **2 test suites should pass**
- ✅ **All tests complete in ~200-300ms**

## Troubleshooting

If you see failing tests when running without `--with-subchart=false`, this is expected because the erato subchart tests have different database configuration expectations than the erato-local environment.
