#!/bin/bash
set -euo pipefail

# Check prerequisites
command -v k3d >/dev/null 2>&1 || { echo "k3d is required but not installed. Aborting." >&2; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo "kubectl is required but not installed. Aborting." >&2; exit 1; }
command -v helm >/dev/null 2>&1 || { echo "helm is required but not installed. Aborting." >&2; exit 1; }

# Create k3d cluster
echo "Creating k3d cluster..."
k3d cluster create --config k3d/cluster-config.yaml

# Wait for cluster to be ready
echo "Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=60s

# Install nginx ingress controller
echo "Installing nginx ingress controller..."
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# Add bitnami helm repo
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Install local development chart
echo "Installing Erato chart..."
helm upgrade --install erato ./charts/erato \
  --namespace erato --create-namespace \
  --values ./charts/erato/values.yaml \
  --values ./k3d/values.k3d.yaml

# Add local DNS entry
echo "127.0.0.1 app.erato.internal" | sudo tee -a /etc/hosts

echo "Setup complete! Your development environment is ready."
echo "Access the application at http://app.erato.internal" 