# Erato Infrastructure & deployment

This directory contains the Kubernetes infrastructure configuration for the Erato application, including Helm charts and local development environment setup.

## Prerequisites

- [k3d](https://k3d.io/) - Lightweight Kubernetes distribution
- [kubectl](https://kubernetes.io/docs/tasks/tools/) - Kubernetes command-line tool
- [Helm](https://helm.sh/) - Kubernetes package manager
- [Docker](https://www.docker.com/) - Container runtime

## Directory Structure

```
infrastructure/
├── erato-chaos-creator/ # local FastAPI/CLI failure-injection service
├── charts/             # Helm charts
│   └── erato/         # Main application chart
├── k3d/                # k3d configuration for running a local k3d cluster with erato deployed
└── scripts/            # Setup and utility scripts
```

## Local Development Setup

1. Install prerequisites (macOS):
   ```bash
   brew install k3d kubectl helm
   ```

2. Run the setup script:
   ```bash
   chmod +x scripts/setup-dev.sh
   ./scripts/setup-dev.sh
   ```

3. Verify the installation:
   ```bash
   kubectl get pods -n erato
   ```

## Accessing the Application

- Frontend: http://app.erato.internal

## Development Workflow

1. Build and push images to local registry:
   ```bash
   docker build -t k3d-registry.localhost:5000/erato/backend:latest ./backend
   docker push k3d-registry.localhost:5000/erato/backend:latest
   ```

2. Update deployment:
   ```bash
   helm upgrade erato ./charts/erato -n erato
   ```

## Cleaning Up

To delete the local development cluster:
```bash
k3d cluster delete erato-dev
```

## Configuration

The application can be configured through the `values.yaml` file in the Helm chart. See the comments in the file for available options. 

## Deploying an isolated environment to an existing cluster

Remote deployments use one namespace, Helm release, private hostname set, database, and namespace-scoped deployer service account per environment. The initial supported remote target is `eratolabs-hetzner-microk8s`; it must already have an ingress controller, a storage class, CNPG, and Reloader. The deployer kubeconfig cannot create namespaces or change other namespaces.

The local k3d setup also provisions a namespace deployer account and uses it for Erato chart installation and scenario switching. Cluster creation and shared add-on installation still use the developer's active k3d context. Its generated deployer kubeconfig is stored at `~/.kube/erato-dev-deployer.yaml`.

Have an authorized cluster identity provision the namespace and deployer account. Remote deployments default to the cluster's Tailscale ingress, which exposes HTTPS only to tailnet members and obtains certificates for Tailscale MagicDNS names automatically. The default tag is `tag:k8s-observability`; adjust it with `--tailscale-tags` if the tailnet ACL uses a different device tag.

```bash
cd infrastructure
./scripts/setup-dev-service-account provision \
  --issuer-kubeconfig ~/.kube/config \
  --issuer-context eratolabs-hetzner-microk8s \
  --namespace erato-alice-basic \
  --release-name erato-alice-basic \
  --output-kubeconfig ~/.kube/erato-alice-basic.yaml
```

The utility requests a 30-day service-account token by default. Renew with your own authorized identity; renewal works after the deployer token expires and writes a replacement kubeconfig atomically:

```bash
./scripts/setup-dev-service-account renew \
  --issuer-kubeconfig ~/.kube/config \
  --issuer-context eratolabs-hetzner-microk8s \
  --namespace erato-alice-basic \
  --output-kubeconfig ~/.kube/erato-alice-basic.yaml \
  --duration 720h
```

Use `--duration 336h` for 14 days. The utility reports the actual token expiry returned by the cluster. A newly issued token does not revoke an older token.

If tests need E2E credentials, generate private files in an environment-specific directory rather than the shared chart config directory:

```bash
./scripts/setup-e2e-secrets apply \
  --secret-file /path/to/alice-e2e-secrets.toml \
  --output-dir /private/tmp/alice-basic-e2e-secrets
```

Deploy a published image tag with the namespace-scoped kubeconfig:

```bash
./scripts/setup-dev --target existing \
  --environment alice-basic \
  --namespace erato-alice-basic \
  --release-name erato-alice-basic \
  --kubeconfig ~/.kube/erato-alice-basic.yaml \
  --scenario basic \
  --erato-image-tag <published-image-tag> \
  --scenario-secrets-file /private/tmp/alice-basic-e2e-secrets/erato.scenario-basic.auto.toml \
  --wait
```

For the `entra_id` scenario, also pass `--e2e-secrets-file /path/to/e2e-secrets.toml`; setup-dev uses its tenant/client credentials to configure OAuth2 Proxy. Pass `--scenario-secrets-file` for the matching generated scenario file as usual.

By default, each environment uses Tailscale MagicDNS URLs such as `https://app-alice-basic.tail1f0fbd.ts.net` and `https://dex-alice-basic.tail1f0fbd.ts.net`; the embedded-host URL is `https://embedded-host-alice-basic.tail1f0fbd.ts.net`. The environment name determines the hostnames, and `--domain-suffix` can override the tailnet suffix. Developers need to be connected to the tailnet and permitted by its ACLs. The deploy command does not create the namespace, change the active kubeconfig context, install shared cluster components, or build images. Add `--image-pull-secret NAME` if the cluster requires a namespace registry credential. Pass additional deployment-specific chart overrides with repeatable `--values-file PATH` arguments.

To use a private `.k8s-dev.erato.internal` domain and an intermediate CA instead, select the existing nginx ingress and provision a namespace TLS Secret with the service-account utility. Pass `--ingress-class nginx --domain-suffix k8s-dev.erato.internal --tls-secret-name erato-ingress-tls` to setup-dev; the certificate must cover the generated app, Dex, and embedded-host names, and its root CA must be trusted by developer browsers and Playwright.

To switch an existing remote environment, provide its namespace-scoped kubeconfig and the generated secret file for the new scenario:

```bash
./scripts/switch-test-scenario \
  --scenario assistants \
  --release-name erato-alice-basic \
  --namespace erato-alice-basic \
  --kubeconfig ~/.kube/erato-alice-basic.yaml \
  --scenario-secrets-file /private/tmp/alice-basic-e2e-secrets/erato.scenario-assistants.auto.toml
```

For a fixed Playwright environment, set `E2E_FIXED_ENVIRONMENT=true`; setup projects verify the deployed scenario and fail on mismatch instead of changing the cluster. Remove a single Helm release with its deployer kubeconfig. Namespace deletion is a separate operation for an authorized cluster identity because deployer accounts cannot delete namespaces.
