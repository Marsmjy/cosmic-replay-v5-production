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
    utils.js
    cases/
      case-browser.js
      case-workspace.js
    components/
      readiness-panel.js
    variables/
      variable-workspace.js
    execution/
      execution-center.js
    logs/
      log-viewer.js
    reports/
      run-history.js
    diagnosis/
      diagnosis-workspace.js
    import/
      import-dialog.js
```

The existing Alpine/static delivery model is retained to avoid introducing a new
Node build and deployment chain during backend convergence. Modules use browser
ESM and consume the canonical API contracts.

### Backend workspace contracts

The vNext page does not reconstruct business state from YAML text in the browser.
It consumes application services and stable JSON contracts:

- `CaseWorkspaceService` aggregates case summary, canonical `FieldCatalog`, value
  lineage, business steps, validation points, contracts, readiness, history, and
  technical evidence.
- `RunWorkspace` reduces runner events into replayable timelines, structured logs,
  result evidence, cancellation state, and redacted diagnostic bundles.
- `AiDiagnosis` produces evidence-bound conclusions and repair plans. A repair
  requires a diff preview and explicit user confirmation.
- `/api/vnext/cases/*` owns detail, variable persistence, resolver application,
  readiness, and repair preview/application.
- `/api/vnext/runs/*` owns history, snapshots, filtered logs, cancellation,
  diagnosis, and diagnostic-bundle export.
- SSE events are append-only and resumable through `after_seq` or
  `Last-Event-ID`; reconnecting does not consume another viewer's events.

The runner only observes cancellation at safe boundaries. A cancellation requested
while login or network I/O is blocked is persisted as `cancelled` when control
returns; it is never rewritten as success.

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
- Environment readiness includes a short cached network reachability probe; a
  configured but unreachable target is not shown as executable.
- Logs are structured by business, execution, contract, resolver, pageId, and
  request/response layers. Secret-bearing keys and bearer/cookie values are
  redacted before delivery or export.
- Historical runs without a terminal event are classified as interrupted failures,
  not left permanently "running".
- Desktop and mobile flows must be exercised through the Browser plugin before
  publication.

### Visual direction

The interface is a quiet, compact operations workspace: restrained neutral color,
dense tables and forms, one accent color for active workflow state, no decorative
hero, and no nested card hierarchy. At mobile widths the field table becomes
stacked value-lineage rows so recorded value, user override, resolver state, and
final value remain directly operable without page-level horizontal overflow.

## Rollback

Set `COSMIC_WEBUI_MODE=legacy`, or navigate directly to `/legacy`. The vNext page
does not own persistence, so rollback does not migrate or discard user data.
