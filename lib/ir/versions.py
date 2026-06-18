"""Schema version registry and compatibility checks for the replay pipeline."""
from __future__ import annotations

import copy
from typing import Any, Mapping


CURRENT_VERSIONS = {
    "evidence_bundle": "1.0",
    "normalized_flow": "0.4",
    "normalized_request": "1.0",
    "scenario_model": "1.0",
    "page_context_graph": "1.0",
    "field_catalog": "1.0",
    "resolver_contract": "1.0",
    "response_contract": "1.0",
    "readback_contract": "1.0",
    "execution_plan": "1.0",
    "yaml": "1.0",
    "case_contract": "1.0",
    "result_evidence": "1.0",
    "rule": "1.0",
    "ir_contract": "1.0",
    "navigation_policy": "1.0",
}

SUPPORTED_VERSIONS = {
    "normalized_flow": {"0.1", "0.2", "0.3", "0.4"},
    "yaml": {"1", "1.0"},
    "case_contract": {"1", "1.0"},
}


def canonical_version(kind: str, version: Any = None) -> str:
    """Return a canonical dotted version for a known contract kind."""
    kind = str(kind or "").strip()
    if kind not in CURRENT_VERSIONS:
        raise ValueError(f"unknown schema kind: {kind}")
    if version in (None, ""):
        return CURRENT_VERSIONS[kind]
    text = str(version).strip()
    if text == "1":
        return "1.0"
    return text


def validate_schema_version(kind: str, version: Any) -> dict[str, Any]:
    """Describe whether a version is current, compatible, or unsupported."""
    current = canonical_version(kind)
    actual = canonical_version(kind, version)
    supported = {
        canonical_version(kind, item)
        for item in SUPPORTED_VERSIONS.get(kind, {current})
    }
    compatible = actual in supported
    return {
        "kind": kind,
        "version": actual,
        "current_version": current,
        "compatible": compatible,
        "migration_required": compatible and actual != current,
        "status": (
            "current"
            if actual == current
            else "compatible"
            if compatible
            else "unsupported"
        ),
    }


def migrate_document(
    document: Mapping[str, Any],
    *,
    kind: str,
    target_version: Any = None,
) -> dict[str, Any]:
    """Apply the non-lossy compatibility migration for a schema document.

    Existing v1 YAML uses the integer ``1`` on disk. The canonical model uses
    ``1.0`` internally; this migration intentionally changes only the version
    declaration until a future structural migration is registered.
    """
    if not isinstance(document, Mapping):
        raise TypeError("schema document must be a mapping")
    source = document.get("schema_version")
    check = validate_schema_version(kind, source)
    if not check["compatible"]:
        raise ValueError(
            f"unsupported {kind} schema version {check['version']} "
            f"(current {check['current_version']})"
        )
    target = canonical_version(kind, target_version)
    target_check = validate_schema_version(kind, target)
    if not target_check["compatible"]:
        raise ValueError(f"unsupported migration target for {kind}: {target}")
    migrated = copy.deepcopy(dict(document))
    if kind == "normalized_flow":
        meta = dict(migrated.get("meta") or {})
        meta["schema_version"] = target
        migrated["meta"] = meta
    else:
        migrated["schema_version"] = target
    return migrated


def schema_version_manifest() -> dict[str, str]:
    """Return a stable version manifest for generated YAML and reports."""
    return dict(sorted(CURRENT_VERSIONS.items()))

