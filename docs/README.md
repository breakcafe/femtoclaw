# Femtoclaw Public Docs

This directory contains code-adjacent documentation that is safe to publish and should stay aligned with the current implementation.

## Read First

- `architecture.md`: runtime architecture and module responsibilities
- `api.md`: HTTP API, SSE events, and pause/resume protocol
- `configuration.md`: environment variables, directories, and config files
- `skills-guide.md`: creating and using skills, three-tier system
- `security.md`: trust model, attack surface, deployment hardening
- `deployment.md`: Docker, runtime selection, horizontal scaling, MCP configuration

## Scope

Put documentation here when it is:

- directly about the implementation in `code/`
- useful to engineers or AI agents working in this repository
- acceptable to publish outside the internal workspace

Do not put internal notes, prompt dumps, or verification reports here. Those belong to the outer `../docs/` project.
