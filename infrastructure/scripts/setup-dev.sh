#!/bin/bash
set -euo pipefail

WAIT_FLAG=""
ERATO_IMAGE_REPOSITORY="harbor.imassage.me/erato/app"
ERATO_IMAGE_TAG="latest"
BUILD_LOCAL=false
HELM_SET_ARGS=""

# Function to display script usage
usage() {
    echo "Usage: $0 [--wait] [--build-local] [--erato-image-repository <repo>] [--erato-image-tag <tag>]"
    exit 1
}

# Parse command-line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --wait) WAIT_FLAG="--wait" ;;
        --build-local) BUILD_LOCAL=true ;;
        --erato-image-repository) ERATO_IMAGE_REPOSITORY="$2"; shift ;;
        --erato-image-tag) ERATO_IMAGE_TAG="$2"; shift ;;
        -h|--help) usage ;;
        *) echo "Unknown parameter passed: $1"; usage ;;
    esac
    shift
done


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

# Add bitnami helm repo
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add cnpg https://cloudnative-pg.github.io/charts
# helm repo update

if [[ -n "$ERATO_IMAGE_REPOSITORY" ]]; then
    HELM_SET_ARGS="$HELM_SET_ARGS --set erato.backend.image.repository=$ERATO_IMAGE_REPOSITORY"
fi

if [[ -n "$ERATO_IMAGE_TAG" ]]; then
    HELM_SET_ARGS="$HELM_SET_ARGS --set erato.backend.image.tag=$ERATO_IMAGE_TAG"
fi

if [ "$BUILD_LOCAL" = true ]; then
    PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
    echo "Performing local build..."
    
    # Generate a unique tag for the build
    BUILD_TAG=$(date +%s)
    
    # Define image names for local registry
    LOCAL_REGISTRY="harbor.imassage.me"
    FRONTEND_IMAGE_NAME="erato/frontend"

    # Use provided values for base image or fall back to defaults
    REPO_BASE=${ERATO_IMAGE_REPOSITORY:-harbor.imassage.me/erato/app}
    TAG_BASE=${ERATO_IMAGE_TAG:-latest}

    # Determine backend image to use as base for combined image
    BACKEND_IMAGE_REPO=$(echo "${REPO_BASE}" | sed 's|/app$|/backend|')
    BASE_BACKEND_IMAGE="${BACKEND_IMAGE_REPO}:${TAG_BASE}"
    echo "Using base backend image: ${BASE_BACKEND_IMAGE}"

    # Determine path for the combined image in the registry
    COMBINED_IMAGE_PATH=$(echo "${REPO_BASE}" | sed 's|^[^/]*/||')
    
    LOCAL_FRONTEND_IMAGE="${LOCAL_REGISTRY}/${FRONTEND_IMAGE_NAME}:${BUILD_TAG}"
    LOCAL_COMBINED_IMAGE="k3d-registry.localhost:5000/${COMBINED_IMAGE_PATH}:${BUILD_TAG}"
    
    # Build and push the frontend image
    echo "Building frontend image: ${LOCAL_FRONTEND_IMAGE}"
    docker build -t "${LOCAL_FRONTEND_IMAGE}" -f "${PROJECT_ROOT}/frontend/Dockerfile" "${PROJECT_ROOT}/frontend" --platform=linux/amd64
    docker push "${LOCAL_FRONTEND_IMAGE}"
    
    # Strip the registry from the backend image path for the build-arg, as the Dockerfile will prepend it.
    BACKEND_IMAGE_FOR_BUILD_ARG=$(echo "${BASE_BACKEND_IMAGE}" | sed 's|^[^/]*/||')

    # Build and push the combined image
    echo "Building combined image: ${LOCAL_COMBINED_IMAGE}"
    docker build \
        --build-arg REGISTRY=${LOCAL_REGISTRY} \
        --build-arg FRONTEND_IMAGE="${FRONTEND_IMAGE_NAME}:${BUILD_TAG}" \
        --build-arg BACKEND_IMAGE="${BACKEND_IMAGE_FOR_BUILD_ARG}" \
        -t "${LOCAL_COMBINED_IMAGE}" -f "${PROJECT_ROOT}/Dockerfile.combined" "${PROJECT_ROOT}" --platform=linux/amd64
    # Not pushing the image to the registry, as we're using the local registry.
    docker push $LOCAL_COMBINED_IMAGE
    
    # Override helm arguments to use the locally built image
    HELM_SET_ARGS="--set erato.backend.image.repository=k3d-registry.localhost:5000/${COMBINED_IMAGE_PATH} --set erato.backend.image.tag=${BUILD_TAG}"
fi

# Install nginx ingress controller
echo "Installing nginx ingress controller..."
if ! helm list -n ingress-nginx | grep -q "^ingress-nginx"; then
    echo "Installing nginx ingress controller..."
    helm upgrade --install ingress-nginx ingress-nginx \
        --repo https://kubernetes.github.io/ingress-nginx \
        --namespace ingress-nginx --create-namespace
else
    echo "nginx ingress controller already installed, skipping..."
fi
# Install CNPG operator
if ! helm list -n cnpg-system | grep -q "^cnpg"; then
    echo "Installing CNPG operator..."
    helm upgrade --install cnpg \
      --namespace cnpg-system \
      --create-namespace \
      cnpg/cloudnative-pg
else
    echo "CNPG operator already installed, skipping..."
fi

# Install Reloader
echo "Installing Reloader for ConfigMap auto-reloading..."
kubectl apply -f https://raw.githubusercontent.com/stakater/Reloader/master/deployments/kubernetes/reloader.yaml


wait_for_nginx_webhook() {
    local max_attempts=60
    local attempt=1

    echo "Waiting for NGINX admission webhook to be ready..."

    while [ $attempt -le $max_attempts ]; do
        # Check if service has endpoints
        if kubectl get endpoints -n ingress-nginx ingress-nginx-controller-admission -o jsonpath='{.subsets[*].addresses[*].ip}' | grep -q .; then
            echo "Webhook is ready!"
            return 0
        fi

        echo "Attempt $attempt/$max_attempts: Webhook not ready, waiting 5 seconds..."
        sleep 5
        ((attempt++))
    done

    echo "Timeout: Webhook did not become ready"
    return 1
}

wait_for_cnpg_webhook() {
    local max_attempts=60
    local attempt=1

    echo "Waiting for CNPG webhook to be ready..."

    while [ $attempt -le $max_attempts ]; do
        # Check if service has endpoints
        if kubectl get endpoints -n cnpg-system cnpg-webhook-service -o jsonpath='{.subsets[*].addresses[*].ip}' | grep -q .; then
            echo "Webhook is ready!"
            return 0
        fi

        echo "Attempt $attempt/$max_attempts: Webhook not ready, waiting 5 seconds..."
        sleep 5
        ((attempt++))
    done

    echo "Timeout: Webhook did not become ready"
    return 1
}

wait_for_nginx_webhook
wait_for_cnpg_webhook

# Install/upgrade local development chart
echo "Installing/upgrading Erato local development chart..."
set -x
helm upgrade --install erato-local "${CHART_PATH}" \
    --namespace erato-local-ns --create-namespace ${WAIT_FLAG} ${HELM_SET_ARGS}
set +x

# Ensure local DNS entries exist
for host in "${APP_HOST}" "${DEX_HOST}" "k3d-registry.localhost"; do
    if ! grep -q "${host}" /etc/hosts; then
        echo "Adding ${host} to /etc/hosts..."
        echo "127.0.0.1 ${host}" | sudo tee -a /etc/hosts
    fi
done

echo
echo "Setup complete! Your development environment is ready."
echo "Access the application at: https://${APP_HOST}"
echo "Access Dex at: https://${DEX_HOST}"
echo
echo "Default login credentials:"
echo "  Username: admin@example.com"
echo "  Password: admin"