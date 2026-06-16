from pathlib import Path

import pytest
import yaml

from lib.webui.application.case_workspace import (
    CaseWorkspaceError,
    CaseWorkspaceService,
)
from lib.webui.application.run_workspace import build_run_snapshot, redact
from lib.webui.diagnosis.ai_diagnosis import build_ai_diagnosis
from lib.webui.repositories.case_repository import FileCaseRepository


class Credentials:
    def is_configured(self):
        return True


class Environment:
    base_url = "https://target.example.test"
    credentials = Credentials()


def _case():
    return {
        "schema_version": "1.0",
        "name": "工作台契约用例",
        "vars": {"person_name": "录制姓名"},
        "vars_meta": {
            "person_name": {
                "recorded_value": "录制姓名",
                "source_step_id": "edit_person",
            },
        },
        "pick_fields": {
            "pick_org": {
                "label": "组织",
                "field_key": "org",
                "form_id": "demo_form",
                "app_id": "demo",
                "value_id": "recorded-internal-id",
                "value_code": "ORG001",
                "recorded_value_id": "recorded-internal-id",
                "recorded_value_code": "ORG001",
                "source_step_id": "pick_org",
                "auto_resolve": True,
                "resolve_by": "value_code",
            },
        },
        "field_catalog": [
            {
                "field_id": "person_name",
                "order": 1,
                "label": "姓名",
                "field_key": "name",
                "field_type": "text",
                "vars": ["person_name"],
                "source_step_id": "edit_person",
            },
            {
                "field_id": "org",
                "order": 2,
                "label": "组织",
                "field_key": "org",
                "field_type": "basedata",
                "pick_fields": ["pick_org"],
                "source_step_id": "pick_org",
            },
        ],
        "steps": [
            {
                "id": "edit_person",
                "type": "update_fields",
                "form_id": "demo_form",
                "fields": {"name": "${vars.person_name}"},
            },
            {
                "id": "pick_org",
                "type": "pick_basedata",
                "form_id": "demo_form",
                "app_id": "demo",
                "field_key": "org",
                "value_id": "recorded-internal-id",
            },
        ],
        "assertions": [],
    }


@pytest.fixture
def workspace(tmp_path):
    path = tmp_path / "cases" / "workspace.yaml"
    path.parent.mkdir()
    path.write_text(yaml.safe_dump(_case(), allow_unicode=True, sort_keys=False), encoding="utf-8")
    service = CaseWorkspaceService(
        case_path=lambda _name: path,
        repository=FileCaseRepository(),
        env_getter=lambda _env_id: Environment(),
        default_env_getter=Environment,
        history_reader=lambda _name, _limit: [],
    )
    return service, path


def test_case_detail_uses_field_catalog_order_and_canonical_value_lineage(workspace):
    service, _path = workspace

    detail = service.detail("workspace", "target")

    assert [item["field_id"] for item in detail["field_catalog"]] == ["person_name", "org"]
    assert detail["field_catalog"][0]["recorded_value"] == "录制姓名"
    assert detail["field_catalog"][0]["final_request_value"] == "录制姓名"
    assert detail["field_catalog"][1]["resolver_status"] == "pending"
    assert detail["readiness"]["state"] in {
        "ready",
        "needs_fields",
        "environment_unavailable",
        "unsafe_chain",
        "unsupported",
    }


def test_variable_override_persists_and_clears_recorded_internal_id(workspace):
    service, path = workspace

    response = service.save_variables(
        "workspace",
        {"env_id": "target", "fields": {"org": {"user_override": "ORG009"}}},
    )
    persisted = yaml.safe_load(path.read_text(encoding="utf-8"))

    assert response["changed_fields"] == ["org"]
    assert persisted["pick_fields"]["pick_org"]["value_code"] == "ORG009"
    assert persisted["pick_fields"]["pick_org"]["value_id"] == ""
    assert persisted["pick_fields"]["pick_org"]["resolve_status"] == "pending"
    field = next(item for item in response["detail"]["field_catalog"] if item["field_id"] == "org")
    assert field["user_override"] == "ORG009"
    assert field["final_request_value"] == "ORG009"


def test_resolver_only_accepts_unique_target_environment_result(workspace):
    service, path = workspace

    with pytest.raises(CaseWorkspaceError) as error:
        service.apply_resolution(
            "workspace",
            "org",
            {"resolve_status": "ambiguous", "candidates": [{"id": "a"}, {"id": "b"}]},
        )
    assert error.value.detail["error_code"] == "resolution_not_exact"

    service.apply_resolution(
        "workspace",
        "org",
        {
            "resolve_status": "resolved",
            "resolved_value_id": "target-id",
            "resolved_value_name": "目标组织",
            "resolved_value_code": "ORG001",
        },
    )
    persisted = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert persisted["pick_fields"]["pick_org"]["value_id"] == "target-id"
    assert persisted["pick_fields"]["pick_org"]["resolve_status"] == "resolved"


def test_repair_requires_preview_and_explicit_confirmation(workspace):
    service, path = workspace
    repair = {
        "id": "optional-pick",
        "title": "降级可选",
        "reason": "测试",
        "operation": "mark_step_optional",
        "safe_to_apply": True,
        "target": {"step_id": "pick_org"},
    }

    preview = service.preview_repair("workspace", repair)
    assert preview["requires_confirmation"] is True
    assert preview["diff"]
    with pytest.raises(CaseWorkspaceError) as error:
        service.apply_confirmed_repair("workspace", repair, confirmed=False)
    assert error.value.detail["error_code"] == "repair_confirmation_required"

    service.apply_confirmed_repair("workspace", repair, confirmed=True)
    persisted = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert persisted["steps"][1]["optional"] is True


def test_run_snapshot_is_structured_replayable_and_redacts_secrets():
    events = [
        {
            "seq": 1,
            "type": "case_start",
            "ts": 1,
            "data": {
                "name": "显示名",
                "case_file_name": "workspace",
                "env_id": "persisted-target",
                "vars_def": {"person_name": "录制姓名", "password": "secret"},
                "vars_labels": {"person_name": "姓名"},
                "vars_meta": {
                    "person_name": {
                        "recorded_value": "录制姓名",
                    },
                },
                "field_catalog": [{
                    "field_id": "person_name",
                    "order": 1,
                    "label": "姓名",
                    "field_key": "name",
                    "field_type": "text",
                    "vars": ["person_name"],
                    "source_step_id": "save",
                }],
            },
        },
        {
            "seq": 2,
            "type": "session_ready",
            "ts": 2,
            "data": {
                "resolved_vars": [{
                    "key": "person_name",
                    "label": "姓名",
                    "value": "目标姓名",
                }, {
                    "key": "password",
                    "label": "密码",
                    "value": "secret",
                }],
            },
        },
        {
            "seq": 3,
            "type": "step_start",
            "ts": 3,
            "data": {
                "id": "save",
                "label": "保存",
                "business_stage": "保存阶段",
                "resolved_request": {"authorization": "Bearer secret-token", "name": "业务值"},
            },
        },
        {
            "seq": 4,
            "type": "step_fail",
            "ts": 4,
            "data": {"id": "save", "error": "响应契约失败", "cookie": "sid=secret"},
        },
        {
            "seq": 5,
            "type": "case_done",
            "ts": 5,
            "data": {
                "passed": False,
                "step_count": 1,
                "result_evidence": {
                    "outcome": "business_failed",
                    "request_success": True,
                    "action_success": False,
                    "contract_passed": False,
                    "write_verified": False,
                },
            },
        },
    ]

    snapshot = build_run_snapshot(
        "run-1",
        events=events,
        live={"case_name": "workspace", "finished": True},
    )

    assert snapshot["case_name"] == "workspace"
    assert snapshot["display_name"] == "显示名"
    assert snapshot["env_id"] == "persisted-target"
    assert snapshot["state"] == "failed"
    assert snapshot["steps"][0]["failure_summary"] == "响应契约失败"
    assert snapshot["steps"][0]["request"]["authorization"] == "***"
    assert snapshot["runtime_values"]["variables"][0]["resolved_value"] == "目标姓名"
    assert snapshot["runtime_values"]["variables"][1]["resolved_value"] == "***"
    assert snapshot["runtime_values"]["fields"][0]["final_request_value"] == "目标姓名"
    assert snapshot["failure_summary"] == "响应契约失败"
    assert snapshot["logs"][3]["evidence_ref"] == "event:4"
    assert redact({"password": "pw", "nested": {"token": "abc"}}) == {
        "password": "***",
        "nested": {"token": "***"},
    }


def test_historical_run_without_terminal_event_is_interrupted_not_running():
    snapshot = build_run_snapshot(
        "orphaned-run",
        events=[
            {
                "seq": 1,
                "type": "case_start",
                "ts": 1,
                "data": {"name": "中断用例", "case_file_name": "workspace"},
            },
            {
                "seq": 2,
                "type": "preflight_start",
                "ts": 2,
                "data": {"id": "preflight_contract"},
            },
            {
                "seq": 3,
                "type": "preflight_ok",
                "ts": 3,
                "data": {"id": "preflight_contract", "warnings": []},
            },
            {
                "seq": 4,
                "type": "case_error",
                "ts": 4,
                "data": {"error": "LoginError: connection refused"},
            },
        ],
        live=None,
    )

    assert snapshot["state"] == "failed"
    assert snapshot["primary_action"] == "AI 排故"
    assert snapshot["steps"][0]["state"] == "passed"
    assert snapshot["steps"][1]["id"] == "runtime_error"
    assert snapshot["steps"][1]["business_stage"] == "环境与会话"
    assert snapshot["steps"][1]["request_success"] is False
    assert snapshot["logs"][-1]["category"] == "business"


def test_cancelled_run_has_explicit_execution_control_step():
    snapshot = build_run_snapshot(
        "cancelled-run",
        events=[
            {
                "seq": 1,
                "type": "case_start",
                "ts": 1,
                "data": {"name": "取消用例", "case_file_name": "workspace"},
            },
            {
                "seq": 2,
                "type": "case_cancelled",
                "ts": 2,
                "data": {"message": "执行已按用户请求停止。"},
            },
            {
                "seq": 3,
                "type": "case_done",
                "ts": 3,
                "data": {
                    "passed": False,
                    "cancelled": True,
                    "result_evidence": {"outcome": "cancelled"},
                },
            },
        ],
        live={"case_name": "workspace", "finished": True},
    )

    assert snapshot["state"] == "cancelled"
    assert snapshot["steps"][-1]["id"] == "execution_cancelled"
    assert snapshot["steps"][-1]["state"] == "cancelled"
    assert snapshot["completed_steps"] == 1


def test_ai_diagnosis_is_evidence_bound_and_preserves_safety_boundaries():
    snapshot = {
        "run_id": "run-1",
        "case_name": "workspace",
        "state": "failed",
        "steps": [{
            "id": "save",
            "state": "failed",
            "business_stage": "保存阶段",
            "failure_summary": "response_contract mismatch",
        }],
        "events": [],
        "result_evidence": {
            "outcome": "business_failed",
            "request_success": True,
            "action_success": False,
            "contract_passed": False,
            "write_verified": False,
        },
    }
    detail = {
        "case": {"scenario": {"kind": "create"}},
        "readiness": {"state": "ready", "issues": []},
        "field_catalog": [],
        "technical": {"pageid_source_graph": {}},
    }

    diagnosis = build_ai_diagnosis(
        case_detail=detail,
        run_snapshot=snapshot,
        case_result={"failure_analysis": {"root_cause": "响应契约不一致"}},
    )

    assert diagnosis["root_cause_category"] == "response_contract"
    assert diagnosis["evidence"][0]["kind"] == "failed_step"
    assert diagnosis["safety"]["requires_diff_preview"] is True
    assert diagnosis["safety"]["requires_user_confirmation"] is True
    assert "降低关键契约" in diagnosis["safety"]["forbidden_actions"]


def test_ai_diagnosis_prefers_structured_failed_step_over_generic_legacy_cause():
    diagnosis = build_ai_diagnosis(
        case_detail={
            "case": {"scenario": {"kind": "query"}},
            "readiness": {"state": "ready", "issues": []},
            "field_catalog": [],
            "technical": {"pageid_source_graph": {}},
        },
        run_snapshot={
            "run_id": "run-2",
            "case_name": "workspace",
            "state": "failed",
            "steps": [{
                "id": "runtime_error",
                "state": "failed",
                "business_stage": "环境与会话",
                "failure_summary": "LoginError: connection refused",
            }],
            "events": [],
            "result_evidence": {},
        },
        case_result={
            "failure_analysis": {
                "category": "unknown",
                "root_cause": "未捕获到明确的失败步骤。",
            },
        },
    )

    assert diagnosis["failure_conclusion"] == "LoginError: connection refused"


def test_ai_diagnosis_removes_python_dependency_warning_from_user_conclusion():
    diagnosis = build_ai_diagnosis(
        case_detail={
            "case": {"scenario": {}},
            "readiness": {"state": "environment_unavailable", "issues": []},
            "field_catalog": [],
            "technical": {"pageid_source_graph": {}},
        },
        run_snapshot={
            "run_id": "run-3",
            "case_name": "workspace",
            "state": "failed",
            "steps": [{
                "id": "runtime_error",
                "state": "failed",
                "failure_summary": (
                    "LoginError: connection refused "
                    "/python/site-packages/requests/__init__.py:113: "
                    "RequestsDependencyWarning: noisy warning"
                ),
            }],
            "events": [],
            "result_evidence": {},
        },
        case_result={},
    )

    assert diagnosis["failure_conclusion"] == "LoginError: connection refused"
