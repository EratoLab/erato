#!/bin/bash
set -euo pipefail

CLUSTER_NAME="erato-dev"
CHART_PATH="./k3d/erato-local"

# Host configuration
APP_HOST="app.erato.internal"
DEX_HOST="dex.erato.internal"

# Check prerequisites
for cmd in k3d kubectl helm; do
    if ! command -v $cmd &> /dev/null; then
        echo "$cmd is required but not installed. Aborting." >&2
        exit 1
    fi
done

# Check if the cluster exists
if ! k3d cluster list | grep -q "^${CLUSTER_NAME}"; then
    echo "Creating k3d cluster '${CLUSTER_NAME}'..."
    k3d cluster create \
        "${CLUSTER_NAME}" \
        --config k3d/cluster-config.yaml
else
    echo "Using existing cluster '${CLUSTER_NAME}'..."
fi

# Switch kubectl context to the new cluster
kubectl config use-context k3d-${CLUSTER_NAME}

# Wait for cluster to be ready
echo "Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=60s

# Wait for CoreDNS to be ready
echo "Waiting for CoreDNS to be ready..."
kubectl -n kube-system wait --for=condition=Available deployment/coredns --timeout=60s

# Install nginx ingress controller
echo "Installing nginx ingress controller..."
helm upgrade --install ingress-nginx ingress-nginx \
    --repo https://kubernetes.github.io/ingress-nginx \
    --namespace ingress-nginx --create-namespace

# Install Reloader
echo "Installing Reloader for ConfigMap auto-reloading..."
kubectl apply -f https://raw.githubusercontent.com/stakater/Reloader/master/deployments/kubernetes/reloader.yaml


# Add bitnami helm repo
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Install/upgrade local development chart
echo "Installing/upgrading Erato local development chart..."
helm upgrade --install erato "${CHART_PATH}" \
    --namespace erato --create-namespace

# Ensure local DNS entries exist
for host in "${APP_HOST}" "${DEX_HOST}" "k3d-registry.localhost"; do
    if ! grep -q "${host}" /etc/hosts; then
        echo "Adding ${host} to /etc/hosts..."
        echo "127.0.0.1 ${host}" | sudo tee -a /etc/hosts
    fi
done

echo
echo "Setup complete! Your development environment is ready."
echo "Access the application at: http://${APP_HOST}"
echo "Access Dex at: http://${DEX_HOST}"
echo
echo "Default login credentials:"
echo "  Username: admin@example.com"
echo "  Password: admin"