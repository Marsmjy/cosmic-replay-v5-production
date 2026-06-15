"""Filesystem case repository with atomic YAML writes."""
from __future__ import annotations

from pathlib import Path


class FileCaseRepository:
    def write_yaml(self, path: Path, yaml_text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(yaml_text, encoding="utf-8")
        temporary.replace(path)

