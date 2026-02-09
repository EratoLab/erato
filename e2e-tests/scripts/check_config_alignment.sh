#!/usr/bin/env bash
set -euo pipefail

# This script uses Claude Code in headless mode to validate configuration alignment
# between backend and frontend configuration files.
#
# Usage: ./check_config_alignment.sh
#
# Prerequisites:
# - Claude Code CLI installed and authenticated
# - Backend and frontend config files exist

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$E2E_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if claude CLI is available
if ! command -v claude &> /dev/null; then
    echo -e "${RED}Error:${NC} 'claude' CLI is not installed or not in PATH"
    echo "Install Claude Code: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

# Check that required config files exist
missing_files=()
[[ ! -f "$BACKEND_DIR/.env" ]] && missing_files+=("backend/.env")
[[ ! -f "$BACKEND_DIR/erato.toml" ]] && missing_files+=("backend/erato.toml")
[[ ! -f "$FRONTEND_DIR/.env.local" ]] && missing_files+=("frontend/.env.local")

if [[ ${#missing_files[@]} -gt 0 ]]; then
    echo "============================================="
    echo -e "${RED}Missing configuration files:${NC}"
    for f in "${missing_files[@]}"; do
        echo "  - $f"
    done
    echo ""
    echo "Please create the missing files before running config check."
    echo "============================================="
    exit 1
fi

echo "Running configuration alignment check with Claude Code..."
echo ""

# Read config files and embed them in the prompt for full context
BACKEND_ENV=$(cat "$BACKEND_DIR/.env")
BACKEND_TOML=$(cat "$BACKEND_DIR/erato.toml")
FRONTEND_ENV=$(cat "$FRONTEND_DIR/.env.local")

# Run Claude Code in headless mode with full context embedded
cd "$ROOT_DIR"

PROMPT=$(cat <<'PROMPT_END'
You are a configuration validator for the Erato application. Analyze the configuration files provided below and check for alignment issues between backend and frontend.

## Configuration Files

### backend/.env
```
%BACKEND_ENV%
```

### backend/erato.toml
```
%BACKEND_TOML%
```

### frontend/.env.local
```
%FRONTEND_ENV%
```

## Configuration Relationships to Check

The backend uses `.env` for environment variables and `erato.toml` for application config.
The frontend uses `.env.local` with VITE_ prefixed variables that get bundled into the app.

Check these alignment rules:

### 1. File Storage / Upload Size
- Backend `erato.toml`: `max_upload_size_kb` (in kilobytes)
- Frontend: `VITE_MAX_UPLOAD_SIZE_BYTES` (in bytes)
- Rule: backend KB * 1024 should equal frontend bytes

### 2. Assistants Feature
- Backend `erato.toml`: `[experimental_assistants]` section with `enabled = true/false`
- Frontend: `VITE_ASSISTANTS_ENABLED=true/false`
- Rule: Both should match

### 3. Message Feedback
- Backend `erato.toml`: `message_feedback_edit_time_limit_seconds`
- Frontend: `VITE_MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS`
- Rule: Both should have the same value
- Also check: `VITE_MESSAGE_FEEDBACK_ENABLED` and `VITE_MESSAGE_FEEDBACK_COMMENTS_ENABLED` should be set if feedback is configured in backend

### 4. SharePoint Integration
- Backend `erato.toml`: `[integrations.experimental_sharepoint]` with `enabled = true/false`
- Frontend: `VITE_SHAREPOINT_ENABLED=true/false`
- Rule: Both should match (if either is set)

### 5. Sidebar Configuration
- Backend `erato.toml`: `[frontend]` section may have `sidebar_collapsed_mode`
- Frontend: `VITE_SIDEBAR_COLLAPSED_MODE`
- Rule: Both should match if set

### 6. Upload Disabled
- Backend `erato.toml`: `[frontend]` section may have `disable_upload`
- Frontend: `VITE_DISABLE_UPLOAD`
- Rule: Both should match if set

### 7. Logout Disabled
- Backend `erato.toml`: `[frontend]` section may have `disable_logout`
- Frontend: `VITE_DISABLE_LOGOUT`
- Rule: Both should match if set

### 8. Database Connection (info only)
- Backend `.env`: `DATABASE_URL` should point to localhost:5432 for local dev

### 9. API URL (info only)
- Frontend: `VITE_API_ROOT_URL` should point to the local backend (usually via oauth2-proxy at localhost:4180)

## Output Format

Provide a clear report with:
1. A summary line: PASS, WARN, or FAIL
2. For each check:
   - Status emoji: ✓ (pass), ⚠ (warning/missing), ✗ (mismatch)
   - What was checked
   - Current values (if applicable)
   - What needs to be fixed (if applicable)

Be concise but complete. Focus on actionable findings.
PROMPT_END
)

# Substitute the actual config content into the prompt
PROMPT="${PROMPT//'%BACKEND_ENV%'/$BACKEND_ENV}"
PROMPT="${PROMPT//'%BACKEND_TOML%'/$BACKEND_TOML}"
PROMPT="${PROMPT//'%FRONTEND_ENV%'/$FRONTEND_ENV}"

# Run Claude in headless mode
result=$(claude -p "$PROMPT" --output-format text 2>&1) || true

echo "$result"
echo ""
echo "============================================="

# Check if result contains FAIL
if echo "$result" | grep -qi "FAIL"; then
    echo -e "${RED}Configuration check found issues that need attention.${NC}"
    echo "============================================="
    exit 1
elif echo "$result" | grep -qi "WARN"; then
    echo -e "${YELLOW}Configuration check completed with warnings.${NC}"
    echo "============================================="
    exit 0
else
    echo -e "${GREEN}Configuration check passed.${NC}"
    echo "============================================="
    exit 0
fi
