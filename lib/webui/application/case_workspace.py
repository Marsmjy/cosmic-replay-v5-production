"""Application service for the vNext case workspace."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping

from lib.case_contract import (
    attach_case_contract,
    build_case_contract,
    validate_case_contract_for_run,
)
from lib.repair_planner import apply_repair
from lib.webui.repositories.case_repository import FileCaseRepository
from lib.yaml_schema import validate_yaml_schema


WORKSPACE_SCHEMA_VERSION = "1.0"
READINESS_STATES = {
    "ready",
    "needs_fields",
    "environment_unavailable",
    "unsafe_chain",
    "unsupported",
}


class CaseWorkspaceError(RuntimeError):
    def __init__(self, status_code: int, code: str, message: str, **extra: Any):
        super().__init__(message)
        self.status_code = status_code
        self.detail = {
            "schema_version": WORKSPACE_SCHEMA_VERSION,
            "error_code": code,
            "message": message,
            "evidence": extra.get("evidence") or [],
            "suggested_action": extra.get("suggested_action") or "",
        }


class CaseWorkspaceService:
    def __init__(
        self,
        *,
        case_path: Callable[[str], Path],
        repository: FileCaseRepository,
        env_getter: Callable[[str], Any],
        default_env_getter: Callable[[], Any],
        history_reader: Callable[[str, int], list[dict[str, Any]]],
        environment_probe: Callable[[Any], tuple[bool, str]] | None = None,
    ):
        self.case_path = case_path
        self.repository = repository
        self.env_getter = env_getter
        self.default_env_getter = default_env_getter
        self.history_reader = history_reader
        self.environment_probe = environment_probe

    def detail(self, name: str, env_id: str = "") -> dict[str, Any]:
        case = self._load(name)
        contract = build_case_contract(case)
        schema = validate_yaml_schema(case)
        readiness = self._readiness(case, contract, schema, env_id)
        return {
            "schema_version": WORKSPACE_SCHEMA_VERSION,
            "case": self._case_summary(name, case, contract),
            "field_catalog": self._field_lineage(case),
            "steps": self._steps(case, contract),
            "validation_points": deepcopy(case.get("validation_points") or []),
            "contracts": {
                "request": (contract.get("execution_contract") or {}).get("request_contracts") or [],
                "response": (contract.get("execution_contract") or {}).get("response_contracts") or [],
                "readback": (contract.get("execution_contract") or {}).get("readback_contracts") or [],
                "write_anchors": contract.get("write_anchor_plan") or {},
            },
            "readiness": readiness,
            "runs": self.history_reader(name, 20),
            "technical": {
                "yaml_schema": schema,
                "case_contract": contract,
                "pageid_source_graph": contract.get("pageid_source_graph") or {},
                "execution_plan": case.get("execution_plan") or {},
                "rule_trace": case.get("rule_trace") or [],
                "recording": case.get("recording") or {},
            },
        }

    def readiness(self, name: str, env_id: str = "") -> dict[str, Any]:
        case = self._load(name)
        contract = build_case_contract(case)
        return {
            "schema_version": WORKSPACE_SCHEMA_VERSION,
            **self._readiness(case, contract, validate_yaml_schema(case), env_id),
        }

    def save_variables(self, name: str, body: Mapping[str, Any]) -> dict[str, Any]:
        case = self._load(name)
        catalog = {
            str(item.get("field_id") or ""): item
            for item in case.get("field_catalog") or []
            if isinstance(item, Mapping) and item.get("field_id")
        }
        updates = body.get("fields") or {}
        if not isinstance(updates, Mapping):
            raise CaseWorkspaceError(400, "invalid_field_updates", "fields 必须是对象。")

        workspace = case.setdefault("workspace", {})
        overrides = workspace.setdefault("field_overrides", {})
        changed: list[str] = []
        for field_id, update in updates.items():
            field = catalog.get(str(field_id))
            if not field or not isinstance(update, Mapping):
                continue
            clear = bool(update.get("clear"))
            value = "" if clear else update.get("user_override")
            if clear:
                overrides.pop(str(field_id), None)
            else:
                overrides[str(field_id)] = {
                    "value": value,
                    "updated_at": datetime.now().isoformat(timespec="seconds"),
                }
            self._apply_field_value(case, field, value, clear=clear)
            changed.append(str(field_id))

        validation_updates = body.get("validation_points") or {}
        if isinstance(validation_updates, Mapping):
            for point in case.get("validation_points") or []:
                point_id = str(point.get("id") or "")
                if point_id not in validation_updates or point.get("required"):
                    continue
                point["enabled"] = bool(validation_updates[point_id])

        workspace["schema_version"] = WORKSPACE_SCHEMA_VERSION
        workspace["updated_at"] = datetime.now().isoformat(timespec="seconds")
        attach_case_contract(case)
        self.repository.write(self.case_path(name), case)
        return {
            "schema_version": WORKSPACE_SCHEMA_VERSION,
            "ok": True,
            "changed_fields": changed,
            "detail": self.detail(name, str(body.get("env_id") or "")),
        }

    def preview_repair(self, name: str, repair: Mapping[str, Any]) -> dict[str, Any]:
        case = self._load(name)
        repaired, applied, message = apply_repair(case, dict(repair))
        return {
            "schema_version": WORKSPACE_SCHEMA_VERSION,
            "applied_to_preview": applied,
            "message": message,
            "diff": _mapping_diff(case, repaired),
            "repair": deepcopy(dict(repair)),
            "requires_confirmation": True,
        }

    def apply_resolution(
        self,
        name: str,
        field_id: str,
        resolution: Mapping[str, Any],
    ) -> dict[str, Any]:
        case = self._load(name)
        field = next(
            (
                item for item in case.get("field_catalog") or []
                if isinstance(item, Mapping) and str(item.get("field_id") or "") == field_id
            ),
            None,
        )
        if not field:
            raise CaseWorkspaceError(404, "field_not_found", f"字段不存在: {field_id}")
        status = str(resolution.get("resolve_status") or resolution.get("status") or "")
        resolved_id = str(resolution.get("resolved_value_id") or resolution.get("value_id") or "")
        if status != "resolved" or not resolved_id:
            raise CaseWorkspaceError(
                422,
                "resolution_not_exact",
                "只允许保存目标环境唯一解析结果。",
                suggested_action="处理零条或多条结果后重新精确查询。",
            )
        for pick_id in field.get("pick_fields") or []:
            pick = (case.get("pick_fields") or {}).get(pick_id)
            if not isinstance(pick, dict):
                continue
            pick["value_id"] = resolved_id
            pick["resolved_value_id"] = resolved_id
            pick["resolved_value_name"] = (
                resolution.get("resolved_value_name")
                or resolution.get("value_name")
                or pick.get("value_name")
                or ""
            )
            pick["resolved_value_code"] = (
                resolution.get("resolved_value_code")
                or resolution.get("value_code")
                or pick.get("value_code")
                or ""
            )
            pick["resolve_status"] = "resolved"
            pick["confidence"] = resolution.get("confidence") or "high"
        attach_case_contract(case)
        self.repository.write(self.case_path(name), case)
        return {
            "schema_version": WORKSPACE_SCHEMA_VERSION,
            "ok": True,
            "field_id": field_id,
            "detail": self.detail(name),
        }

    def apply_confirmed_repair(
        self,
        name: str,
        repair: Mapping[str, Any],
        *,
        confirmed: bool,
    ) -> dict[str, Any]:
        if not confirmed:
            raise CaseWorkspaceError(
                409,
                "repair_confirmation_required",
                "修复草案必须由用户确认后才能应用。",
                suggested_action="查看 diff 并确认应用。",
            )
        case = self._load(name)
        repaired, applied, message = apply_repair(case, dict(repair))
        if not applied:
            raise CaseWorkspaceError(422, "repair_not_applied", message)
        attach_case_contract(repaired)
        self.repository.write(self.case_path(name), repaired)
        return {
            "schema_version": WORKSPACE_SCHEMA_VERSION,
            "ok": True,
            "message": message,
            "detail": self.detail(name),
        }

    def _load(self, name: str) -> dict[str, Any]:
        path = self.case_path(name)
        if not path.exists():
            raise CaseWorkspaceError(404, "case_not_found", f"用例不存在: {name}")
        try:
            return self.repository.read(path)
        except Exception as exc:
            raise CaseWorkspaceError(
                400,
                "case_yaml_invalid",
                f"用例 YAML 无法解析: {exc}",
                suggested_action="打开技术诊断检查 YAML schema。",
            ) from exc

    def _case_summary(
        self,
        name: str,
        case: Mapping[str, Any],
        contract: Mapping[str, Any],
    ) -> dict[str, Any]:
        field_catalog = case.get("field_catalog") or []
        write_summary = (contract.get("write_anchor_plan") or {}).get("summary") or {}
        return {
            "name": name,
            "display_name": case.get("name") or name,
            "description": case.get("description") or "",
            "scenario": contract.get("scenario") or {},
            "main_form_id": case.get("main_form_id") or "",
            "source_har": (case.get("recording") or {}).get("source_har") or "",
            "modeled_at": case.get("created_at") or "",
            "field_count": len(field_catalog),
            "maintainable_field_count": sum(
                1 for item in field_catalog
                if isinstance(item, Mapping) and item.get("panel") != "technical"
            ),
            "step_count": len(case.get("steps") or []),
            "write_anchor_count": write_summary.get("write_anchor_count", 0),
            "schema_version": str(case.get("schema_version") or "legacy"),
            "rule_version": str((case.get("rule_trace") or [{}])[0].get("version") or ""),
            "migration_status": (
                (case.get("ir_pipeline") or {}).get("mode")
                or (case.get("execution_plan") or {}).get("schema_version")
                or "compatibility"
            ),
            "known_limitations": [
                item.get("message") or item.get("code")
                for item in (contract.get("generation_gate") or {}).get("issues") or []
                if isinstance(item, Mapping)
            ],
        }

    def _field_lineage(self, case: Mapping[str, Any]) -> list[dict[str, Any]]:
        vars_map = case.get("vars") if isinstance(case.get("vars"), Mapping) else {}
        vars_meta = case.get("vars_meta") if isinstance(case.get("vars_meta"), Mapping) else {}
        picks = case.get("pick_fields") if isinstance(case.get("pick_fields"), Mapping) else {}
        overrides = ((case.get("workspace") or {}).get("field_overrides") or {})
        rows = []
        for field in sorted(
            (item for item in case.get("field_catalog") or [] if isinstance(item, Mapping)),
            key=lambda item: int(item.get("order") or 0),
        ):
            if field.get("panel") == "technical" or field.get("category") == "button":
                continue
            var_ids = list(field.get("vars") or [])
            pick_ids = list(field.get("pick_fields") or [])
            var_id = var_ids[0] if var_ids else ""
            pick_id = pick_ids[0] if pick_ids else ""
            var_meta = vars_meta.get(var_id) if isinstance(vars_meta.get(var_id), Mapping) else {}
            pick = picks.get(pick_id) if isinstance(picks.get(pick_id), Mapping) else {}
            current = vars_map.get(var_id) if var_id else _pick_display(pick)
            recorded = (
                var_meta.get("recorded_value")
                or pick.get("recorded_value_name")
                or pick.get("recorded_value_code")
                or pick.get("recorded_value_id")
                or current
            )
            override_record = overrides.get(str(field.get("field_id") or ""))
            override = (
                override_record.get("value")
                if isinstance(override_record, Mapping)
                else (current if var_meta.get("user_overridden") or pick.get("user_overridden") else "")
            )
            resolved = (
                pick.get("resolved_value_name")
                or pick.get("resolved_value_code")
                or pick.get("resolved_value_id")
                or ""
            )
            final_value = override if override not in ("", None) else resolved or current or recorded
            resolve_status = (
                pick.get("resolve_status")
                or ("pending" if pick_id and pick.get("auto_resolve") else "literal")
            )
            rows.append({
                **deepcopy(dict(field)),
                "recorded_value": recorded,
                "user_override": override,
                "environment_resolved_value": resolved,
                "final_request_value": final_value,
                "resolver_status": resolve_status,
                "resolver_message": pick.get("message") or "",
                "required": bool(field.get("required") or field.get("need_confirm")),
                "source_request_index": field.get("source_request_index"),
                "source_step_id": (
                    field.get("source_step_id")
                    or pick.get("source_step_id")
                    or var_meta.get("source_step_id")
                    or ""
                ),
                "risk": (
                    "high" if resolve_status in {"ambiguous", "not_found", "error"}
                    else "medium" if field.get("need_confirm") else "low"
                ),
                "resolver_contract": ({
                    "id": pick_id,
                    "step_id": pick_id,
                    "field_key": pick.get("field_key") or field.get("field_key") or "",
                    "form_id": pick.get("form_id") or field.get("form_id") or "",
                    "app_id": pick.get("app_id") or "",
                    "label": field.get("label") or pick.get("label") or "",
                    "value_id": pick.get("value_id") or "",
                    "value_name": pick.get("value_name") or "",
                    "value_code": pick.get("value_code") or "",
                    "resolve_by": pick.get("resolve_by") or "value_code",
                    "auto_resolve": bool(pick.get("auto_resolve")),
                    "env_sensitive": pick.get("env_sensitive") or "medium",
                } if pick_id else None),
            })
        return rows

    def _steps(
        self,
        case: Mapping[str, Any],
        contract: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        graph_nodes = {
            str(item.get("step_id") or ""): item
            for item in (contract.get("pageid_source_graph") or {}).get("nodes") or []
            if isinstance(item, Mapping)
        }
        rows = []
        for index, step in enumerate(case.get("steps") or []):
            if not isinstance(step, Mapping):
                continue
            step_id = str(step.get("id") or f"step_{index + 1}")
            rows.append({
                "id": step_id,
                "order": index + 1,
                "business_action": step.get("description") or _step_label(step),
                "business_stage": (
                    step.get("business_stage")
                    or step.get("group_label")
                    or step.get("form_label")
                    or step.get("form_id")
                    or "执行链路"
                ),
                "type": step.get("type") or "",
                "form_id": step.get("form_id") or "",
                "form_label": step.get("form_label") or "",
                "optional": bool(step.get("optional")),
                "inputs": deepcopy(step.get("fields") or {}),
                "preconditions": deepcopy(step.get("preconditions") or []),
                "page_context": deepcopy(graph_nodes.get(step_id) or {}),
                "request_contract": deepcopy(step.get("expected_request_signature") or {}),
                "response_contract": deepcopy(step.get("expected_response_signature") or {}),
                "raw": deepcopy(dict(step)),
            })
        return rows

    def _readiness(
        self,
        case: Mapping[str, Any],
        contract: Mapping[str, Any],
        schema: Mapping[str, Any],
        env_id: str,
    ) -> dict[str, Any]:
        issues: list[dict[str, Any]] = []
        scenario = contract.get("scenario") or {}
        gate = contract.get("generation_gate") or {}
        if scenario.get("kind") == "unsupported" or gate.get("decision") == "unsupported":
            state = "unsupported"
        else:
            state = "ready"

        for issue in gate.get("issues") or []:
            if not isinstance(issue, Mapping):
                continue
            issues.append(_readiness_issue(
                str(issue.get("code") or "contract_issue"),
                str(issue.get("message") or "用例契约存在问题。"),
                action=str(issue.get("action") or "打开技术诊断查看契约。"),
                affected_step=str(issue.get("step_id") or ""),
                confirmable=not bool(issue.get("blocks_run")),
                severity=str(issue.get("severity") or "warning"),
            ))
            if issue.get("blocks_run") and state != "unsupported":
                state = "unsafe_chain"

        schema_errors = schema.get("errors") or []
        if schema_errors:
            state = "unsafe_chain"
            for item in schema_errors[:8]:
                issues.append(_readiness_issue(
                    str(item.get("code") or "schema_invalid"),
                    str(item.get("message") or "YAML schema 不兼容。"),
                    action="修复 schema 后重新检查。",
                    severity="critical",
                ))

        field_rows = self._field_lineage(case)
        for field in field_rows:
            if field.get("required") and field.get("final_request_value") in ("", None):
                if state == "ready":
                    state = "needs_fields"
                issues.append(_readiness_issue(
                    "required_field_missing",
                    f"{field.get('label') or field.get('field_id')} 尚未维护。",
                    action="前往业务变量填写该字段。",
                    affected_step=str(field.get("source_step_id") or ""),
                ))
            if field.get("resolver_status") in {"ambiguous", "not_found", "error"}:
                state = "environment_unavailable"
                issues.append(_readiness_issue(
                    f"resolver_{field.get('resolver_status')}",
                    f"{field.get('label') or field.get('field_id')} 无法在目标环境唯一解析。",
                    action="按业务编码重新查询并精确选择。",
                    affected_step=str(field.get("source_step_id") or ""),
                    severity="critical",
                ))

        env = self.env_getter(env_id) if env_id else self.default_env_getter()
        if env is None or not getattr(env, "base_url", ""):
            if state not in {"unsupported", "unsafe_chain"}:
                state = "environment_unavailable"
            issues.append(_readiness_issue(
                "environment_not_configured",
                "目标环境尚未配置可访问的基础 URL。",
                action="配置目标环境连接后重新检查。",
                severity="critical",
            ))
        elif not getattr(getattr(env, "credentials", None), "is_configured", lambda: False)():
            if state not in {"unsupported", "unsafe_chain"}:
                state = "environment_unavailable"
            issues.append(_readiness_issue(
                "environment_auth_missing",
                "目标环境认证信息未配置。",
                action="配置凭证或凭证环境变量。",
                severity="critical",
            ))
        elif self.environment_probe is not None:
            available, message = self.environment_probe(env)
            if not available:
                if state not in {"unsupported", "unsafe_chain"}:
                    state = "environment_unavailable"
                issues.append(_readiness_issue(
                    "environment_unreachable",
                    message or "目标环境网络不可达。",
                    action="检查目标地址、端口、网络或代理后重新检查。",
                    severity="critical",
                ))

        preflight = validate_case_contract_for_run(case)
        if preflight.get("errors") and state == "ready":
            state = "unsafe_chain"
        if state not in READINESS_STATES:
            state = "unsafe_chain"
        return {
            "state": state,
            "title": {
                "ready": "可执行",
                "needs_fields": "需要修改字段",
                "environment_unavailable": "环境不可用",
                "unsafe_chain": "链路不安全",
                "unsupported": "暂不支持",
            }[state],
            "allow_run": state == "ready",
            "issues": _dedupe_issues(issues),
            "checked_at": datetime.now().isoformat(timespec="seconds"),
            "summary": {
                "required_fields": sum(1 for row in field_rows if row.get("required")),
                "resolver_failures": sum(
                    1 for row in field_rows
                    if row.get("resolver_status") in {"ambiguous", "not_found", "error"}
                ),
                "contract_errors": len(preflight.get("errors") or []),
                "schema_errors": len(schema_errors),
            },
        }

    @staticmethod
    def _apply_field_value(
        case: dict[str, Any],
        field: Mapping[str, Any],
        value: Any,
        *,
        clear: bool,
    ) -> None:
        vars_map = case.setdefault("vars", {})
        vars_meta = case.setdefault("vars_meta", {})
        picks = case.setdefault("pick_fields", {})
        for var_id in field.get("vars") or []:
            meta = vars_meta.setdefault(var_id, {})
            if "recorded_value" not in meta:
                meta["recorded_value"] = vars_map.get(var_id)
            vars_map[var_id] = meta.get("recorded_value") if clear else value
            meta["user_overridden"] = not clear
        for pick_id in field.get("pick_fields") or []:
            pick = picks.get(pick_id)
            if not isinstance(pick, dict):
                continue
            if clear:
                pick["value_name"] = pick.get("recorded_value_name") or ""
                pick["value_code"] = pick.get("recorded_value_code") or ""
                pick["value_id"] = pick.get("recorded_value_id") or ""
                pick["user_overridden"] = False
            else:
                pick["value_code"] = value
                pick["value_name"] = value
                pick["value_id"] = ""
                pick["resolve_by"] = "value_code"
                pick["resolve_status"] = "pending"
                pick["auto_resolve"] = True
                pick["user_overridden"] = True


def _readiness_issue(
    code: str,
    reason: str,
    *,
    action: str,
    affected_step: str = "",
    confirmable: bool = False,
    severity: str = "warning",
) -> dict[str, Any]:
    return {
        "code": code,
        "reason": reason,
        "affected_step": affected_step,
        "suggested_action": action,
        "confirmable": confirmable,
        "severity": severity,
    }


def _dedupe_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    rows = []
    for issue in issues:
        key = (issue.get("code"), issue.get("reason"), issue.get("affected_step"))
        if key in seen:
            continue
        seen.add(key)
        rows.append(issue)
    return rows


def _pick_display(pick: Mapping[str, Any]) -> Any:
    return (
        pick.get("value_code")
        or pick.get("value_name")
        or pick.get("value_number")
        or pick.get("value_id")
        or ""
    )


def _step_label(step: Mapping[str, Any]) -> str:
    action = str(step.get("ac") or step.get("method") or step.get("type") or "执行步骤")
    labels = {
        "open_form": "打开业务页面",
        "update_fields": "维护业务字段",
        "pick_basedata": "选择基础资料",
        "save": "保存",
        "submit": "提交",
        "audit": "审核",
        "delete": "删除",
    }
    return labels.get(action.lower(), action)


def _mapping_diff(before: Mapping[str, Any], after: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows = []
    keys = sorted(set(before) | set(after))
    for key in keys:
        if before.get(key) == after.get(key):
            continue
        rows.append({
            "path": f"$.{key}",
            "before": deepcopy(before.get(key)),
            "after": deepcopy(after.get(key)),
        })
    return rows
