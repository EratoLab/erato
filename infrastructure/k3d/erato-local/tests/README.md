# Helm Unit Tests for Erato-Local Chart

This directory contains unit tests for the Erato-Local Helm chart using [helm-unittest](https://github.com/helm-unittest/helm-unittest).

## Running Tests

### Run Only Erato-Local Tests (Recommended)
```bash
# From the chart directory
cd infrastructure/k3d/erato-local
helm unittest --with-subchart=false .
```

This runs only the tests for the erato-local specific templates (Dex, PostgreSQL cluster, etc.) and excludes the tests from the erato subchart dependency.

### Run All Tests (Including Subcharts)
```bash
helm unittest .
```

This runs all tests including those from the erato subchart. Note that some subchart tests may fail due to different configuration in the erato-local environment.

### Run Specific Test Files
```bash
# Run tests matching a pattern
helm unittest -f 'tests/*_test.yaml' --with-subchart=false .
```

## Test Files

Currently, there are no erato-local specific test files. The chart uses SeaweedFS as a subchart dependency for object storage.

## Erato-Local Specific Templates

The erato-local chart includes these local development templates:
- `dex-*.yaml` - Local authentication provider
- `postgres-cluster.yaml` - Local PostgreSQL database
- `erato-toml-secret.yaml` - Configuration secret
- `erato-file-storage-configmap.yaml` - File storage configuration

The chart also uses these subchart dependencies:
- SeaweedFS - S3-compatible object storage for file uploads

## Configuration

The `unittest.yaml` file contains test configuration. The key setting for erato-local is to exclude subchart tests by default since they have different expectations.

## Expected Results

When running `helm unittest --with-subchart=false .`:
- ✅ **All erato-local specific tests should pass**
- ✅ **Tests complete quickly (typically under 1 second)**

## Troubleshooting

If you see failing tests when running without `--with-subchart=false`, this is expected because the erato subchart tests have different database configuration expectations than the erato-local environment.
