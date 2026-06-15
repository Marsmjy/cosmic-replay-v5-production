"""FastAPI routes for HAR application services."""
from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Body, HTTPException

from lib.webui.application.har_import import HarImportError


def create_har_router(service_factory: Callable[[], Any]) -> APIRouter:
    router = APIRouter()

    @router.post("/api/har/extract")
    def extract_har(body: dict = Body(...)):
        try:
            return service_factory().extract(body)
        except HarImportError as exc:
            raise HTTPException(exc.status_code, exc.detail) from exc

    return router

