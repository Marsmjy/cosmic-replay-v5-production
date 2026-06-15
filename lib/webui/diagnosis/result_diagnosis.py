"""Map canonical result evidence to one conclusion and one primary action."""
from __future__ import annotations

from typing import Any, Mapping


def diagnose_result(result_evidence: Mapping[str, Any] | None) -> dict[str, str]:
    evidence = result_evidence if isinstance(result_evidence, Mapping) else {}
    outcome = str(evidence.get("outcome") or "business_failed")
    rows = {
        "query": ("查询通过", "人工确认"),
        "write_verified": ("业务写入已验证", "人工确认"),
        "write_unverified": ("执行通过，入库待确认", "人工确认"),
        "unsupported": ("当前场景暂不支持", "暂不支持"),
        "business_failed": ("业务执行失败", "AI 修用例"),
    }
    title, action = rows.get(outcome, rows["business_failed"])
    if not evidence.get("request_success", True):
        action = "检查环境"
    elif not evidence.get("contract_passed", True):
        action = "AI 修用例"
    return {"outcome": outcome, "title": title, "primary_action": action}

