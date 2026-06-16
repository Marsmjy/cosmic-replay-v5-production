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
    runtime_values = _build_runtime_values(safe_events)
    failure_summary = _run_failure_summary(
        state,
        ordered_steps,
        case_error=case_error,
        result_evidence=result_evidence,
    )
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
        "runtime_values": runtime_values,
        "failure_summary": failure_summary,
        "primary_action": _primary_action(state, result_evidence),
    }


def _build_runtime_values(events: list[Mapping[str, Any]]) -> dict[str, Any]:
    case_start = next((item for item in events if item["type"] == "case_start"), None)
    session_ready = next((item for item in reversed(events) if item["type"] == "session_ready"), None)
    start_data = (case_start or {}).get("data") or {}
    session_data = (session_ready or {}).get("data") or {}
    vars_def = start_data.get("vars_def") if isinstance(start_data.get("vars_def"), Mapping) else {}
    vars_labels = start_data.get("vars_labels") if isinstance(start_data.get("vars_labels"), Mapping) else {}
    vars_meta = start_data.get("vars_meta") if isinstance(start_data.get("vars_meta"), Mapping) else {}
    resolved_vars = [
        item for item in session_data.get("resolved_vars") or []
        if isinstance(item, Mapping)
    ]
    resolved_by_key = {
        str(item.get("key") or ""): item
        for item in resolved_vars
        if item.get("key")
    }
    variable_keys = list(dict.fromkeys([
        *[str(key) for key in vars_def.keys()],
        *[str(item.get("key") or "") for item in resolved_vars if item.get("key")],
    ]))
    variables = []
    for key in variable_keys:
        resolved = resolved_by_key.get(key) or {}
        meta = vars_meta.get(key) if isinstance(vars_meta.get(key), Mapping) else {}
        template_value = vars_def.get(key)
        resolved_value = resolved.get("value")
        recorded_value = meta.get("recorded_value") or template_value
        variables.append(redact({
            "key": key,
            "label": resolved.get("label") or vars_labels.get(key) or meta.get("label") or key,
            "template_value": _safe_runtime_value(template_value, key),
            "recorded_value": _safe_runtime_value(recorded_value, key),
            "resolved_value": _safe_runtime_value(
                resolved_value if resolved_value not in (None, "") else template_value,
                key,
            ),
            "status": "resolved" if resolved_value not in (None, "") else "template",
            "source": "session_ready" if resolved else "case_start",
        }))

    env_fields = _latest_env_fields(events)
    field_catalog = [
        item for item in start_data.get("field_catalog") or []
        if isinstance(item, Mapping)
    ]
    fields = []
    for field in sorted(field_catalog, key=lambda item: int(item.get("order") or 0)):
        if field.get("panel") == "technical" or field.get("category") == "button":
            continue
        var_id = str((field.get("vars") or [""])[0] or "")
        pick_id = str((field.get("pick_fields") or [""])[0] or "")
        var_meta = vars_meta.get(var_id) if isinstance(vars_meta.get(var_id), Mapping) else {}
        resolved_var = resolved_by_key.get(var_id) or {}
        env_field = (
            env_fields.get(pick_id)
            or env_fields.get(str(field.get("field_id") or ""))
            or env_fields.get(str(field.get("field_key") or ""))
            or {}
        )
        recorded = _first_non_empty(
            field.get("recorded_value"),
            var_meta.get("recorded_value"),
            field.get("value_name"),
            field.get("value_code"),
            vars_def.get(var_id),
        )
        user_override = _first_non_empty(
            field.get("user_override"),
            var_meta.get("user_override"),
        )
        environment_resolved = _first_non_empty(
            field.get("environment_resolved_value"),
            env_field.get("display_value"),
            env_field.get("value_name"),
            env_field.get("value_code"),
            env_field.get("resolved_value_id"),
        )
        final_request = _first_non_empty(
            field.get("final_request_value"),
            user_override,
            environment_resolved,
            resolved_var.get("value"),
            recorded,
        )
        semantic_key = " ".join(str(value or "") for value in (
            field.get("field_key"),
            field.get("field_id"),
            field.get("label"),
        ))
        fields.append(redact({
            "field_id": str(field.get("field_id") or field.get("id") or var_id or pick_id),
            "label": field.get("label") or env_field.get("label") or resolved_var.get("label") or var_id or pick_id,
            "field_key": field.get("field_key") or env_field.get("field_key") or "",
            "field_type": field.get("field_type") or field.get("type") or "",
            "source_step_id": field.get("source_step_id") or env_field.get("source_step_id") or "",
            "recorded_value": _safe_runtime_value(recorded, semantic_key),
            "user_override": _safe_runtime_value(user_override, semantic_key),
            "environment_resolved_value": _safe_runtime_value(environment_resolved, semantic_key),
            "final_request_value": _safe_runtime_value(final_request, semantic_key),
            "resolver_status": (
                field.get("resolver_status")
                or env_field.get("resolve_status")
                or env_field.get("status")
                or ("literal" if not pick_id else "pending")
            ),
            "status": "finalized" if final_request not in (None, "") else "pending",
        }))
    return {
        "schema_version": "1.0",
        "variables": variables,
        "fields": fields,
        "summary": {
            "variable_count": len(variables),
            "field_count": len(fields),
            "final_value_count": sum(
                1 for item in fields
                if item.get("final_request_value") not in (None, "")
            ),
        },
    }


def _latest_env_fields(events: list[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    fields: dict[str, Mapping[str, Any]] = {}
    for event in events:
        if event.get("type") != "env_fields_resolved":
            continue
        for field in (event.get("data") or {}).get("fields") or []:
            if not isinstance(field, Mapping):
                continue
            for key in (
                field.get("step_id"),
                field.get("field_id"),
                field.get("field_key"),
            ):
                if key:
                    fields[str(key)] = field
    return fields


def _first_non_empty(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return ""


def _safe_runtime_value(value: Any, semantic_key: str) -> Any:
    if value in (None, ""):
        return value
    if SECRET_KEY.search(str(semantic_key or "")):
        return "***"
    return value


def _run_failure_summary(
    state: str,
    steps: list[Mapping[str, Any]],
    *,
    case_error: Mapping[str, Any] | None,
    result_evidence: Mapping[str, Any],
) -> str:
    if state == "passed":
        outcome = result_evidence.get("outcome") or ""
        return "执行通过" if outcome != "write_unverified" else "执行通过，写入结果需要人工确认。"
    if state == "running":
        return ""
    failed = next((item for item in steps if item.get("state") == "failed"), None)
    if failed and failed.get("failure_summary"):
        return str(failed.get("failure_summary"))
    if case_error:
        return str((case_error.get("data") or {}).get("error") or "运行异常")
    if state == "cancelled":
        return "执行已停止。"
    return "运行失败，请查看失败步骤和日志证据。"


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
