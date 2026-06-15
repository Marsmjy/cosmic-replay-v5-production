"""Structured run snapshots, logs and diagnostic export."""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping


RUN_SCHEMA_VERSION = "1.0"
SECRET_KEY = re.compile(
    r"(authorization|cookie|token|password|passwd|secret|csrf|session)",
    re.IGNORECASE,
)


def redact(value: Any, key: str = "") -> Any:
    if SECRET_KEY.search(str(key)):
        return "***"
    if isinstance(value, Mapping):
        return {str(k): redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        value = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1***", value)
        value = re.sub(r"(?i)(cookie\s*[:=]\s*)[^;\s]+", r"\1***", value)
    return value


def build_run_snapshot(
    run_id: str,
    *,
    events: list[dict[str, Any]],
    live: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    safe_events = [_structured_event(run_id, item, index) for index, item in enumerate(events)]
    case_start = next((item for item in safe_events if item["type"] == "case_start"), None)
    case_done = next((item for item in reversed(safe_events) if item["type"] == "case_done"), None)
    cancelled = next((item for item in reversed(safe_events) if item["type"] == "case_cancelled"), None)
    steps: dict[str, dict[str, Any]] = {}
    for item in safe_events:
        data = item["data"]
        step_id = str(data.get("id") or data.get("step_id") or "")
        if not step_id:
            continue
        step = steps.setdefault(step_id, {
            "id": step_id,
            "business_action": data.get("label") or data.get("description") or step_id,
            "business_stage": data.get("business_stage") or "执行链路",
            "state": "pending",
            "request_success": None,
            "action_success": None,
            "contract_passed": None,
            "write_verified": None,
            "duration_ms": None,
            "failure_summary": "",
            "retry": None,
            "events": [],
        })
        step["events"].append(item["seq"])
        if item["type"] == "step_start":
            step.update({
                "state": "sending",
                "business_action": data.get("label") or step["business_action"],
                "business_stage": data.get("business_stage") or step["business_stage"],
                "request": data.get("resolved_request"),
            })
        elif item["type"] == "preflight_start":
            step.update({
                "state": "sending",
                "business_action": "执行前检查",
                "business_stage": "执行前检查",
            })
        elif item["type"] == "preflight_ok":
            step.update({
                "state": "passed",
                "request_success": None,
                "action_success": None,
                "contract_passed": True,
                "failure_summary": "; ".join(data.get("warnings") or []),
            })
        elif item["type"] == "preflight_fail":
            step.update({
                "state": "failed",
                "request_success": False,
                "action_success": False,
                "contract_passed": False,
                "failure_summary": "; ".join(data.get("errors") or []),
            })
        elif item["type"] == "step_ok":
            step.update({
                "state": "passed",
                "request_success": True,
                "action_success": True,
                "contract_passed": True,
                "duration_ms": data.get("duration_ms"),
                "response": data.get("response"),
            })
        elif item["type"] == "step_warning":
            step.update({
                "state": "passed",
                "failure_summary": "; ".join(data.get("warnings") or []),
            })
        elif item["type"] == "step_fail":
            errors = data.get("errors") or ([data.get("error")] if data.get("error") else [])
            step.update({
                "state": "failed",
                "request_success": bool(data.get("response")),
                "action_success": False,
                "contract_passed": False,
                "duration_ms": data.get("duration_ms"),
                "failure_summary": "; ".join(str(item) for item in errors[:3]),
                "response": data.get("response"),
            })
        elif item["type"] == "retry":
            step["retry"] = {
                "attempt": data.get("attempt"),
                "error": data.get("error") or "",
            }
    case_error = next(
        (item for item in reversed(safe_events) if item["type"] == "case_error"),
        None,
    )
    if case_error and not any(item["state"] == "failed" for item in steps.values()):
        error_data = case_error["data"]
        steps["runtime_error"] = {
            "id": "runtime_error",
            "business_action": "连接目标环境",
            "business_stage": "环境与会话",
            "state": "failed",
            "request_success": False,
            "action_success": False,
            "contract_passed": None,
            "write_verified": False,
            "duration_ms": None,
            "failure_summary": str(error_data.get("error") or error_data.get("message") or "运行异常"),
            "retry": None,
            "events": [case_error["seq"]],
        }
    if cancelled and "execution_cancelled" not in steps:
        cancel_data = cancelled["data"]
        steps["execution_cancelled"] = {
            "id": "execution_cancelled",
            "business_action": "用户停止执行",
            "business_stage": "执行控制",
            "state": "cancelled",
            "request_success": None,
            "action_success": False,
            "contract_passed": None,
            "write_verified": False,
            "duration_ms": None,
            "failure_summary": str(cancel_data.get("message") or "执行已停止。"),
            "retry": None,
            "events": [cancelled["seq"]],
        }
    summary = (case_done or {}).get("data") or {}
    result_evidence = summary.get("result_evidence") or {}
    ordered_steps = list(steps.values())
    completed = sum(
        1 for item in ordered_steps
        if item["state"] in {"passed", "failed", "skipped", "cancelled"}
    )
    state = "running"
    if cancelled:
        state = "cancelled"
    elif case_done:
        state = "passed" if summary.get("passed") else "failed"
    elif live and live.get("finished"):
        state = "failed"
    elif live is None:
        state = "failed"
    return {
        "schema_version": RUN_SCHEMA_VERSION,
        "run_id": run_id,
        "case_name": (
            (live or {}).get("case_name")
            or ((case_start or {}).get("data") or {}).get("case_file_name")
            or ((case_start or {}).get("data") or {}).get("name")
            or ""
        ),
        "display_name": ((case_start or {}).get("data") or {}).get("name") or (live or {}).get("case_name") or "",
        "env_id": (
            (live or {}).get("env_id")
            or ((case_start or {}).get("data") or {}).get("env_id")
            or ""
        ),
        "state": state,
        "current_phase": _current_phase(ordered_steps),
        "started_at": (live or {}).get("started_at") or ((case_start or {}).get("timestamp") if case_start else None),
        "finished_at": (live or {}).get("finished_at"),
        "completed_steps": completed,
        "total_steps": summary.get("step_count") or max(completed, len(ordered_steps)),
        "duration_s": summary.get("duration_s") or (live or {}).get("duration_s") or 0,
        "cancel_requested": bool((live or {}).get("cancel_requested")),
        "steps": ordered_steps,
        "events": safe_events,
        "logs": [event_to_log(item) for item in safe_events],
        "result": summary,
        "result_evidence": result_evidence,
        "primary_action": _primary_action(state, result_evidence),
    }


def event_to_log(event: Mapping[str, Any]) -> dict[str, Any]:
    data = event.get("data") or {}
    event_type = str(event.get("type") or "")
    category = "execution"
    if event_type.startswith("assertion") or "contract" in event_type:
        category = "contract"
    elif event_type == "env_fields_resolved":
        category = "resolver"
    elif event_type == "pageid_trace":
        category = "pageid"
    elif event_type in {"step_start", "step_ok", "step_fail", "step_warning"}:
        category = "request_response"
    elif event_type in {
        "case_start",
        "case_done",
        "case_cancelled",
        "case_error",
        "failure_analysis",
    }:
        category = "business"
    severity = (
        "error" if event_type in {"step_fail", "assertion_fail", "case_error"}
        else "warning" if event_type in {"step_warning", "retry", "case_cancelled"}
        else "info"
    )
    message = (
        data.get("message")
        or data.get("error")
        or data.get("label")
        or data.get("description")
        or event_type
    )
    return {
        "timestamp": event.get("timestamp"),
        "run_id": event.get("run_id"),
        "step_id": data.get("id") or data.get("step_id") or "",
        "request_index": data.get("source_request_index"),
        "rule_id": data.get("rule_id") or "",
        "page_context": data.get("pageid_trace") or data.get("page_context") or {},
        "severity": severity,
        "category": category,
        "message": str(message),
        "evidence_ref": f"event:{event.get('seq')}",
        "data": redact(data),
    }


def export_diagnostic_bundle(
    output_dir: Path,
    *,
    snapshot: Mapping[str, Any],
    diagnosis: Mapping[str, Any],
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    run_id = re.sub(r"[^A-Za-z0-9_-]", "", str(snapshot.get("run_id") or "run"))
    path = output_dir / f"{run_id}-diagnostic.json"
    path.write_text(
        json.dumps(
            redact({
                "schema_version": RUN_SCHEMA_VERSION,
                "snapshot": snapshot,
                "diagnosis": diagnosis,
            }),
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def _structured_event(run_id: str, event: Mapping[str, Any], index: int) -> dict[str, Any]:
    timestamp = event.get("ts")
    if isinstance(timestamp, (int, float)):
        timestamp = datetime.fromtimestamp(timestamp).isoformat(timespec="milliseconds")
    return {
        "seq": int(event.get("seq") or index + 1),
        "run_id": run_id,
        "type": str(event.get("type") or ""),
        "timestamp": timestamp or "",
        "data": redact(event.get("data") or {}),
    }


def _current_phase(steps: list[dict[str, Any]]) -> str:
    running = next((item for item in reversed(steps) if item["state"] not in {"passed", "failed", "skipped"}), None)
    if running:
        return running["business_stage"]
    return steps[-1]["business_stage"] if steps else "等待开始"


def _primary_action(state: str, evidence: Mapping[str, Any]) -> str:
    if state == "cancelled":
        return "修改字段"
    if state == "running":
        return "停止执行"
    if evidence.get("outcome") == "write_unverified":
        return "人工确认"
    if evidence.get("request_success") is False:
        return "检查环境"
    if state == "failed":
        return "AI 排故"
    return "查看业务证据"
