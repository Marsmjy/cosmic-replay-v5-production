#!/usr/bin/env python3
"""API-driven HAR regression test suite.

Executes the full four-phase business flow (preview -> env-field resolve ->
generate YAML -> run case) for every HAR file under a directory, driving the
FastAPI server through real HTTP endpoints.  Produces JSON + Markdown reports.

Usage:
    python scripts/api_regression_test.py --har-dir "C:\\...\\回归专用HAR" --base-url http://127.0.0.1:8768
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

DEFAULT_HAR_DIR = Path(r"C:\Users\kingdee\Desktop\HAR场景录制库\回归专用HAR")
DEFAULT_OUTPUT = PROJECT_ROOT / "tmp" / "api_regression"
DEFAULT_BASE_URL = "http://127.0.0.1:8768"
CONFIRM_TOKEN = "YES_GENERATE_TEST_DATA"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_filename(value: str, *, max_len: int = 80) -> str:
    text = re.sub(r"[\\/:*?\"<>|\s]+", "_", value.strip())
    text = re.sub(r"_+", "_", text).strip("_")
    return (text or "sample")[:max_len]


def _sample_id(index: int, har_path: Path) -> str:
    return f"{index:02d}_{_safe_filename(har_path.stem, max_len=48)}"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _normalized_origin(url: str) -> tuple[str, str]:
    parsed = urlparse(str(url or ""))
    host = (parsed.hostname or "").lower()
    port = parsed.port
    netloc = f"{host}:{port}" if host and port else host
    first_path = next((part for part in parsed.path.split("/") if part), "")
    return netloc, first_path.lower()


def _recorded_origins(har_path: Path) -> list[dict[str, Any]]:
    """Extract request origin statistics from a HAR file."""
    try:
        raw = _load_json(har_path)
    except Exception:
        return []
    counts: dict[tuple[str, str], int] = {}
    for entry in ((raw.get("log") or {}).get("entries") or []):
        url = ((entry.get("request") or {}).get("url") or "")
        origin = _normalized_origin(url)
        if origin[0]:
            counts[origin] = counts.get(origin, 0) + 1
    return [
        {"host": host, "base_path": base_path, "request_count": count}
        for (host, base_path), count in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ]


# ---------------------------------------------------------------------------
# Environment auto-detection
# ---------------------------------------------------------------------------

def detect_recorded_env(har_path: Path, envs: list[dict[str, Any]]) -> dict[str, Any]:
    """Match a HAR's recorded origin to a configured environment."""
    origins = _recorded_origins(har_path)
    matches: list[tuple[int, str, dict[str, Any]]] = []
    for origin in origins:
        for env in envs:
            env_host, env_path = _normalized_origin(env.get("base_url", ""))
            if origin["host"] != env_host:
                continue
            score = int(origin["request_count"]) * 10
            if origin["base_path"] and origin["base_path"] == env_path:
                score += 5
            matches.append((score, env.get("id", ""), env))
    if not matches:
        primary = origins[0] if origins else {"host": "", "base_path": "", "request_count": 0}
        return {
            "env_id": "",
            "env_name": "",
            "base_url": "",
            "recorded_host": primary["host"],
            "recorded_base_path": primary["base_path"],
            "request_count": primary["request_count"],
            "status": "unmatched",
        }
    _, env_id, env = max(matches, key=lambda item: (item[0], item[1]))
    return {
        "env_id": env_id,
        "env_name": env.get("name", env_id),
        "base_url": env.get("base_url", ""),
        "recorded_host": matches[0][0] if matches else "",
        "status": "matched",
    }


# ---------------------------------------------------------------------------
# API client
# ---------------------------------------------------------------------------

class APIClient:
    """Thin wrapper around the FastAPI server endpoints."""

    def __init__(self, base_url: str, timeout: int = 300):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()

    def info(self) -> dict[str, Any]:
        r = self.session.get(f"{self.base_url}/api/info", timeout=10)
        r.raise_for_status()
        return r.json()

    def list_envs(self) -> list[dict[str, Any]]:
        r = self.session.get(f"{self.base_url}/api/envs", timeout=10)
        r.raise_for_status()
        return r.json()

    def list_cases(self) -> list[dict[str, Any]]:
        r = self.session.get(f"{self.base_url}/api/cases", timeout=30)
        r.raise_for_status()
        return r.json()

    def get_history(self, limit: int = 20) -> list[dict[str, Any]]:
        r = self.session.get(f"{self.base_url}/api/history", params={"limit": limit}, timeout=10)
        r.raise_for_status()
        return r.json()

    def preview_har(self, har_path: Path, env_id: str) -> dict[str, Any]:
        """Upload a HAR file for preview via raw body endpoint."""
        content = har_path.read_bytes()
        params = {"filename": har_path.name, "env_id": env_id}
        r = self.session.post(
            f"{self.base_url}/api/har/preview",
            params=params,
            data=content,
            headers={"Content-Type": "application/octet-stream"},
            timeout=self.timeout,
        )
        if r.status_code != 200:
            try:
                err_body = r.json()
            except Exception:
                err_body = {"error": r.text[:2000]}
            return {"ok": False, "status_code": r.status_code, **err_body}
        return r.json()

    def resolve_env_fields(self, har_file: str, fields: list[dict], env_id: str) -> dict[str, Any]:
        """Batch-resolve environment-sensitive fields."""
        body = {
            "env_id": env_id,
            "har_file": har_file,
            "fields": fields,
        }
        r = self.session.post(
            f"{self.base_url}/api/env-fields/resolve",
            json=body,
            timeout=self.timeout,
        )
        if r.status_code != 200:
            try:
                err_body = r.json()
            except Exception:
                err_body = {"error": r.text[:2000]}
            return {"ok": False, "status_code": r.status_code, **err_body}
        return r.json()

    def extract_har(self, har_file: str, case_name: str, env_id: str) -> dict[str, Any]:
        """Generate final YAML from a previewed HAR."""
        body = {
            "har_file": har_file,
            "case_name": case_name,
            "env_id": env_id,
        }
        r = self.session.post(
            f"{self.base_url}/api/har/extract",
            json=body,
            timeout=self.timeout,
        )
        if r.status_code != 200:
            try:
                err_body = r.json()
            except Exception:
                err_body = {"error": r.text[:2000]}
            return {"ok": False, "status_code": r.status_code, **err_body}
        return r.json()

    def run_case(self, case_name: str, env_id: str) -> dict[str, Any]:
        """Trigger async case execution, return run_id."""
        r = self.session.post(
            f"{self.base_url}/api/cases/{case_name}/run",
            json={"env_id": env_id},
            timeout=30,
        )
        if r.status_code != 200:
            try:
                err_body = r.json()
            except Exception:
                err_body = {"error": r.text[:2000]}
            return {"ok": False, "status_code": r.status_code, **err_body}
        return r.json()

    def poll_run_events(self, run_id: str, max_wait: int = 600) -> dict[str, Any]:
        """Poll SSE event stream until case completes or timeout."""
        events: list[dict[str, Any]] = []
        final_result: dict[str, Any] = {}
        start = time.monotonic()
        try:
            with self.session.get(
                f"{self.base_url}/api/runs/{run_id}/events",
                stream=True,
                timeout=max_wait + 30,
            ) as resp:
                event_type = ""
                data_lines: list[str] = []
                for raw_line in resp.iter_lines(decode_unicode=True):
                    if raw_line is None:
                        continue
                    if isinstance(raw_line, bytes):
                        raw_line = raw_line.decode("utf-8", errors="replace")
                    line = raw_line.strip()
                    if not line:
                        # Event boundary
                        if event_type and data_lines:
                            data_str = "\n".join(data_lines)
                            try:
                                payload = json.loads(data_str)
                            except json.JSONDecodeError:
                                payload = {"raw": data_str}
                            events.append({"event": event_type, "payload": payload})
                            if event_type == "summary":
                                final_result = payload
                            elif event_type == "case_error":
                                final_result = {"passed": False, "error": payload.get("error", "")}
                        event_type = ""
                        data_lines = []
                        continue
                    if line.startswith("event:"):
                        event_type = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].strip())
                    elif line.startswith(":"):
                        pass  # keepalive comment
                    if time.monotonic() - start > max_wait:
                        break
        except requests.exceptions.Timeout:
            return {
                "ok": False,
                "error": f"SSE timeout after {max_wait}s",
                "events": events,
                "passed": False,
            }
        except Exception as exc:
            return {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "events": events,
                "passed": False,
            }

        # Flush last event
        if event_type and data_lines and not final_result:
            data_str = "\n".join(data_lines)
            try:
                payload = json.loads(data_str)
            except json.JSONDecodeError:
                payload = {"raw": data_str}
            events.append({"event": event_type, "payload": payload})
            if event_type == "summary":
                final_result = payload
            elif event_type == "case_error":
                final_result = {"passed": False, "error": payload.get("error", "")}

        return {
            "ok": True,
            "events": events,
            "summary": final_result,
            "passed": bool(final_result.get("passed")),
            "duration_s": round(time.monotonic() - start, 3),
        }

    def get_case_yaml(self, case_name: str) -> dict[str, Any]:
        r = self.session.get(f"{self.base_url}/api/cases/{case_name}/yaml", timeout=30)
        if r.status_code != 200:
            return {"ok": False, "status_code": r.status_code}
        return r.json()


# ---------------------------------------------------------------------------
# Per-HAR processing
# ---------------------------------------------------------------------------

def _preview_summary(preview: dict[str, Any]) -> dict[str, Any]:
    """Extract key metrics from a preview structure."""
    steps = preview.get("steps") or []
    vars_items = preview.get("detected_vars") or preview.get("vars") or []
    pick_fields = preview.get("pick_fields") or []
    field_catalog = preview.get("field_catalog") or []
    generation_gate = preview.get("generation_gate") or preview.get("preflight", {}).get("generation_gate") or {}
    scenario = preview.get("scenario") or {}

    auto_resolve_count = sum(1 for f in pick_fields if f.get("auto_resolve"))
    env_sensitive_counts: dict[str, int] = {}
    for f in pick_fields:
        level = f.get("env_sensitive", "unknown")
        env_sensitive_counts[level] = env_sensitive_counts.get(level, 0) + 1

    return {
        "main_form_id": preview.get("main_form_id", ""),
        "metadata_status": preview.get("metadata_status", "unknown"),
        "scenario_kind": scenario.get("kind", ""),
        "step_count": len(steps),
        "core_step_count": sum(1 for s in steps if s.get("_tier") == "core"),
        "ui_reaction_step_count": sum(1 for s in steps if s.get("_tier") == "ui_reaction"),
        "vars_count": len(vars_items),
        "vars_names": [v.get("name", "") if isinstance(v, dict) else str(v) for v in vars_items],
        "pick_fields_count": len(pick_fields),
        "auto_resolve_count": auto_resolve_count,
        "env_sensitive_counts": env_sensitive_counts,
        "field_catalog_count": len(field_catalog),
        "generation_gate_allow_generate": bool(generation_gate.get("allow_generate", True)),
        "generation_gate_allow_run": bool(generation_gate.get("allow_run", True)),
        "generation_gate_blockers": [
            str(item.get("message") or item.get("code") or "")
            for item in generation_gate.get("issues") or []
            if isinstance(item, dict) and item.get("blocks_generate")
        ],
    }


def _resolve_summary(resolved_fields: list[dict]) -> dict[str, Any]:
    """Summarise environment field resolution results."""
    status_counts: dict[str, int] = {}
    confidence_counts: dict[str, int] = {}
    for f in resolved_fields:
        status = f.get("resolve_status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        conf = f.get("confidence", "unknown")
        confidence_counts[conf] = confidence_counts.get(conf, 0) + 1
    return {
        "total": len(resolved_fields),
        "status_counts": status_counts,
        "confidence_counts": confidence_counts,
        "resolved_count": status_counts.get("resolved", 0),
        "not_found_count": status_counts.get("not_found", 0),
        "ambiguous_count": status_counts.get("ambiguous", 0),
        "skipped_count": status_counts.get("skipped", 0),
        "manual_count": status_counts.get("manual", 0),
    }


def _execution_summary(run_result: dict[str, Any]) -> dict[str, Any]:
    """Extract key metrics from execution result."""
    summary = run_result.get("summary") or {}
    events = run_result.get("events") or []
    failed_steps = []
    for evt in events:
        if evt.get("event") in ("step_fail", "assertion_fail"):
            payload = evt.get("payload") or {}
            failed_steps.append({
                "id": str(payload.get("step") or payload.get("step_id") or ""),
                "error": str(payload.get("msg") or payload.get("error") or "")[:500],
            })
    return {
        "passed": run_result.get("passed", False),
        "duration_s": run_result.get("duration_s", 0),
        "case_name": summary.get("case_name", ""),
        "main_form_id": summary.get("main_form_id", ""),
        "step_count": summary.get("step_count", 0),
        "failed_steps": failed_steps,
        "write_events": summary.get("write_events", []),
        "assertions": summary.get("assertions", []),
        "error": run_result.get("error", ""),
    }


def process_one_har(
    client: APIClient,
    index: int,
    har_path: Path,
    envs: list[dict[str, Any]],
    *,
    cross_env_test: bool = False,
    skip_execute: bool = False,
) -> dict[str, Any]:
    """Run the full four-phase flow for one HAR file."""
    sample_id = _sample_id(index, har_path)
    title = har_path.stem
    result: dict[str, Any] = {
        "id": sample_id,
        "title": title,
        "har_path": str(har_path),
        "har_size_mb": round(har_path.stat().st_size / 1024 / 1024, 2),
    }

    # --- Environment detection ---
    recorded_env = detect_recorded_env(har_path, envs)
    env_id = recorded_env["env_id"]
    result["recorded_env"] = recorded_env
    if not env_id:
        result["error"] = f"无法匹配HAR录制环境: {recorded_env.get('recorded_host', '')}"
        result["phase"] = "env_detect"
        return result
    result["execution_env"] = env_id
    print(f"  [{index}] env={env_id} host={recorded_env.get('recorded_host', '')}")

    # --- Phase 1: Preview ---
    t0 = time.monotonic()
    try:
        preview_resp = client.preview_har(har_path, env_id)
    except Exception as exc:
        result["error"] = f"预览请求异常: {type(exc).__name__}: {exc}"
        result["phase"] = "preview"
        result["preview_duration_s"] = round(time.monotonic() - t0, 3)
        return result

    result["preview_duration_s"] = round(time.monotonic() - t0, 3)

    if not preview_resp.get("ok"):
        result["error"] = f"预览失败: {preview_resp.get('error', 'unknown')}"
        result["phase"] = "preview"
        result["preview_raw"] = preview_resp
        return result

    preview = preview_resp.get("preview") or {}
    result["preview"] = _preview_summary(preview)
    result["preview"]["metadata_status"] = preview_resp.get("metadata_status", "unknown")
    result["preview"]["field_type_catalog_status"] = preview_resp.get("field_type_catalog_status", {})
    result["har_file"] = preview_resp.get("har_file", "")
    print(f"       preview: steps={result['preview']['step_count']} vars={result['preview']['vars_count']} "
          f"pick_fields={result['preview']['pick_fields_count']} meta={result['preview']['metadata_status']}")

    # --- Phase 2: Env field resolution ---
    pick_fields = preview.get("pick_fields") or []
    auto_resolve_fields = [
        f for f in pick_fields
        if f.get("auto_resolve") and f.get("field_key") and f.get("form_id") and f.get("app_id")
    ]
    t0 = time.monotonic()
    resolve_result: dict[str, Any] = {"total_pick_fields": len(pick_fields), "auto_resolve_count": len(auto_resolve_fields)}
    if auto_resolve_fields:
        try:
            resolve_resp = client.resolve_env_fields(
                result["har_file"],
                auto_resolve_fields,
                env_id,
            )
            if resolve_resp.get("ok"):
                resolved_fields = resolve_resp.get("fields") or []
                resolve_result.update(_resolve_summary(resolved_fields))
                resolve_result["fields_detail"] = [
                    {
                        "step_id": f.get("step_id", ""),
                        "field_key": f.get("field_key", ""),
                        "label": f.get("label", ""),
                        "resolve_status": f.get("resolve_status", ""),
                        "resolved_value_id": f.get("resolved_value_id", ""),
                        "confidence": f.get("confidence", ""),
                        "message": f.get("message", ""),
                    }
                    for f in resolved_fields
                ]
            else:
                resolve_result["error"] = resolve_resp.get("error", "unknown")
        except Exception as exc:
            resolve_result["error"] = f"{type(exc).__name__}: {exc}"
    else:
        resolve_result["skipped_reason"] = "no auto_resolve fields"
    result["resolve_duration_s"] = round(time.monotonic() - t0, 3)
    result["resolve"] = resolve_result
    print(f"       resolve: total={resolve_result.get('total', 0)} resolved={resolve_result.get('resolved_count', 0)} "
          f"not_found={resolve_result.get('not_found_count', 0)}")

    # --- Phase 3: Generate YAML ---
    case_name = f"api_regression_{sample_id}"
    t0 = time.monotonic()
    try:
        extract_resp = client.extract_har(result["har_file"], case_name, env_id)
    except Exception as exc:
        result["error"] = f"用例生成请求异常: {type(exc).__name__}: {exc}"
        result["phase"] = "extract"
        result["extract_duration_s"] = round(time.monotonic() - t0, 3)
        return result

    result["extract_duration_s"] = round(time.monotonic() - t0, 3)

    if not extract_resp.get("ok"):
        result["error"] = f"用例生成失败: {extract_resp.get('error') or extract_resp.get('message', 'unknown')}"
        result["phase"] = "extract"
        result["extract_raw"] = extract_resp
        return result

    result["extract"] = {
        "case_name": extract_resp.get("name", case_name),
        "file": extract_resp.get("file", ""),
        "renamed_from": extract_resp.get("renamed_from", ""),
        "generation_gate": extract_resp.get("generation_gate", {}),
        "field_type_catalog_status": extract_resp.get("field_type_catalog_status", {}),
    }
    actual_case_name = extract_resp.get("name", case_name)
    print(f"       extract: case={actual_case_name}")

    # Read generated YAML for quality checks
    try:
        yaml_resp = client.get_case_yaml(actual_case_name)
        if yaml_resp.get("yaml"):
            result["yaml_analysis"] = _analyze_yaml(yaml_resp["yaml"], yaml_resp.get("field_catalog", []))
    except Exception as exc:
        result["yaml_analysis_error"] = str(exc)

    # --- Phase 4: Execute ---
    if skip_execute:
        result["execution"] = {"status": "skipped"}
        result["phase"] = "complete"
        return result

    t0 = time.monotonic()
    run_resp = client.run_case(actual_case_name, env_id)
    if not run_resp.get("ok") and "run_id" not in run_resp:
        result["error"] = f"执行启动失败: {run_resp.get('error') or run_resp.get('detail', 'unknown')}"
        result["phase"] = "execute_start"
        result["execute_duration_s"] = round(time.monotonic() - t0, 3)
        return result

    run_id = run_resp.get("run_id", "")
    result["run_id"] = run_id

    exec_result = client.poll_run_events(run_id, max_wait=600)
    result["execute_duration_s"] = round(time.monotonic() - t0, 3)
    result["execution"] = _execution_summary(exec_result)

    status = "PASS" if result["execution"].get("passed") else "FAIL"
    print(f"       execute: {status} ({result['execute_duration_s']}s)")

    # --- Cross-environment test ---
    if cross_env_test:
        other_env = next((e for e in envs if e.get("id") != env_id), None)
        if other_env:
            other_env_id = other_env.get("id", "")
            result["cross_env"] = _run_cross_env_test(
                client, actual_case_name, other_env_id, env_id,
            )

    result["phase"] = "complete"
    return result


def _analyze_yaml(yaml_text: str, field_catalog: list) -> dict[str, Any]:
    """Static analysis of generated YAML for quality metrics."""
    import yaml
    try:
        case = yaml.safe_load(yaml_text) or {}
    except Exception as exc:
        return {"error": str(exc)}

    if not isinstance(case, dict):
        return {"error": "YAML root is not a dict"}

    vars_map = case.get("vars") or {}
    env_block = case.get("env") or {}
    steps = case.get("steps") or []
    pick_fields = case.get("pick_fields") or {}

    # Check for ${env:...} placeholders
    env_placeholders: list[str] = []
    for key, val in env_block.items():
        if isinstance(val, str) and "${env:" in val:
            env_placeholders.append(key)

    # Check for randomization in vars
    randomised_vars: list[str] = []
    non_randomised_candidates: list[str] = []
    unique_hints = {"number", "code", "name", "email", "phone", "peremail"}
    for vname, vval in vars_map.items():
        vstr = str(vval or "")
        if "${rand:" in vstr or "${timestamp}" in vstr:
            randomised_vars.append(vname)
        elif any(h in vname.lower() for h in unique_hints):
            non_randomised_candidates.append(vname)

    # Check sign_required
    sign_required = case.get("sign_required")

    return {
        "vars_count": len(vars_map),
        "vars_names": list(vars_map.keys()),
        "randomised_vars": randomised_vars,
        "non_randomised_unique_vars": non_randomised_candidates,
        "env_keys": list(env_block.keys()),
        "env_placeholders": env_placeholders,
        "sign_required": sign_required,
        "step_count": len(steps),
        "pick_fields_count": sum(len(v) if isinstance(v, list) else 0 for v in pick_fields.values()),
        "field_catalog_count": len(field_catalog),
        "has_assertions": bool(case.get("assertions")),
    }


def _run_cross_env_test(
    client: APIClient,
    case_name: str,
    target_env: str,
    source_env: str,
) -> dict[str, Any]:
    """Execute a case on a non-recorded environment to verify _merge_env_into_case."""
    print(f"       cross-env: running on {target_env} (recorded: {source_env})")
    t0 = time.monotonic()
    run_resp = client.run_case(case_name, target_env)
    if not run_resp.get("ok") and "run_id" not in run_resp:
        return {
            "target_env": target_env,
            "error": run_resp.get("error") or run_resp.get("detail", "unknown"),
            "passed": False,
        }

    run_id = run_resp.get("run_id", "")
    exec_result = client.poll_run_events(run_id, max_wait=600)
    summary = _execution_summary(exec_result)
    return {
        "target_env": target_env,
        "source_env": source_env,
        "passed": summary.get("passed", False),
        "duration_s": round(time.monotonic() - t0, 3),
        "failed_steps": summary.get("failed_steps", []),
        "error": summary.get("error", ""),
    }


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def _classify_failure(result: dict[str, Any]) -> str:
    """Classify the failure type for a result."""
    if result.get("phase") == "complete" and result.get("execution", {}).get("passed"):
        return "passed"
    if result.get("phase") in ("env_detect", "preview", "extract", "execute_start"):
        return result["phase"]
    execution = result.get("execution") or {}
    if execution.get("status") == "skipped":
        return "skipped"
    failed_text = " ".join(
        str(s.get("error", ""))
        for s in execution.get("failed_steps") or []
    )
    if "必填" in failed_text or "请填写" in failed_text:
        return "required_field_missing"
    if "重复" in failed_text or "duplicate" in failed_text.lower():
        return "business_duplicate"
    if "pageid" in failed_text.lower() or "page id" in failed_text.lower():
        return "pageid_chain"
    if "timeout" in failed_text.lower():
        return "timeout"
    if "traceid" in failed_text.lower() or "java.lang" in failed_text.lower():
        return "backend_runtime_exception"
    if "attributeerror" in failed_text.lower() or "typeerror" in failed_text.lower():
        return "executor_error"
    return "execution_failed"


def _write_markdown_report(path: Path, report: dict[str, Any]) -> None:
    lines = [
        "# HAR 全流程 API 端点验证报告",
        "",
        f"- 生成时间: {report.get('generated_at')}",
        f"- 服务器: `{report.get('base_url')}`",
        f"- HAR 目录: `{report.get('har_dir')}`",
        f"- 样本数: {report.get('sample_count')}",
        f"- 总耗时: {report.get('total_duration_s')}s",
        "",
        "## 汇总统计",
        "",
        f"| 指标 | 数值 |",
        f"|------|------|",
        f"| 环境检测成功 | {report.get('env_detect_ok', 0)}/{report.get('sample_count')} |",
        f"| 预览成功 | {report.get('preview_ok', 0)}/{report.get('sample_count')} |",
        f"| 用例生成成功 | {report.get('extract_ok', 0)}/{report.get('sample_count')} |",
        f"| 执行通过 | {report.get('exec_pass', 0)}/{report.get('exec_total', 0)} |",
        f"| 环境字段解析成功率 | {report.get('resolve_success_rate', '0%')} |",
        f"| 跨环境验证 | {report.get('cross_env_pass', 0)}/{report.get('cross_env_total', 0)} |",
        "",
        "## 单样本结果",
        "",
    ]

    for item in report.get("results") or []:
        preview = item.get("preview") or {}
        resolve = item.get("resolve") or {}
        extract = item.get("extract") or {}
        execution = item.get("execution") or {}
        yaml_analysis = item.get("yaml_analysis") or {}
        failure_kind = item.get("failure_kind", "")

        lines.append(f"### {item.get('id')} - {item.get('title')}")
        lines.append(f"- HAR 大小: {item.get('har_size_mb', 0)}MB")
        lines.append(f"- 录制环境: `{item.get('recorded_env', {}).get('env_id', '')}` ({item.get('recorded_env', {}).get('recorded_host', '')})")
        lines.append(f"- 失败分类: `{failure_kind}`")
        lines.append("")
        lines.append("**预览阶段:**")
        lines.append(f"- metadata_status: `{preview.get('metadata_status', '')}`")
        lines.append(f"- 主表单: `{preview.get('main_form_id', '')}`")
        lines.append(f"- 步骤数: {preview.get('step_count', 0)} (core={preview.get('core_step_count', 0)}, ui_reaction={preview.get('ui_reaction_step_count', 0)})")
        lines.append(f"- 变量数: {preview.get('vars_count', 0)}")
        lines.append(f"- pick_fields: {preview.get('pick_fields_count', 0)} (auto_resolve={preview.get('auto_resolve_count', 0)})")
        lines.append(f"- env_sensitive 分布: {preview.get('env_sensitive_counts', {})}")
        lines.append(f"- field_catalog: {preview.get('field_catalog_count', 0)}")
        if preview.get("generation_gate_blockers"):
            lines.append(f"- generation_gate 阻断: {'; '.join(preview['generation_gate_blockers'])}")
        lines.append(f"- 预览耗时: {item.get('preview_duration_s', 0)}s")
        lines.append("")
        lines.append("**环境字段解析阶段:**")
        lines.append(f"- 总 pick_fields: {resolve.get('total_pick_fields', 0)}")
        lines.append(f"- auto_resolve: {resolve.get('auto_resolve_count', 0)}")
        lines.append(f"- resolved: {resolve.get('resolved_count', 0)}, not_found: {resolve.get('not_found_count', 0)}, ambiguous: {resolve.get('ambiguous_count', 0)}")
        if resolve.get("error"):
            lines.append(f"- 解析错误: {resolve['error']}")
        lines.append(f"- 解析耗时: {item.get('resolve_duration_s', 0)}s")
        lines.append("")
        lines.append("**用例生成阶段:**")
        lines.append(f"- 用例名: `{extract.get('case_name', '')}`")
        lines.append(f"- 文件: `{extract.get('file', '')}`")
        if extract.get("renamed_from"):
            lines.append(f"- 重命名自: `{extract['renamed_from']}`")
        lines.append(f"- 生成耗时: {item.get('extract_duration_s', 0)}s")
        lines.append("")
        if yaml_analysis:
            lines.append("**YAML 质量分析:**")
            lines.append(f"- vars: {yaml_analysis.get('vars_count', 0)} 个 -> {yaml_analysis.get('vars_names', [])}")
            lines.append(f"- 已随机化: {yaml_analysis.get('randomised_vars', [])}")
            if yaml_analysis.get('non_randomised_unique_vars'):
                lines.append(f"- ⚠ 未随机化唯一字段: {yaml_analysis['non_randomised_unique_vars']}")
            lines.append(f"- env 块: {yaml_analysis.get('env_keys', [])}, 占位符: {yaml_analysis.get('env_placeholders', [])}")
            lines.append(f"- sign_required: {yaml_analysis.get('sign_required')}")
            lines.append(f"- 步骤数: {yaml_analysis.get('step_count', 0)}")
            lines.append(f"- assertions: {yaml_analysis.get('has_assertions', False)}")
            lines.append("")
        lines.append("**执行阶段:**")
        if execution.get("status") == "skipped":
            lines.append("- 已跳过")
        else:
            status = "PASS" if execution.get("passed") else "FAIL"
            lines.append(f"- 结果: **{status}**")
            lines.append(f"- 耗时: {execution.get('duration_s', 0)}s")
            lines.append(f"- 步骤数: {execution.get('step_count', 0)}")
            if execution.get("failed_steps"):
                for fs in execution["failed_steps"][:3]:
                    lines.append(f"- 失败步骤: `{fs.get('id', '')}` - {fs.get('error', '')[:200]}")
            if execution.get("error"):
                lines.append(f"- 错误: {execution['error'][:300]}")
            lines.append(f"- 执行耗时: {item.get('execute_duration_s', 0)}s")
        cross_env = item.get("cross_env")
        if cross_env:
            ce_status = "PASS" if cross_env.get("passed") else "FAIL"
            lines.append("")
            lines.append("**跨环境验证:**")
            lines.append(f"- 目标环境: `{cross_env.get('target_env', '')}` (录制环境: `{cross_env.get('source_env', '')}`)")
            lines.append(f"- 结果: **{ce_status}** ({cross_env.get('duration_s', 0)}s)")
            if cross_env.get("failed_steps"):
                for fs in cross_env["failed_steps"][:2]:
                    lines.append(f"- 失败步骤: `{fs.get('id', '')}` - {fs.get('error', '')[:200]}")
        lines.append("")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def _write_quality_report(path: Path, report: dict[str, Any]) -> None:
    """Write quality assessment and optimisation recommendations."""
    lines = [
        "# 质量评估与优化建议",
        "",
        f"- 生成时间: {report.get('generated_at')}",
        "",
        "## 1. 统计汇总",
        "",
    ]

    stats = report.get("stats") or {}
    for key, val in stats.items():
        lines.append(f"- **{key}**: {val}")

    lines.extend(["", "## 2. 变量完整性分析", ""])
    var_issues = report.get("var_issues") or []
    if var_issues:
        for issue in var_issues:
            lines.append(f"- ⚠ `{issue.get('sample', '')}`: {issue.get('issue', '')}")
    else:
        lines.append("- 所有用例的变量随机化覆盖良好，未发现遗漏。")

    lines.extend(["", "## 3. 字段识别准确性", ""])
    field_issues = report.get("field_issues") or []
    if field_issues:
        for issue in field_issues:
            lines.append(f"- ⚠ `{issue.get('sample', '')}`: {issue.get('issue', '')}")
    else:
        lines.append("- 字段识别准确，auto_resolve 标记合理。")

    lines.extend(["", "## 4. 环境合并逻辑验证", ""])
    env_issues = report.get("env_issues") or []
    if env_issues:
        for issue in env_issues:
            lines.append(f"- ⚠ `{issue.get('sample', '')}`: {issue.get('issue', '')}")
    else:
        lines.append("- _merge_env_into_case 环境合并逻辑验证通过。")

    lines.extend(["", "## 5. 性能分析", ""])
    perf = report.get("performance") or {}
    lines.append(f"- 平均预览耗时: {perf.get('avg_preview_s', 0)}s")
    lines.append(f"- 平均解析耗时: {perf.get('avg_resolve_s', 0)}s")
    lines.append(f"- 平均生成耗时: {perf.get('avg_extract_s', 0)}s")
    lines.append(f"- 平均执行耗时: {perf.get('avg_execute_s', 0)}s")
    lines.append(f"- 最大预览耗时: {perf.get('max_preview_s', 0)}s (HAR: {perf.get('max_preview_sample', '')})")
    lines.append(f"- 最大执行耗时: {perf.get('max_execute_s', 0)}s (HAR: {perf.get('max_execute_sample', '')})")

    lines.extend(["", "## 6. 优化建议", ""])
    recommendations = report.get("recommendations") or []
    for rec in recommendations:
        priority = rec.get("priority", "medium")
        lines.append(f"### [{priority.upper()}] {rec.get('title', '')}")
        lines.append(f"- **问题**: {rec.get('problem', '')}")
        lines.append(f"- **建议**: {rec.get('recommendation', '')}")
        lines.append(f"- **影响文件**: `{rec.get('file', '')}`")
        lines.append("")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def _build_quality_assessment(report: dict[str, Any]) -> dict[str, Any]:
    """Analyse results and build quality assessment."""
    results = report.get("results") or []

    # Var completeness
    var_issues: list[dict] = []
    for item in results:
        ya = item.get("yaml_analysis") or {}
        if ya.get("non_randomised_unique_vars"):
            var_issues.append({
                "sample": item.get("id", ""),
                "issue": f"未随机化唯一字段: {', '.join(ya['non_randomised_unique_vars'])}",
            })

    # Field identification accuracy
    field_issues: list[dict] = []
    for item in results:
        resolve = item.get("resolve") or {}
        if resolve.get("ambiguous_count", 0) > 0:
            field_issues.append({
                "sample": item.get("id", ""),
                "issue": f"存在 {resolve['ambiguous_count']} 个歧义字段",
            })
        if resolve.get("not_found_count", 0) > 0:
            field_issues.append({
                "sample": item.get("id", ""),
                "issue": f"存在 {resolve['not_found_count']} 个未找到字段",
            })

    # Env merge logic
    env_issues: list[dict] = []
    for item in results:
        cross_env = item.get("cross_env")
        if cross_env and not cross_env.get("passed"):
            env_issues.append({
                "sample": item.get("id", ""),
                "issue": f"跨环境执行失败: {cross_env.get('error', '')}",
            })

    # Performance
    preview_times = [r.get("preview_duration_s", 0) for r in results if r.get("preview_duration_s")]
    resolve_times = [r.get("resolve_duration_s", 0) for r in results if r.get("resolve_duration_s")]
    extract_times = [r.get("extract_duration_s", 0) for r in results if r.get("extract_duration_s")]
    execute_times = [r.get("execute_duration_s", 0) for r in results if r.get("execute_duration_s")]

    max_preview = max(preview_times) if preview_times else 0
    max_preview_idx = next((i for i, r in enumerate(results) if r.get("preview_duration_s") == max_preview), -1)
    max_execute = max(execute_times) if execute_times else 0
    max_execute_idx = next((i for i, r in enumerate(results) if r.get("execute_duration_s") == max_execute), -1)

    performance = {
        "avg_preview_s": round(sum(preview_times) / len(preview_times), 3) if preview_times else 0,
        "avg_resolve_s": round(sum(resolve_times) / len(resolve_times), 3) if resolve_times else 0,
        "avg_extract_s": round(sum(extract_times) / len(extract_times), 3) if extract_times else 0,
        "avg_execute_s": round(sum(execute_times) / len(execute_times), 3) if execute_times else 0,
        "max_preview_s": max_preview,
        "max_preview_sample": results[max_preview_idx].get("id", "") if max_preview_idx >= 0 else "",
        "max_execute_s": max_execute,
        "max_execute_sample": results[max_execute_idx].get("id", "") if max_execute_idx >= 0 else "",
    }

    # Recommendations
    recommendations: list[dict] = []
    if var_issues:
        recommendations.append({
            "priority": "high",
            "title": "变量随机化覆盖不完整",
            "problem": f"{len(var_issues)} 个用例存在未随机化的唯一字段（number/code/name等），可能导致重复执行失败",
            "recommendation": "在 har_extractor.detect_var_placeholders 中增强唯一字段识别逻辑，或在 build_yaml_case 中自动为唯一字段追加 ${rand:6}",
            "file": "lib/har_extractor.py",
        })
    if field_issues:
        recommendations.append({
            "priority": "medium",
            "title": "环境字段解析存在歧义/未找到",
            "problem": f"{len(field_issues)} 个用例的环境字段解析存在 not_found 或 ambiguous 状态",
            "recommendation": "增强 FieldResolver._select_candidate 的模糊匹配能力，或提供更多候选选择策略",
            "file": "lib/field_resolver.py",
        })
    if env_issues:
        recommendations.append({
            "priority": "high",
            "title": "跨环境执行失败",
            "problem": f"{len(env_issues)} 个用例在非录制环境执行失败",
            "recommendation": "检查 _merge_env_into_case 的环境覆盖逻辑和 FieldResolver 的跨环境解析能力",
            "file": "lib/webui/server.py",
        })
    if performance.get("max_preview_s", 0) > 120:
        recommendations.append({
            "priority": "medium",
            "title": "大文件预览耗时过长",
            "problem": f"最大预览耗时 {performance['max_preview_s']}s（{performance['max_preview_sample']}）",
            "recommendation": "考虑对大 HAR 文件进行流式解析或预处理裁剪，减少内存占用",
            "file": "lib/har_extractor.py",
        })
    recommendations.append({
        "priority": "low",
        "title": "importlib.reload(har_extractor) 并发风险",
        "problem": "api_har_preview 每次调用都 importlib.reload(har_extractor)，并发场景下可能导致模块引用失效",
        "recommendation": "移除热重载逻辑或改为开发模式可选（通过环境变量控制）",
        "file": "lib/webui/server.py:1606",
    })
    recommendations.append({
        "priority": "low",
        "title": "MetadataResolver 超时偏短",
        "problem": "getEntityType.do 请求超时仅 5 秒，大型实体可能不够",
        "recommendation": "将超时改为可配置（如 10-15 秒），或在 Config 中增加 metadata_timeout 参数",
        "file": "lib/metadata_resolver.py:129",
    })
    recommendations.append({
        "priority": "low",
        "title": "_field_labels_cache_merged 无失效机制",
        "problem": "全局缓存初始化后不会刷新，知识库更新后需重启服务器",
        "recommendation": "添加 TTL 或手动刷新接口",
        "file": "lib/webui/server.py:525",
    })

    return {
        "var_issues": var_issues,
        "field_issues": field_issues,
        "env_issues": env_issues,
        "performance": performance,
        "recommendations": recommendations,
    }


# ---------------------------------------------------------------------------
# Main suite
# ---------------------------------------------------------------------------

def run_suite(args: argparse.Namespace) -> dict[str, Any]:
    har_dir = Path(args.har_dir).resolve()
    if not har_dir.exists():
        raise SystemExit(f"HAR directory not found: {har_dir}")
    har_files = sorted(path for path in har_dir.rglob("*.har") if path.is_file())
    if not har_files:
        raise SystemExit(f"No .har files found under: {har_dir}")

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    client = APIClient(args.base_url, timeout=args.timeout)

    # Verify server connectivity
    print(f"Connecting to {args.base_url} ...")
    try:
        info = client.info()
        print(f"  Server version: {info.get('version', '?')}")
    except Exception as exc:
        raise SystemExit(f"Cannot connect to server: {exc}")

    envs = client.list_envs()
    print(f"  Environments: {[e.get('id', '?') for e in envs]}")
    if len(envs) < 2:
        print("  WARNING: Fewer than 2 environments configured, cross-env test will be limited.")

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    results: list[dict[str, Any]] = []
    started = datetime.now()

    # Determine which samples get cross-env test (first 3 successful extractions)
    cross_env_indices = set()

    for index, har_path in enumerate(har_files, start=1):
        title = har_path.stem
        print(f"\n[{index}/{len(har_files)}] {title}")

        do_cross_env = args.cross_env and index <= 3
        result = process_one_har(
            client,
            index,
            har_path,
            envs,
            cross_env_test=do_cross_env,
            skip_execute=args.skip_execute,
        )
        result["failure_kind"] = _classify_failure(result)
        results.append(result)

        # Early abort on blocking error
        if result.get("phase") in ("env_detect",) and not args.continue_on_error:
            print(f"  BLOCKING ERROR: {result.get('error', '')}")
            print("  Use --continue-on-error to skip blocking errors.")
            break

    finished = datetime.now()

    # Compute stats
    sample_count = len(results)
    env_detect_ok = sum(1 for r in results if r.get("recorded_env", {}).get("status") == "matched")
    preview_ok = sum(1 for r in results if r.get("preview"))
    extract_ok = sum(1 for r in results if r.get("extract"))
    exec_results = [r for r in results if r.get("execution") and r.get("execution", {}).get("status") != "skipped"]
    exec_pass = sum(1 for r in exec_results if r["execution"].get("passed"))
    exec_total = len(exec_results)

    # Resolve success rate
    total_resolved = sum((r.get("resolve") or {}).get("resolved_count", 0) for r in results)
    total_auto_resolve = sum((r.get("resolve") or {}).get("auto_resolve_count", 0) for r in results)
    resolve_success_rate = f"{round(total_resolved / total_auto_resolve * 100, 1)}%" if total_auto_resolve else "N/A"

    # Cross-env
    cross_env_results = [r.get("cross_env") for r in results if r.get("cross_env")]
    cross_env_pass = sum(1 for ce in cross_env_results if ce and ce.get("passed"))
    cross_env_total = len(cross_env_results)

    report = {
        "generated_at": finished.isoformat(timespec="seconds"),
        "base_url": args.base_url,
        "har_dir": str(har_dir),
        "output_dir": str(output_dir),
        "sample_count": sample_count,
        "total_duration_s": round((finished - started).total_seconds(), 3),
        "env_detect_ok": env_detect_ok,
        "preview_ok": preview_ok,
        "extract_ok": extract_ok,
        "exec_pass": exec_pass,
        "exec_total": exec_total,
        "resolve_success_rate": resolve_success_rate,
        "cross_env_pass": cross_env_pass,
        "cross_env_total": cross_env_total,
        "results": results,
    }

    # Build quality assessment
    quality = _build_quality_assessment(report)
    report["stats"] = {
        "样本数": sample_count,
        "环境检测成功": f"{env_detect_ok}/{sample_count}",
        "预览成功": f"{preview_ok}/{sample_count}",
        "用例生成成功": f"{extract_ok}/{sample_count}",
        "执行通过": f"{exec_pass}/{exec_total}",
        "环境字段解析成功率": resolve_success_rate,
        "跨环境验证通过": f"{cross_env_pass}/{cross_env_total}",
    }
    report.update(quality)

    # Write reports
    json_path = output_dir / "summary.json"
    md_path = output_dir / "summary.md"
    quality_path = output_dir / "quality_assessment.md"

    _write_json(json_path, report)
    _write_markdown_report(md_path, report)
    _write_quality_report(quality_path, report)

    print(f"\n{'='*60}")
    print(f"Report JSON:     {json_path}")
    print(f"Report Markdown: {md_path}")
    print(f"Quality Report:  {quality_path}")
    print(f"{'='*60}")
    print(f"Preview OK:      {preview_ok}/{sample_count}")
    print(f"Extract OK:      {extract_ok}/{sample_count}")
    print(f"Execute PASS:    {exec_pass}/{exec_total}")
    print(f"Resolve Rate:    {resolve_success_rate}")
    print(f"Cross-env:       {cross_env_pass}/{cross_env_total}")
    print(f"Total duration:  {report['total_duration_s']}s")

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--har-dir", type=str, default=str(DEFAULT_HAR_DIR))
    parser.add_argument("--base-url", type=str, default=DEFAULT_BASE_URL)
    parser.add_argument("--output-dir", type=str, default=str(DEFAULT_OUTPUT))
    parser.add_argument("--timeout", type=int, default=600, help="Per-request timeout in seconds")
    parser.add_argument("--cross-env", action="store_true", default=True, help="Enable cross-environment test for first 3 samples")
    parser.add_argument("--no-cross-env", dest="cross_env", action="store_false")
    parser.add_argument("--skip-execute", action="store_true", help="Skip case execution phase")
    parser.add_argument("--continue-on-error", action="store_true", help="Continue on blocking errors")
    args = parser.parse_args(argv)

    report = run_suite(args)
    # Return non-zero if any execution failed
    if report.get("exec_total", 0) > 0 and report.get("exec_pass", 0) < report.get("exec_total", 0):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
