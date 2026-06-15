from lib.result_evidence import build_result_evidence


def test_result_evidence_distinguishes_query_write_and_business_failure():
    query = build_result_evidence(
        passed=True,
        capability={"write_mode": "read_only", "status": "supported"},
        first_success_gate={"status": "not_applicable", "checks": {}},
        request_contract_results={},
        response_contract_results={},
        readback_results=[],
    )
    unverified = build_result_evidence(
        passed=True,
        capability={"write_mode": "write", "status": "supported"},
        first_success_gate={
            "status": "write_unverified",
            "checks": {
                "write_anchor_count": 1,
                "executed_write_anchor_count": 1,
            },
        },
        request_contract_results={"save": {"errors": []}},
        response_contract_results={"save": {"errors": []}},
        readback_results=[],
    )
    verified = build_result_evidence(
        passed=True,
        capability={"write_mode": "write", "status": "supported"},
        first_success_gate={
            "status": "verified",
            "checks": {
                "write_anchor_count": 1,
                "executed_write_anchor_count": 1,
            },
        },
        request_contract_results={"save": {"errors": []}},
        response_contract_results={"save": {"errors": []}},
        readback_results=[{"matched": True}],
    )
    failed = build_result_evidence(
        passed=False,
        capability={"write_mode": "write", "status": "supported"},
        first_success_gate={"status": "failed", "checks": {}},
        request_contract_results={"save": {"errors": ["request drift"]}},
        response_contract_results={},
        readback_results=[],
    )

    assert query["outcome"] == "query"
    assert unverified["outcome"] == "write_unverified"
    assert unverified["contract_passed"] is True
    assert verified["outcome"] == "write_verified"
    assert verified["write_verified"] is True
    assert failed["outcome"] == "business_failed"
    assert failed["business_failed"] is True
