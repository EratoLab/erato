#!/bin/bash

# Array to hold PIDs of background processes
pids=()

# Function to clean up background processes
cleanup() {
    echo "Terminating background processes..."
    for pid in "${pids[@]}"; do
        # Kill the process group of the child process
        # Use kill 0 to send signal to all processes in the current process group
        # Alternatively, kill -$pid sends signal to the process group pid
        # Using kill $pid is often sufficient if the child doesn't spawn its own children that detach
        kill "$pid" 2>/dev/null
    done
    # Wait for all background processes to terminate
    wait
    echo "Cleanup complete."
}

# Trap SIGINT (Ctrl+C) and EXIT signals to run the cleanup function
trap cleanup SIGINT EXIT

# Get the directory where the script is located
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# Change to the target working directory
TARGET_DIR="$SCRIPT_DIR/erato/tests/mcp-files"
echo "Changing working directory to: $TARGET_DIR"
cd "$TARGET_DIR" || { echo "Failed to change directory to $TARGET_DIR"; exit 1; }

# Start the first command in the background
echo "Starting MCP proxy server..."
uvx --from mcp-proxy==0.7.0 mcp-proxy --sse-port 63490 pnpx @modelcontextprotocol/server-filesystem . &
pids+=($!) # Add the PID of the last background command to the array

# Start the second command in the background
echo "Starting MCP proxy server with streamable HTTP transport..."
uvx --from mcp-proxy==0.7.0 mcp-proxy --transport streamablehttp --sse-port 63491 pnpx @modelcontextprotocol/server-filesystem . &
pids+=($!)

echo "Script running. Press Ctrl+C to terminate all processes."
echo "You can run an MCP inspector via \`pnpx @modelcontextprotocol/inspector\`"

# Wait for all background processes launched by this script
wait "${pids[@]}"

echo "All processes finished." 