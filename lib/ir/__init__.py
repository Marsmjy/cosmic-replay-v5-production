"""Normalized HAR flow IR helpers.

The IR layer is intentionally value-safe: it keeps request shape, pageId roles,
dependencies, variables and assertion policy without persisting raw cookies,
tokens or full pageIds.
"""

from .alignment import assess_ir_preview_alignment
from .data_selector import build_target_data_selector_plan
from .field_bridge import build_ir_field_bridge, build_maintainable_field_binding_plan
from .interaction_contract import (
    apply_ir_interaction_contracts,
    build_ir_interaction_bridge,
    build_ir_interaction_contract,
)
from .navigation import apply_ir_navigation_policy
from .execution_plan import (
    build_execution_plan,
    pipeline_mode,
    render_case_via_execution_plan,
)
from .request_matcher import match_request, request_fingerprint
from .rules import build_rule_trace, validate_rule_trace
from .schema import build_normalized_flow, compact_flow_for_preview, validate_normalized_flow
from .versions import (
    CURRENT_VERSIONS,
    migrate_document,
    schema_version_manifest,
    validate_schema_version,
)
from .write_contract import (
    apply_ir_write_contracts,
    build_case_write_anchor_plan,
    build_ir_write_anchor_bridge,
    classify_write_operation,
    evaluate_first_success_gate,
    is_write_operation_kind,
    is_write_step,
)
from .yaml_bridge import build_ir_yaml_bridge, classify_yaml_step_role

__all__ = [
    "assess_ir_preview_alignment",
    "apply_ir_navigation_policy",
    "apply_ir_interaction_contracts",
    "apply_ir_write_contracts",
    "build_case_write_anchor_plan",
    "build_execution_plan",
    "build_target_data_selector_plan",
    "build_ir_field_bridge",
    "build_ir_interaction_bridge",
    "build_ir_interaction_contract",
    "build_ir_write_anchor_bridge",
    "build_ir_yaml_bridge",
    "build_maintainable_field_binding_plan",
    "build_normalized_flow",
    "classify_yaml_step_role",
    "classify_write_operation",
    "compact_flow_for_preview",
    "evaluate_first_success_gate",
    "is_write_operation_kind",
    "is_write_step",
    "match_request",
    "migrate_document",
    "pipeline_mode",
    "render_case_via_execution_plan",
    "request_fingerprint",
    "schema_version_manifest",
    "validate_rule_trace",
    "validate_schema_version",
    "validate_normalized_flow",
    "build_rule_trace",
    "CURRENT_VERSIONS",
]
