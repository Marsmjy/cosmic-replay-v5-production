# ADR 0002: parallel Web UI vNext

- Status: Accepted
- Date: 2026-06-15
- Scope: FastAPI web UI routes and static frontend

## Context

`lib/webui/static/index.html` is an 8k-line Alpine application containing markup,
API calls, state, field normalization, import flow, execution flow, report
interpretation, and diagnostics. `lib/webui/server.py` similarly combines HTTP
routes, orchestration, persistence, and diagnosis.

The redesign must preserve the old page as a short-term fallback while establishing
one understandable user flow:

`Import and model -> Maintain business values -> Readiness -> Execute -> Business result`

## Decision

### Parallel delivery

- Keep the current page at `/legacy`.
- Add the modular vNext page at `/`.
- Allow `COSMIC_WEBUI_MODE=legacy` to restore the old default without changing data
  or generated cases.
- Keep API compatibility while moving route logic behind application services.

### Frontend modules

```text
static/vnext/
  index.html
  styles/
    tokens.css
    workspace.css
  js/
    app.js
    api-client.js
    state.js
    components/
      field-editor.js
      readiness-gate.js
      result-summary.js
      technical-drawer.js
    workspaces/
      import-workspace.js
      run-workspace.js
```

The existing Alpine/static delivery model is retained to avoid introducing a new
Node build and deployment chain during backend convergence. Modules use browser
ESM and consume the canonical API contracts.

### User-facing rules

- Technical fields, YAML, pageId, raw requests, and evidence bundles live in a
  technical drawer by default.
- Business fields are grouped by stage and form and retain HAR first-seen order.
- Each field displays recorded, user override, environment resolution, and final
  value provenance.
- Validation points retain category and enabled state after YAML generation.
- Readiness has exactly one top-level state:
  `ready`, `needs_fields`, `environment_unavailable`, `unsafe_chain`, or
  `unsupported`.
- Result has exactly one top-level conclusion and one primary action.
- Desktop and mobile flows must be exercised through the Browser plugin before
  publication.

### Visual direction

The interface is a quiet, compact operations workspace: restrained neutral color,
dense tables and forms, one accent color for active workflow state, no decorative
hero, and no nested card hierarchy.

## Rollback

Set `COSMIC_WEBUI_MODE=legacy`, or navigate directly to `/legacy`. The vNext page
does not own persistence, so rollback does not migrate or discard user data.

