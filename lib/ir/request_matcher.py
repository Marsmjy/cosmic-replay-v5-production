"""Deterministic request matching with explicit ambiguity diagnostics."""
from __future__ import annotations

import json
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse


IGNORED_HEADERS = {
    "authorization",
    "cookie",
    "content-length",
    "host",
    "kd-csrf-token",
    "set-cookie",
    "traceid",
    "x-request-id",
}


def match_request(
    expected: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Return ``exact``, ``semantic``, ``ambiguous``, or ``not_found``."""
    expected_signature = _signature(expected)
    rows: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates):
        signature = _signature(candidate)
        exact = signature == expected_signature
        score, reasons = _semantic_score(expected_signature, signature)
        rows.append({
            "index": index,
            "exact": exact,
            "score": score,
            "reasons": reasons,
        })

    exact_rows = [row for row in rows if row["exact"]]
    if len(exact_rows) == 1:
        return _result("exact", exact_rows[0], rows)
    if len(exact_rows) > 1:
        return _result("ambiguous", None, exact_rows)

    ranked = sorted(rows, key=lambda row: (-row["score"], row["index"]))
    if not ranked or ranked[0]["score"] < 6:
        return _result("not_found", None, ranked[:5])
    top_score = ranked[0]["score"]
    top = [row for row in ranked if row["score"] == top_score]
    if len(top) != 1:
        return _result("ambiguous", None, top)
    return _result("semantic", top[0], ranked[:5])


def _result(
    status: str,
    match: Mapping[str, Any] | None,
    considered: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    return {
        "status": status,
        "matched_index": match.get("index") if match else None,
        "score": match.get("score") if match else 0,
        "reasons": list(match.get("reasons") or []) if match else [],
        "candidate_count": len(considered),
        "candidates": [
            {
                "index": row.get("index"),
                "score": row.get("score"),
                "reasons": list(row.get("reasons") or []),
            }
            for row in considered[:10]
        ],
    }


def _signature(request: Mapping[str, Any]) -> dict[str, Any]:
    headers = request.get("headers") if isinstance(request.get("headers"), Mapping) else {}
    normalized_headers = {
        str(key).strip().lower(): str(value)
        for key, value in headers.items()
        if str(key).strip().lower() not in IGNORED_HEADERS
    }
    body = request.get("body", request.get("body_params"))
    return {
        "method": str(request.get("method") or "").upper(),
        "path": _path(request),
        "query_keys": sorted(_mapping_keys(request.get("query"))),
        "body_shape": _shape(body),
        "headers": normalized_headers,
        "form_id": str(request.get("form_id") or ""),
        "app_id": str(request.get("app_id") or ""),
        "ac": str(request.get("ac") or ""),
        "action_family": str(request.get("action_family") or ""),
    }


def _path(request: Mapping[str, Any]) -> str:
    value = str(
        request.get("path")
        or request.get("url_shape")
        or request.get("url")
        or ""
    )
    return urlparse(value).path or value


def _mapping_keys(value: Any) -> list[str]:
    return [str(key) for key in value] if isinstance(value, Mapping) else []


def _shape(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): _shape(child)
            for key, child in sorted(value.items(), key=lambda item: str(item[0]))
        }
    if isinstance(value, list):
        return [_shape(child) for child in value[:3]]
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float, str)):
        return "scalar"
    return type(value).__name__


def _semantic_score(expected: Mapping[str, Any], actual: Mapping[str, Any]) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    weights = {
        "method": 5,
        "path": 5,
        "form_id": 3,
        "app_id": 1,
        "ac": 3,
        "action_family": 3,
        "body_shape": 2,
        "query_keys": 1,
        "headers": 1,
    }
    for key, weight in weights.items():
        expected_value = expected.get(key)
        if expected_value in ("", [], {}, None):
            continue
        if actual.get(key) == expected_value:
            score += weight
            reasons.append(key)
        elif key in {"method", "path"}:
            score -= weight
    return score, reasons


def request_fingerprint(request: Mapping[str, Any]) -> str:
    """Return a stable, value-safe fingerprint for diagnostics."""
    return json.dumps(_signature(request), ensure_ascii=True, sort_keys=True)

