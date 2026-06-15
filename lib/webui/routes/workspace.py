"""FastAPI routes for the vNext operations workspace."""
from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from lib.webui.application.case_workspace import CaseWorkspaceError


def create_workspace_router(
    *,
    case_service_factory: Callable[[], Any],
    run_snapshot: Callable[[str], dict[str, Any]],
    run_history: Callable[[int], list[dict[str, Any]]],
    cancel_run: Callable[[str], dict[str, Any]],
    diagnose_run: Callable[[str], dict[str, Any]],
    export_bundle: Callable[[str], Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/vnext")

    def call_case(method: str, *args: Any, **kwargs: Any):
        try:
            return getattr(case_service_factory(), method)(*args, **kwargs)
        except CaseWorkspaceError as exc:
            raise HTTPException(exc.status_code, exc.detail) from exc

    @router.get("/cases/{name:path}/detail")
    def case_detail(name: str, env_id: str = ""):
        return call_case("detail", name, env_id)

    @router.put("/cases/{name:path}/variables")
    def save_variables(name: str, body: dict = Body(...)):
        return call_case("save_variables", name, body)

    @router.get("/cases/{name:path}/readiness")
    def case_readiness(name: str, env_id: str = ""):
        return call_case("readiness", name, env_id)

    @router.post("/cases/{name:path}/resolver/apply")
    def apply_resolution(name: str, body: dict = Body(...)):
        return call_case(
            "apply_resolution",
            name,
            str(body.get("field_id") or ""),
            body.get("resolution") or {},
        )

    @router.post("/cases/{name:path}/repairs/preview")
    def preview_repair(name: str, body: dict = Body(...)):
        return call_case("preview_repair", name, body.get("repair") or {})

    @router.post("/cases/{name:path}/repairs/apply")
    def apply_repair(name: str, body: dict = Body(...)):
        return call_case(
            "apply_confirmed_repair",
            name,
            body.get("repair") or {},
            confirmed=bool(body.get("confirmed")),
        )

    @router.get("/runs")
    def list_runs(limit: int = Query(50, ge=1, le=200)):
        return {
            "schema_version": "1.0",
            "runs": run_history(limit),
        }

    @router.get("/runs/{run_id}")
    def get_run(run_id: str):
        return run_snapshot(run_id)

    @router.get("/runs/{run_id}/logs")
    def get_run_logs(
        run_id: str,
        category: str = "",
        severity: str = "",
        step_id: str = "",
        search: str = "",
    ):
        snapshot = run_snapshot(run_id)
        rows = snapshot.get("logs") or []
        if category:
            rows = [item for item in rows if item.get("category") == category]
        if severity:
            rows = [item for item in rows if item.get("severity") == severity]
        if step_id:
            rows = [item for item in rows if item.get("step_id") == step_id]
        if search:
            needle = search.lower()
            rows = [
                item for item in rows
                if needle in str(item.get("message") or "").lower()
                or needle in str(item.get("data") or "").lower()
            ]
        return {
            "schema_version": "1.0",
            "run_id": run_id,
            "logs": rows,
        }

    @router.post("/runs/{run_id}/cancel")
    def stop_run(run_id: str):
        return cancel_run(run_id)

    @router.get("/runs/{run_id}/diagnosis")
    def diagnosis(run_id: str):
        return diagnose_run(run_id)

    @router.get("/runs/{run_id}/diagnostic-bundle")
    def diagnostic_bundle(run_id: str):
        path = export_bundle(run_id)
        return FileResponse(
            path,
            media_type="application/json",
            filename=path.name,
        )

    return router
