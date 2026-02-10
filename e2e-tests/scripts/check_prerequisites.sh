#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$E2E_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

errors=()
warnings=()

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
    errors+=("$1")
}

log_warning() {
    echo -e "${YELLOW}!${NC} $1"
    warnings+=("$1")
}

log_info() {
    echo -e "  $1"
}

log_skip() {
    echo -e "${YELLOW}○${NC} $1 (skipped)"
}

echo "Checking e2e test prerequisites..."
echo ""

# =============================================================================
# 1. Check Docker is available
# =============================================================================
echo "1. Checking Docker..."
docker_ok=false
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed"
else
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
    else
        log_success "Docker is available and running"
        docker_ok=true
    fi
fi

# =============================================================================
# 2. Check configuration files exist (needed before services can start)
# =============================================================================
echo ""
echo "2. Checking configuration files..."
backend_config_ok=true
frontend_config_ok=true

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    log_error "Missing: backend/.env"
    log_info "Run: cp $BACKEND_DIR/.env.template $BACKEND_DIR/.env"
    backend_config_ok=false
else
    log_success "backend/.env exists"
fi

if [[ ! -f "$BACKEND_DIR/erato.toml" ]]; then
    log_error "Missing: backend/erato.toml"
    log_info "Run: cp $BACKEND_DIR/erato.template.toml $BACKEND_DIR/erato.toml"
    backend_config_ok=false
else
    log_success "backend/erato.toml exists"
fi

if [[ ! -f "$FRONTEND_DIR/.env.local" ]]; then
    log_error "Missing: frontend/.env.local"
    log_info "Run: cp $FRONTEND_DIR/.env.template.local $FRONTEND_DIR/.env.local"
    frontend_config_ok=false
else
    log_success "frontend/.env.local exists"
fi

# =============================================================================
# 3. Check PostgreSQL container
# =============================================================================
echo ""
echo "3. Checking PostgreSQL..."
if ! $docker_ok; then
    log_skip "PostgreSQL check - Docker not available"
elif docker ps --format '{{.Names}}' | grep -q "^erato-postgres$"; then
    log_success "PostgreSQL container 'erato-postgres' is running"
else
    log_error "PostgreSQL container 'erato-postgres' is not running"
    log_info "Run: cd $BACKEND_DIR && ./run_postgres.sh"
fi

# =============================================================================
# 4. Check MinIO container
# =============================================================================
echo ""
echo "4. Checking MinIO..."
if ! $docker_ok; then
    log_skip "MinIO check - Docker not available"
elif docker ps --format '{{.Names}}' | grep -q "^erato-minio$"; then
    log_success "MinIO container 'erato-minio' is running"
else
    log_error "MinIO container 'erato-minio' is not running"
    log_info "Run: cd $BACKEND_DIR && ./run_minio.sh"
fi

# =============================================================================
# 5. Check Backend is running
# =============================================================================
echo ""
echo "5. Checking Backend..."
if ! $backend_config_ok; then
    log_skip "Backend check - config files missing (fix step 2 first)"
elif lsof -i :3130 &> /dev/null; then
    log_success "Backend is running on port 3130"
else
    log_error "Backend is not running on port 3130"
    log_info "Run: cd $BACKEND_DIR && just run"
fi

# =============================================================================
# 6. Check Frontend is running
# =============================================================================
echo ""
echo "6. Checking Frontend..."
if ! $frontend_config_ok; then
    log_skip "Frontend check - config files missing (fix step 2 first)"
elif curl -s --max-time 2 http://localhost:3001 &> /dev/null; then
    log_success "Frontend dev server is running on port 3001"
elif curl -s --max-time 2 http://localhost:4180 &> /dev/null; then
    log_success "Frontend (via oauth2-proxy) is running on port 4180"
else
    log_error "Frontend is not responding"
    log_info "Run: cd $FRONTEND_DIR && just dev"
fi

# =============================================================================
# 7. Check test files are generated
# =============================================================================
echo ""
echo "7. Checking test files..."
TEST_FILES_DIR="$E2E_DIR/test-files"
REQUIRED_FILES=(
    "big-file-20mb.pdf"
    "long-file-100k-words.pdf"
)
all_files_exist=true
for file in "${REQUIRED_FILES[@]}"; do
    if [[ ! -f "$TEST_FILES_DIR/$file" ]]; then
        log_error "Missing test file: $file"
        all_files_exist=false
    fi
done
if $all_files_exist; then
    log_success "All required test files exist"
else
    log_info "Run: $SCRIPT_DIR/generate_test_files.sh"
fi

# =============================================================================
# 8. Configuration alignment hint
# =============================================================================
echo ""
echo "8. Configuration alignment..."
if $backend_config_ok && $frontend_config_ok; then
    log_info "Run 'just check-config' for detailed Claude-powered config validation"
else
    log_warning "Fix missing config files before running config alignment check"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================="
if [[ ${#errors[@]} -eq 0 ]]; then
    echo -e "${GREEN}All prerequisites are met!${NC}"
    if [[ ${#warnings[@]} -gt 0 ]]; then
        echo -e "${YELLOW}Warnings: ${#warnings[@]}${NC}"
    fi
else
    echo -e "${RED}Prerequisites check failed: ${#errors[@]} error(s)${NC}"
    if [[ ${#warnings[@]} -gt 0 ]]; then
        echo -e "${YELLOW}Warnings: ${#warnings[@]}${NC}"
    fi
    echo ""
    echo "Please fix the errors above before running e2e tests."
fi
echo "============================================="
