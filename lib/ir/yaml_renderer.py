"""Render versioned execution plans into the on-disk YAML case model."""
from __future__ import annotations

import copy
from typing import Any, Mapping

from .versions import validate_schema_version


def render_execution_plan(plan: Mapping[str, Any]) -> dict[str, Any]:
    """Render a validated execution plan without applying business inference."""
    if not isinstance(plan, Mapping):
        raise TypeError("execution plan must be a mapping")
    version = validate_schema_version("execution_plan", plan.get("schema_version"))
    if not version["compatible"]:
        raise ValueError(f"unsupported execution plan version: {version['version']}")
    serialized = plan.get("serialized_case")
    if not isinstance(serialized, Mapping):
        raise ValueError("execution plan is missing serialized_case")
    return copy.deepcopy(dict(serialized))

