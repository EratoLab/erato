# Peknow Infrastructure

This directory contains the Kubernetes infrastructure configuration for the Peknow application, including Helm charts and local development environment setup.

## Prerequisites

- [k3d](https://k3d.io/) - Lightweight Kubernetes distribution
- [kubectl](https://kubernetes.io/docs/tasks/tools/) - Kubernetes command-line tool
- [Helm](https://helm.sh/) - Kubernetes package manager
- [Docker](https://www.docker.com/) - Container runtime

## Directory Structure

```
infrastructure/
├── charts/             # Helm charts
│   └── peknow/         # Main application chart
├── k3d/                # k3d configuration
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
   kubectl get pods -n peknow
   ```

## Accessing the Application

- Frontend: http://peknow.local
- API: http://peknow.local/api

## Development Workflow

1. Build and push images to local registry:
   ```bash
   docker build -t k3d-registry.localhost:5000/peknow/backend:latest ./backend
   docker push k3d-registry.localhost:5000/peknow/backend:latest
   ```

2. Update deployment:
   ```bash
   helm upgrade peknow ./charts/peknow -n peknow
   ```

## Cleaning Up

To delete the local development cluster:
```bash
k3d cluster delete peknow-dev
```

## Configuration

The application can be configured through the `values.yaml` file in the Helm chart. See the comments in the file for available options. 