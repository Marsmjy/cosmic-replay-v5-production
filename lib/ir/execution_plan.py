"""Canonical execution-plan adapter used during phased IR migration."""
from __future__ import annotations

import copy
import hashlib
import json
import os
from typing import Any, Mapping

from .rules import build_rule_trace, validate_rule_trace
from .versions import CURRENT_VERSIONS, schema_version_manifest, validate_schema_version
from .yaml_renderer import render_execution_plan


PIPELINE_ENV = "COSMIC_IR_PIPELINE_MODE"
PIPELINE_MODES = {"observe", "prefer_ir", "strict"}


def pipeline_mode(value: str | None = None) -> str:
    mode = str(value or os.getenv(PIPELINE_ENV, "prefer_ir")).strip().lower()
    return mode if mode in PIPELINE_MODES else "prefer_ir"


def build_execution_plan(
    flow: Mapping[str, Any] | None,
    case: Mapping[str, Any],
) -> dict[str, Any]:
    """Adapt the current detailed case into the canonical execution-plan model."""
    if not isinstance(case, Mapping):
        raise TypeError("case must be a mapping")
    flow = flow if isinstance(flow, Mapping) else {}
    flow_version = ((flow.get("meta") or {}).get("schema_version") if flow else None)
    if flow:
        check = validate_schema_version("normalized_flow", flow_version)
        if not check["compatible"]:
            raise ValueError(f"unsupported normalized flow version: {check['version']}")

    serialized_case = copy.deepcopy(dict(case))
    rule_trace = build_rule_trace(flow, serialized_case)
    rule_contract = validate_rule_trace(rule_trace)
    if not rule_contract["ok"]:
        raise ValueError("execution plan contains incomplete rule provenance")
    serialized_case["rule_trace"] = rule_trace
    serialized_case["schema_versions"] = schema_version_manifest()

    return {
        "schema_version": CURRENT_VERSIONS["execution_plan"],
        "source": "normalized_flow+legacy_case_adapter",
        "adapter_version": "1.0",
        "scenario": copy.deepcopy(serialized_case.get("scenario") or {}),
        "page_context_graph": copy.deepcopy(serialized_case.get("pageid_source_graph") or {}),
        "field_catalog": copy.deepcopy(serialized_case.get("field_catalog") or []),
        "variable_binding": copy.deepcopy(
            serialized_case.get("maintainable_field_binding_plan") or {}
        ),
        "resolver_contract": copy.deepcopy(
            serialized_case.get("environment_binding_plan") or {}
        ),
        "response_contract": copy.deepcopy(
            (serialized_case.get("ir_contract") or {}).get("write_anchor_bridge") or {}
        ),
        "readback_contract": [
            copy.deepcopy(item)
            for item in (serialized_case.get("assertions") or [])
            if isinstance(item, Mapping)
            and item.get("type") in {
                "readback_by_business_key",
                "readback_runtime_upload",
            }
        ],
        "preflight": copy.deepcopy(serialized_case.get("generation_gate") or {}),
        "steps": copy.deepcopy(serialized_case.get("steps") or []),
        "rule_trace": rule_trace,
        "rule_contract": rule_contract,
        "serialized_case": serialized_case,
    }


def render_case_via_execution_plan(
    flow: Mapping[str, Any] | None,
    case: Mapping[str, Any],
    *,
    mode: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build, render, and parity-check the canonical execution plan."""
    selected_mode = pipeline_mode(mode)
    plan = build_execution_plan(flow, case)
    rendered = render_execution_plan(plan)
    source_digest = _business_digest(plan["serialized_case"])
    rendered_digest = _business_digest(rendered)
    parity_ok = source_digest == rendered_digest
    if not parity_ok and selected_mode in {"prefer_ir", "strict"}:
        raise ValueError("execution plan renderer parity check failed")

    output = rendered if selected_mode in {"prefer_ir", "strict"} else copy.deepcopy(dict(case))
    if selected_mode == "observe":
        output["rule_trace"] = copy.deepcopy(plan["rule_trace"])
        output["schema_versions"] = schema_version_manifest()
    contract = {
        "schema_version": CURRENT_VERSIONS["execution_plan"],
        "mode": selected_mode,
        "status": "ready" if parity_ok else "parity_failed",
        "source": plan["source"],
        "adapter_version": plan["adapter_version"],
        "renderer": "lib.ir.yaml_renderer.render_execution_plan",
        "parity_ok": parity_ok,
        "business_digest": rendered_digest,
        "step_count": len(plan["steps"]),
        "field_count": len(plan["field_catalog"]),
        "rule_count": plan["rule_contract"]["rule_count"],
        "need_confirm_rule_count": plan["rule_contract"]["need_confirm_count"],
        "fallback_allowed": selected_mode == "observe",
        "critical_fallback_allowed": False,
    }
    output["execution_plan"] = contract
    return output, contract


def _business_digest(case: Mapping[str, Any]) -> str:
    payload = {
        key: case.get(key)
        for key in (
            "name",
            "env",
            "recording",
            "vars",
            "vars_meta",
            "pick_fields",
            "field_catalog",
            "main_form_id",
            "scenario",
            "steps",
            "assertions",
            "validation_points",
            "generation_gate",
            "rule_trace",
            "schema_versions",
        )
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        default=str,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()

