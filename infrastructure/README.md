# Erato Infrastructure & deployment

This directory contains the Kubernetes infrastructure configuration for the Erato application, including Helm charts and local development environment setup.

## Prerequisites

- [vcluster/vind](https://github.com/loft-sh/vind) - Kubernetes in Docker
- [kubectl](https://kubernetes.io/docs/tasks/tools/) - Kubernetes command-line tool
- [Helm](https://helm.sh/) - Kubernetes package manager
- [Docker](https://www.docker.com/) - Container runtime

## Directory Structure

```
infrastructure/
├── charts/             # Helm charts
│   └── erato/         # Main application chart
├── k3d/                # Helm chart and scenario configuration for the local cluster
├── vind/               # vind configuration for the local/CI Kubernetes cluster
└── scripts/            # Setup and utility scripts
```

## Local Development Setup

1. Install prerequisites (macOS):
   ```bash
   brew install loft-sh/tap/vcluster kubectl helm
   ```

2. Run the setup script:
   ```bash
   ./scripts/setup-dev
   ```
   The first run may prompt for your administrator password because vind uses
   elevated privileges to expose LoadBalancer services on Docker Desktop.
   Setup also creates a one-year self-signed certificate for the local HTTPS
   hosts, so browsers may require a one-time certificate trust exception. The
   local hostnames are mapped to vind's ingress LoadBalancer address.
   If `erato-dev` already exists from a non-sudo run, delete it first with
   `vcluster delete erato-dev` so it can be recreated with LoadBalancer support.
   Delete and recreate an existing cluster after changing `vind/cluster-config.yaml`,
   since Docker port mappings are applied only when the cluster is created.

3. Verify the installation:
   ```bash
   kubectl get pods -n erato-local-ns
   ```

## Accessing the Application

- Frontend: https://app.erato.internal

## Development Workflow

1. Build and push images to the configured registry:
   ```bash
   ./scripts/setup-dev --build-local
   ```

2. Update deployment:
   ```bash
   helm upgrade erato-local ./k3d/erato-local -n erato-local-ns
   ```

## Cleaning Up

To delete the local development cluster:
```bash
vcluster delete erato-dev
```

## Configuration

The application can be configured through the `values.yaml` file in the Helm chart. See the comments in the file for available options.
