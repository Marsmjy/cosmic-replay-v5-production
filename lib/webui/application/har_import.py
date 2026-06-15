"""HAR import orchestration independent from FastAPI."""
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping

import yaml

from lib.ir.versions import validate_schema_version


class HarImportError(RuntimeError):
    def __init__(self, status_code: int, detail: Any):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


class HarImportService:
    def __init__(
        self,
        *,
        skill_root: Path,
        upload_dir: Callable[[], Path],
        allocate_case_name: Callable[[str], str],
        case_path: Callable[[str], Path],
        build_yaml_case: Callable[..., str],
        repository: Any,
        metadata_resolver_factory: Callable[[str], Any] | None = None,
        catalog_updater: Callable[[Any, set[str]], dict[str, Any]] | None = None,
        entity_id_collector: Callable[[dict[str, Any]], set[str]] | None = None,
        clock: Callable[[], datetime] = datetime.now,
    ):
        self.skill_root = skill_root
        self.upload_dir = upload_dir
        self.allocate_case_name = allocate_case_name
        self.case_path = case_path
        self.build_yaml_case = build_yaml_case
        self.repository = repository
        self.metadata_resolver_factory = metadata_resolver_factory
        self.catalog_updater = catalog_updater
        self.entity_id_collector = entity_id_collector
        self.clock = clock

    def extract(self, body: Mapping[str, Any]) -> dict[str, Any]:
        har_file = str(body.get("har_file") or "").strip()
        if not har_file:
            raise HarImportError(400, "缺少 har_file")
        har_path = self.upload_dir() / Path(har_file).name
        if not har_path.exists():
            raise HarImportError(404, f"HAR 文件不存在: {har_file}")

        requested_name = str(body.get("case_name") or "untitled").strip()
        case_name = self.allocate_case_name(requested_name)
        output_path = self.case_path(case_name)
        metadata_resolver = self._metadata_resolver(str(body.get("env_id") or ""))

        try:
            yaml_text = self.build_yaml_case(
                har_path,
                case_name,
                var_overrides=body.get("var_overrides"),
                pick_field_overrides=body.get("pick_field_overrides"),
                validation_point_overrides=body.get("validation_point_overrides"),
                meta_resolver=metadata_resolver,
                include_readback_assertions=bool(body.get("include_readback_assertions")),
            )
            parsed_case = yaml.safe_load(yaml_text) or {}
        except HarImportError:
            raise
        except Exception as exc:
            raise HarImportError(500, f"抽取失败: {exc}") from exc
        if not isinstance(parsed_case, dict):
            raise HarImportError(500, "抽取失败: 生成 YAML 根节点不是对象")

        version = validate_schema_version("yaml", parsed_case.get("schema_version"))
        if not version["compatible"]:
            raise HarImportError(
                422,
                {
                    "message": "生成 YAML schema_version 不兼容。",
                    "schema_version": version,
                },
            )
        generation_gate = (
            parsed_case.get("generation_gate")
            if isinstance(parsed_case.get("generation_gate"), dict)
            else {}
        )
        if generation_gate and not generation_gate.get("allow_generate", True):
            blockers = [
                str(item.get("message") or item.get("code") or "")
                for item in generation_gate.get("issues") or []
                if isinstance(item, dict) and item.get("blocks_generate")
            ]
            reason = "；".join(item for item in blockers if item) or "首次成功门槛未通过"
            raise HarImportError(
                422,
                {
                    "message": "当前 HAR 不能安全生成可执行 YAML。",
                    "reason": reason,
                    "generation_gate": generation_gate,
                },
            )

        catalog_status = self._persist_catalog(metadata_resolver, parsed_case)
        created_at = self.clock().isoformat(timespec="seconds")
        yaml_text = _render_with_created_at(yaml_text, parsed_case, created_at)
        self.repository.write_yaml(output_path, yaml_text)
        return {
            "ok": True,
            "name": case_name,
            "file": str(output_path.relative_to(self.skill_root)),
            "overwritten": False,
            "action": "生成",
            "renamed_from": requested_name if case_name != requested_name else "",
            "generation_gate": generation_gate,
            "field_type_catalog_status": catalog_status,
        }

    def _metadata_resolver(self, env_id: str) -> Any:
        if not env_id or self.metadata_resolver_factory is None:
            return None
        try:
            return self.metadata_resolver_factory(env_id)
        except Exception:
            return None

    def _persist_catalog(
        self,
        metadata_resolver: Any,
        parsed_case: dict[str, Any],
    ) -> dict[str, Any]:
        default = {"enabled": False, "entity_count": 0, "field_count": 0}
        if (
            metadata_resolver is None
            or self.catalog_updater is None
            or self.entity_id_collector is None
        ):
            return default
        try:
            return self.catalog_updater(
                metadata_resolver,
                self.entity_id_collector(parsed_case),
            )
        except Exception:
            return default


def _render_with_created_at(
    original_yaml: str,
    parsed_case: dict[str, Any],
    created_at: str,
) -> str:
    """Insert created_at through the parsed object while preserving header comments."""
    header: list[str] = []
    for line in original_yaml.splitlines():
        if line.startswith("#") or not line.strip():
            header.append(line)
            continue
        break
    ordered = OrderedDict()
    for key, value in parsed_case.items():
        ordered[key] = value
        if key == "name":
            ordered["created_at"] = created_at
    if "created_at" not in ordered:
        ordered = OrderedDict([("created_at", created_at), *ordered.items()])
    from lib.har_extractor import to_yaml

    prefix = "\n".join(header).rstrip()
    rendered = to_yaml(ordered) + "\n"
    return f"{prefix}\n{rendered}" if prefix else rendered

