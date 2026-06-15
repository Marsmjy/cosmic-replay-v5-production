"""Evidence-bound diagnosis model for the vNext AI troubleshooting workspace."""
from __future__ import annotations

import re
from typing import Any, Mapping


DIAGNOSIS_SCHEMA_VERSION = "1.0"


def build_ai_diagnosis(
    *,
    case_detail: Mapping[str, Any],
    run_snapshot: Mapping[str, Any],
    case_result: Mapping[str, Any],
) -> dict[str, Any]:
    failure = case_result.get("failure_analysis") or {}
    failed_step = next(
        (item for item in run_snapshot.get("steps") or [] if item.get("state") == "failed"),
        {},
    )
    category = _root_category(failure, failed_step, run_snapshot)
    failure_root = str(failure.get("root_cause") or "").strip()
    if (
        not failure_root
        or failure_root in {"未捕获到明确的失败步骤。", "未知失败"}
        or str(failure.get("category") or "").lower() == "unknown"
    ):
        failure_root = ""
    conclusion = _clean_failure_text(
        failed_step.get("failure_summary")
        or failure_root
        or case_result.get("error")
        or "尚未收集到足够的失败证据。"
    )
    fixes_event = next(
        (
            item for item in reversed(run_snapshot.get("events") or [])
            if item.get("type") == "fixes_ready"
        ),
        {},
    )
    repair_plan = ((fixes_event.get("data") or {}).get("repair_plan") or [])
    evidence = _evidence_rows(case_detail, run_snapshot, case_result, failed_step)
    automatic = any(item.get("safe_to_apply") for item in repair_plan)
    return {
        "schema_version": DIAGNOSIS_SCHEMA_VERSION,
        "run_id": run_snapshot.get("run_id"),
        "case_name": run_snapshot.get("case_name"),
        "failure_conclusion": conclusion,
        "evidence": evidence,
        "root_cause_category": category,
        "impact_scope": {
            "failed_step": failed_step.get("id") or "",
            "business_stage": failed_step.get("business_stage") or "",
            "write_may_have_happened": bool(
                (run_snapshot.get("result_evidence") or {}).get("action_success")
            ),
        },
        "suggested_actions": _suggestions(category),
        "auto_fix_available": automatic,
        "repair_risk": "medium" if automatic else "manual_review",
        "verification_after_fix": [
            "重新运行 readiness gate。",
            "从失败步骤前的业务阶段重新执行完整用例。",
            "比较请求契约、响应契约和业务结果证据。",
        ],
        "repair_plan": repair_plan,
        "safety": {
            "requires_diff_preview": True,
            "requires_user_confirmation": True,
            "forbidden_actions": [
                "降低关键契约",
                "删除写入锚点",
                "关闭安全检查",
                "将失败改写成成功",
            ],
        },
        "context": {
            "scenario": (case_detail.get("case") or {}).get("scenario") or {},
            "readiness": case_detail.get("readiness") or {},
            "resolver_failures": [
                item for item in case_detail.get("field_catalog") or []
                if item.get("resolver_status") in {"ambiguous", "not_found", "error"}
            ],
            "pageid": (case_detail.get("technical") or {}).get("pageid_source_graph") or {},
            "result_evidence": run_snapshot.get("result_evidence") or {},
        },
    }


def _root_category(
    failure: Mapping[str, Any],
    failed_step: Mapping[str, Any],
    snapshot: Mapping[str, Any],
) -> str:
    raw = str(failure.get("category") or "").lower()
    text = " ".join([
        raw,
        str(failure.get("root_cause") or ""),
        str(failed_step.get("failure_summary") or ""),
    ]).lower()
    mappings = [
        (("auth", "login", "环境", "connection", "timeout"), "environment_or_auth"),
        (("resolver", "lookup", "not_found", "ambiguous", "基础资料"), "resolver_failure"),
        (("pageid", "页面未初始化", "窗口"), "pageid_context"),
        (("ambiguous", "request_match"), "request_ambiguous"),
        (("not_found", "请求匹配"), "request_not_found"),
        (("requestsemantic", "request_contract"), "request_contract"),
        (("responsesemantic", "response_contract", "callback"), "response_contract"),
        (("readback", "回查"), "readback_untrusted"),
        (("nullpointerexception", "java", "server_stack"), "target_backend_exception"),
        (("business", "校验", "duplicate", "required"), "target_business_validation"),
        (("unsupported",), "unsupported"),
    ]
    for needles, category in mappings:
        if any(needle in text for needle in needles):
            return category
    if snapshot.get("state") == "cancelled":
        return "cancelled"
    return raw or "unknown"


def _suggestions(category: str) -> list[str]:
    return {
        "environment_or_auth": ["检查环境连通性、账号权限和会话有效期。"],
        "resolver_failure": ["使用业务编码精确查询；处理零条或多条结果后重新检查。"],
        "pageid_context": ["检查窗口父子关系、关闭/重开事件和 pageId 来源步骤。"],
        "request_ambiguous": ["收紧 URL、method、body 与 header 的确定性匹配条件。"],
        "request_not_found": ["核对录制请求是否进入 ExecutionPlan，必要时重新录制。"],
        "request_contract": ["比较最终请求值与录制稳定语义，修复字段绑定。"],
        "response_contract": ["检查目标环境回调、通知、主键或流程状态差异。"],
        "target_business_validation": ["根据目标系统业务提示修改字段，不要降低关键契约。"],
        "target_backend_exception": ["将脱敏证据交给目标系统后端负责人定位异常。"],
        "readback_untrusted": ["保持 write_unverified，新增经过验证且不会误查旧数据的回查。"],
        "unsupported": ["保留暂不支持状态，补充可信业务锚点后重新建模。"],
        "cancelled": ["确认停止位置，修改变量后重新执行。"],
    }.get(category, ["检查失败步骤证据，并由人工确认下一步修改。"])


def _evidence_rows(
    case_detail: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    result: Mapping[str, Any],
    failed_step: Mapping[str, Any],
) -> list[dict[str, Any]]:
    rows = []
    if failed_step:
        rows.append({
            "kind": "failed_step",
            "ref": failed_step.get("id") or "",
            "summary": failed_step.get("failure_summary") or "步骤失败",
        })
    failure = result.get("failure_analysis") or {}
    if failure:
        rows.append({
            "kind": "failure_analysis",
            "ref": failure.get("category") or "",
            "summary": failure.get("root_cause") or "",
        })
    readiness = case_detail.get("readiness") or {}
    if readiness.get("issues"):
        rows.append({
            "kind": "readiness",
            "ref": readiness.get("state") or "",
            "summary": f"{len(readiness.get('issues') or [])} 个执行前问题",
        })
    evidence = snapshot.get("result_evidence") or {}
    rows.append({
        "kind": "result_evidence",
        "ref": evidence.get("outcome") or "",
        "summary": (
            f"request={evidence.get('request_success')}, "
            f"action={evidence.get('action_success')}, "
            f"contract={evidence.get('contract_passed')}, "
            f"write={evidence.get('write_verified')}"
        ),
    })
    return rows


def _clean_failure_text(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.split(
        r"\s+/[^ ]+/site-packages/requests/__init__\.py:\d+:\s+RequestsDependencyWarning",
        text,
        maxsplit=1,
    )[0]
    return text if len(text) <= 360 else f"{text[:357]}..."
