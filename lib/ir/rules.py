"""Value-safe provenance records for inferred generation rules."""
from __future__ import annotations

from typing import Any, Mapping

from .versions import CURRENT_VERSIONS


REQUIRED_RULE_FIELDS = {
    "rule_id",
    "version",
    "evidence",
    "source_request_index",
    "confidence",
    "assumptions",
    "need_confirm",
}


def build_rule_trace(
    flow: Mapping[str, Any] | None,
    case: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    """Build one provenance record for every serialized step and field rule."""
    flow = flow if isinstance(flow, Mapping) else {}
    case = case if isinstance(case, Mapping) else {}
    trace: list[dict[str, Any]] = []
    requests = flow.get("request") if isinstance(flow.get("request"), Mapping) else {}
    ir_by_source: dict[tuple[Any, Any], Mapping[str, Any]] = {}
    for request in requests.values():
        if not isinstance(request, Mapping):
            continue
        ir_by_source[(request.get("source_index"), request.get("action_index"))] = request

    for index, step in enumerate(case.get("steps") or []):
        if not isinstance(step, Mapping):
            continue
        sources = [
            source
            for source in (step.get("ir_sources") or [])
            if isinstance(source, Mapping)
        ]
        primary = sources[0] if sources else {}
        source_index = primary.get("source_index")
        action_index = primary.get("action_index")
        ir_request = ir_by_source.get((source_index, action_index), {})
        has_exact_source = source_index is not None
        trace.append({
            "rule_id": _step_rule_id(step),
            "version": CURRENT_VERSIONS["rule"],
            "target": {
                "kind": "step",
                "id": str(step.get("id") or f"step_{index + 1}"),
            },
            "evidence": [{
                "kind": "har_request" if has_exact_source else "compatibility_inference",
                "source_request_index": source_index,
                "action_index": action_index,
                "form_id": str(step.get("form_id") or ir_request.get("form_id") or ""),
                "action": str(step.get("ac") or step.get("method") or ""),
            }],
            "source_request_index": source_index,
            "confidence": 0.98 if has_exact_source else 0.65,
            "assumptions": (
                []
                if has_exact_source
                else ["legacy adapter did not retain an exact HAR action source"]
            ),
            "need_confirm": bool(
                step.get("optional")
                or not has_exact_source
                or step.get("recorded_pageid_source_retained") is False
            ),
        })

    for index, field in enumerate(case.get("field_catalog") or []):
        if not isinstance(field, Mapping):
            continue
        source_index = _field_source_index(field)
        trace.append({
            "rule_id": "field_catalog.first_seen_order",
            "version": CURRENT_VERSIONS["rule"],
            "target": {
                "kind": "field",
                "id": str(field.get("field_id") or f"field_{index + 1}"),
            },
            "evidence": [{
                "kind": "har_field_observation",
                "source_request_index": source_index,
                "form_id": str(field.get("form_id") or ""),
                "field_key": str(field.get("field_key") or ""),
                "catalog_order": field.get("order"),
            }],
            "source_request_index": source_index,
            "confidence": float(field.get("confidence") or 0.85),
            "assumptions": list(field.get("assumptions") or []),
            "need_confirm": bool(
                field.get("need_confirm")
                or field.get("category") in {"", "unknown"}
            ),
        })

    for field_id, resolver in (case.get("pick_fields") or {}).items():
        if not isinstance(resolver, Mapping):
            continue
        source_index = resolver.get("source_request_index", resolver.get("source_index"))
        trace.append({
            "rule_id": "resolver.exact_business_key",
            "version": CURRENT_VERSIONS["rule"],
            "target": {"kind": "resolver", "id": str(field_id)},
            "evidence": [{
                "kind": "recorded_selector",
                "source_request_index": source_index,
                "form_id": str(resolver.get("form_id") or ""),
                "field_key": str(resolver.get("field_key") or ""),
                "resolve_by": str(resolver.get("resolve_by") or ""),
            }],
            "source_request_index": source_index,
            "confidence": 0.95 if resolver.get("resolve_by") else 0.7,
            "assumptions": (
                []
                if resolver.get("resolve_by")
                else ["target environment resolver interface is incomplete"]
            ),
            "need_confirm": not bool(resolver.get("resolve_by")),
        })
    return trace


def validate_rule_trace(trace: Any) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    rows = trace if isinstance(trace, list) else []
    if not isinstance(trace, list):
        errors.append({"index": None, "missing": ["rule_trace_not_list"]})
    for index, row in enumerate(rows):
        if not isinstance(row, Mapping):
            errors.append({"index": index, "missing": ["rule_not_mapping"]})
            continue
        missing = sorted(field for field in REQUIRED_RULE_FIELDS if field not in row)
        if missing:
            errors.append({"index": index, "missing": missing})
    return {
        "schema_version": CURRENT_VERSIONS["rule"],
        "ok": not errors,
        "rule_count": len(rows),
        "need_confirm_count": sum(
            1 for row in rows if isinstance(row, Mapping) and row.get("need_confirm")
        ),
        "errors": errors[:20],
    }


def _step_rule_id(step: Mapping[str, Any]) -> str:
    step_type = str(step.get("type") or "unknown").strip().lower()
    action = str(step.get("ac") or step.get("method") or "").strip().lower()
    suffix = action or step_type
    return f"execution_step.{step_type}.{suffix}"


def _field_source_index(field: Mapping[str, Any]) -> Any:
    for key in ("source_request_index", "source_index", "first_seen_request_index"):
        if field.get(key) is not None:
            return field.get(key)
    sources = field.get("sources")
    if isinstance(sources, list):
        for source in sources:
            if isinstance(source, Mapping):
                for key in ("source_request_index", "source_index"):
                    if source.get(key) is not None:
                        return source.get(key)
    return None

