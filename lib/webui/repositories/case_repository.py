"""Filesystem case repository with atomic YAML writes."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


class FileCaseRepository:
    def read(self, path: Path) -> dict[str, Any]:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(data, dict):
            raise ValueError("YAML 顶层必须是对象")
        return data

    def write_yaml(self, path: Path, yaml_text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(yaml_text, encoding="utf-8")
        temporary.replace(path)

    def write(self, path: Path, data: dict[str, Any]) -> None:
        self.write_yaml(
            path,
            yaml.safe_dump(
                data,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
            ),
        )
