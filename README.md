# Erato - Open Source Chat UI for LLM's

- 🌟 Open Source
- 🚀 Built for self-hosted deployments (Helm charts included)
- 🔐 Supports a wide range of SSO providers
- 🔌 Extensible architecture for custom integrations via MCP servers
- 🪶 Small resource footprint


## Development Setup

### Requirements Repository
This project uses a private requirements repository as a Git submodule. To properly clone and set up the project:

```bash
# Clone the repository with submodules
git clone --recursive git@github.com:EratoLab/erato.git

# If you've already cloned the repository without --recursive, run:
git submodule update --init --recursive
```

The requirements repository is stored in `.requirements/` and is automatically ignored in both Git and Docker contexts.

To update the requirements to their latest version:
```bash
git submodule update --remote .requirements
```

## License

Erato is distributed under the [AGPL-3.0-only](./LICENSE) license.