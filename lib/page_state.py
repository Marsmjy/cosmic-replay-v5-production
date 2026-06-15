"""Runtime window state machine for L0/L2/L3 pageId lifecycles."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Mapping


_L0 = re.compile(r"^root[0-9a-f]{32}$")
_L2 = re.compile(r"^\d+root[0-9a-f]{32}$")
_L3 = re.compile(r"^(?:[0-9a-f]{32}|[0-9a-f-]{36})$")


class WindowStateError(RuntimeError):
    """Raised when a request attempts to use an unsafe window state."""


@dataclass
class WindowRecord:
    form_id: str
    page_id: str
    role: str
    generation: int
    status: str
    source: str
    parent_form_id: str = ""
    parent_page_id: str = ""


class WindowStateMachine:
    """Track page ownership, close/reopen generations, and stale reuse."""

    def __init__(self):
        self._current: dict[str, WindowRecord] = {}
        self._history: list[WindowRecord] = []
        self._closed_page_ids: set[str] = set()
        self._issues: list[dict[str, Any]] = []

    def bind(
        self,
        form_id: str,
        page_id: str,
        *,
        source: str,
        parent_form_id: str = "",
        parent_page_id: str = "",
    ) -> WindowRecord | None:
        form_id = str(form_id or "").strip()
        page_id = str(page_id or "").strip()
        if not form_id or not page_id:
            return None
        current = self._current.get(form_id)
        if current and current.page_id == page_id and current.status == "open":
            return current
        generation = (current.generation + 1) if current else 1
        if current and current.status == "open":
            current.status = "replaced"
        status = "stale_reuse" if page_id in self._closed_page_ids else "open"
        record = WindowRecord(
            form_id=form_id,
            page_id=page_id,
            role=classify_window_role(page_id),
            generation=generation,
            status=status,
            source=str(source or "runtime"),
            parent_form_id=str(parent_form_id or ""),
            parent_page_id=str(parent_page_id or ""),
        )
        self._current[form_id] = record
        self._history.append(record)
        if status == "stale_reuse":
            self._issues.append({
                "code": "closed_pageid_reused",
                "form_id": form_id,
                "page_id_ref": _page_ref(page_id),
                "generation": generation,
                "source": source,
            })
        return record

    def sync(self, page_ids: Mapping[str, Any], *, source: str) -> None:
        for form_id, page_id in page_ids.items():
            self.bind(str(form_id), str(page_id), source=source)

    def close_page(self, page_id: str, *, source: str) -> None:
        page_id = str(page_id or "").strip()
        if not page_id:
            return
        self._closed_page_ids.add(page_id)
        for record in self._current.values():
            if record.page_id == page_id and record.status == "open":
                record.status = "closed"
                record.source = str(source or record.source)

    def close_form(self, form_id: str, *, source: str) -> None:
        record = self._current.get(str(form_id or ""))
        if record:
            self.close_page(record.page_id, source=source)

    def assert_usable(self, form_id: str, page_id: str) -> None:
        form_id = str(form_id or "")
        page_id = str(page_id or "")
        record = self._current.get(form_id)
        if page_id in self._closed_page_ids:
            raise WindowStateError(
                f"{form_id} attempted to reuse a closed pageId ({_page_ref(page_id)})"
            )
        if record and record.page_id == page_id and record.status != "open":
            raise WindowStateError(
                f"{form_id} window is {record.status} ({_page_ref(page_id)})"
            )

    def is_usable(self, form_id: str, page_id: str) -> bool:
        try:
            self.assert_usable(form_id, page_id)
        except WindowStateError:
            return False
        return bool(str(page_id or "").strip())

    def ingest_response(self, response: Any, *, invoking_form: str = "") -> None:
        close_without_page = False

        def walk(node: Any, parent_page_id: str = "") -> None:
            nonlocal close_without_page
            if isinstance(node, list):
                for item in node:
                    walk(item, parent_page_id)
                return
            if not isinstance(node, dict):
                return
            page_id = str(node.get("pageId") or parent_page_id or "")
            action = str(node.get("a") or node.get("methodname") or node.get("methodName") or "")
            if action == "showForm":
                for item in node.get("p") or []:
                    if not isinstance(item, Mapping):
                        continue
                    child_page_id = str(item.get("pageId") or "")
                    parent_id = str(item.get("parentPageId") or page_id or "")
                    for key in ("formId", "billFormId"):
                        form_id = str(item.get(key) or "")
                        if form_id and child_page_id:
                            self.bind(
                                form_id,
                                child_page_id,
                                source="response.showForm",
                                parent_page_id=parent_id,
                            )
            if action in {"closeWindow", "closePage", "closeBrowserPage"}:
                closed_ids = _collect_page_ids(node)
                if closed_ids:
                    for closed_id in closed_ids:
                        self.close_page(closed_id, source=f"response.{action}")
                else:
                    close_without_page = True
            for child in node.values():
                if isinstance(child, (dict, list)):
                    walk(child, page_id)

        walk(response)
        if close_without_page and invoking_form:
            self.close_form(invoking_form, source="response.close_without_page")

    def snapshot(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "current": [
                {
                    "form_id": record.form_id,
                    "page_id_ref": _page_ref(record.page_id),
                    "role": record.role,
                    "generation": record.generation,
                    "status": record.status,
                    "source": record.source,
                    "parent_page_id_ref": _page_ref(record.parent_page_id),
                }
                for record in self._current.values()
            ],
            "issue_count": len(self._issues),
            "issues": list(self._issues[-20:]),
            "policy": {
                "closed_pageid_reuse_allowed": False,
                "reopen_requires_new_pageid": True,
            },
        }


def classify_window_role(page_id: str) -> str:
    value = str(page_id or "")
    if _L0.fullmatch(value):
        return "L0"
    if _L2.fullmatch(value):
        return "L2"
    if _L3.fullmatch(value):
        return "L3"
    return "unknown"


def _collect_page_ids(node: Any) -> set[str]:
    found: set[str] = set()

    def walk(value: Any) -> None:
        if isinstance(value, Mapping):
            for key, child in value.items():
                if key in {"pageId", "parentPageId"} and isinstance(child, str) and child:
                    found.add(child)
                elif isinstance(child, (Mapping, list)):
                    walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(node)
    return found


def _page_ref(page_id: str) -> str:
    if not page_id:
        return ""
    return hashlib.sha256(page_id.encode("utf-8")).hexdigest()[:12]
