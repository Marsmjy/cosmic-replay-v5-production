"""Canonical business result evidence derived after all runtime checks."""
from __future__ import annotations

from typing import Any, Mapping

from lib.ir.versions import CURRENT_VERSIONS


def build_result_evidence(
    *,
    passed: bool,
    capability: Mapping[str, Any] | None,
    first_success_gate: Mapping[str, Any] | None,
    request_contract_results: Mapping[str, Any] | None,
    response_contract_results: Mapping[str, Any] | None,
    readback_results: list[Mapping[str, Any]] | None,
) -> dict[str, Any]:
    capability = capability if isinstance(capability, Mapping) else {}
    gate = first_success_gate if isinstance(first_success_gate, Mapping) else {}
    request_results = (
        request_contract_results
        if isinstance(request_contract_results, Mapping)
        else {}
    )
    response_results = (
        response_contract_results
        if isinstance(response_contract_results, Mapping)
        else {}
    )
    readbacks = readback_results or []

    unsupported = capability.get("status") == "unsupported"
    write_mode = str(capability.get("write_mode") or "read_only")
    is_write = write_mode != "read_only" or gate.get("status") not in {
        "",
        "not_applicable",
    }
    request_failures = _failure_count(request_results)
    response_failures = _failure_count(response_results)
    request_success = bool(passed and not request_failures)
    gate_checks = gate.get("checks") if isinstance(gate.get("checks"), Mapping) else {}
    action_success = (
        bool(
            passed
            and gate_checks.get("executed_write_anchor_count", 0)
            == gate_checks.get("write_anchor_count", 0)
        )
        if is_write
        else bool(passed)
    )
    contract_passed = bool(
        passed
        and not request_failures
        and not response_failures
        and gate.get("status") != "failed"
    )
    readback_match_count = sum(1 for item in readbacks if item.get("matched"))
    write_verified = bool(
        is_write
        and gate.get("status") == "verified"
        and (
            readback_match_count
            or gate_checks.get("manual_write_verified")
        )
    )
    write_unverified = bool(
        is_write
        and passed
        and contract_passed
        and not write_verified
    )
    business_failed = bool(
        not unsupported and (not passed or gate.get("status") == "failed")
    )

    if unsupported:
        outcome = "unsupported"
    elif not is_write and passed:
        outcome = "query"
    elif write_verified:
        outcome = "write_verified"
    elif write_unverified:
        outcome = "write_unverified"
    else:
        outcome = "business_failed"

    return {
        "schema_version": CURRENT_VERSIONS["result_evidence"],
        "outcome": outcome,
        "request_success": request_success,
        "action_success": action_success,
        "contract_passed": contract_passed,
        "write_verified": write_verified,
        "write_unverified": write_unverified,
        "business_failed": business_failed,
        "unsupported": unsupported,
        "request_contract_failure_count": request_failures,
        "response_contract_failure_count": response_failures,
        "readback_match_count": readback_match_count,
        "first_success_status": str(gate.get("status") or ""),
    }


def _failure_count(results: Mapping[str, Any]) -> int:
    return sum(
        1
        for result in results.values()
        if isinstance(result, Mapping) and result.get("errors")
    )
