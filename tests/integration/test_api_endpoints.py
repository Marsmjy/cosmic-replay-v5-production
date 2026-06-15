"""
cosmic-replay v4 - API端点集成测试

测试目标：
1. 健康检查端点
2. 配置管理端点
3. 用例管理端点
4. 执行端点
5. 历史端点
"""
import pytest
import sys
import json
import urllib.parse
from pathlib import Path
from collections import OrderedDict

import yaml

SKILL_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SKILL_ROOT))


def test_webui_yaml_dump_never_emits_python_object_tags():
    from lib.webui.server import _dump_yaml_plain

    text = _dump_yaml_plain({
        "assertions": [
            OrderedDict([
                ("type", "maintained_value_applied"),
                ("target_id", "pick_createorg_id"),
            ])
        ]
    })

    assert "!!python/object" not in text
    assert yaml.safe_load(text)["assertions"][0]["type"] == "maintained_value_applied"


# 使用TestClient进行API测试
class TestHealthEndpoint:
    """健康检查端点测试"""
    
    @pytest.fixture
    def client(self):
        """创建测试客户端"""
        try:
            from fastapi.testclient import TestClient
            from lib.webui.server import APP
            return TestClient(APP)
        except ImportError:
            pytest.skip("FastAPI TestClient not available")
    
    def test_health_returns_200(self, client):
        """返回200状态码"""
        resp = client.get("/api/health")
        assert resp.status_code == 200
    
    def test_health_response_structure(self, client):
        """响应结构正确"""
        resp = client.get("/api/health")
        data = resp.json()
        
        # 必需字段
        required_fields = ["status", "timestamp"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
    
    def test_health_status_values(self, client):
        """状态值有效"""
        resp = client.get("/api/health")
        status = resp.json()["status"]
        assert status in ("healthy", "degraded", "unhealthy")
    
    def test_health_has_uptime(self, client):
        """包含运行时间"""
        resp = client.get("/api/health")
        data = resp.json()
        assert "uptime_seconds" in data
        assert isinstance(data["uptime_seconds"], int)
        assert data["uptime_seconds"] >= 0
    
    def test_health_has_case_count(self, client):
        """包含用例数量"""
        resp = client.get("/api/health")
        data = resp.json()
        assert "cases_count" in data
        assert isinstance(data["cases_count"], int)


class TestInfoEndpoint:
    """信息端点测试"""
    
    @pytest.fixture
    def client(self):
        try:
            from fastapi.testclient import TestClient
            from lib.webui.server import APP
            return TestClient(APP)
        except ImportError:
            pytest.skip("FastAPI TestClient not available")
    
    def test_info_returns_200(self, client):
        """返回200状态码"""
        resp = client.get("/api/info")
        assert resp.status_code == 200
    
    def test_info_has_version(self, client):
        """包含版本信息"""
        resp = client.get("/api/info")
        data = resp.json()
        assert "version" in data
        assert data["version"] == "0.1.0"
    
    def test_info_has_paths(self, client):
        """包含路径信息"""
        resp = client.get("/api/info")
        data = resp.json()
        
        path_fields = ["skill_root", "config_dir", "cases_dir"]
        for field in path_fields:
            assert field in data, f"Missing path field: {field}"


class TestWebUiEntrypoints:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from lib.webui.server import APP

        return TestClient(APP)

    def test_root_serves_vnext_by_default(self, client, monkeypatch):
        monkeypatch.delenv("COSMIC_WEBUI_MODE", raising=False)

        response = client.get("/")

        assert response.status_code == 200
        assert "Cosmic Replay vNext" in response.text
        assert "/static/vnext/js/app.js" in response.text

    def test_legacy_route_and_feature_flag_keep_old_page_available(
        self, client, monkeypatch
    ):
        direct = client.get("/legacy")
        monkeypatch.setenv("COSMIC_WEBUI_MODE", "legacy")
        flagged = client.get("/")

        assert direct.status_code == 200
        assert flagged.status_code == 200
        assert "x-data=\"app()\"" in direct.text
        assert "x-data=\"app()\"" in flagged.text


class TestConfigEndpoints:
    """配置端点测试"""
    
    @pytest.fixture
    def client(self):
        try:
            from fastapi.testclient import TestClient
            from lib.webui.server import APP
            return TestClient(APP)
        except ImportError:
            pytest.skip("FastAPI TestClient not available")
    
    def test_get_config_returns_200(self, client):
        """获取配置"""
        resp = client.get("/api/config")
        assert resp.status_code == 200
    
    def test_config_has_webui_section(self, client):
        """配置包含webui节"""
        resp = client.get("/api/config")
        data = resp.json()
        assert "webui" in data
    
    def test_config_has_envs_section(self, client):
        """配置包含envs节"""
        resp = client.get("/api/config")
        data = resp.json()
        assert "envs" in data
        assert isinstance(data["envs"], list)
    
    def test_config_masks_secrets(self, client):
        """密码被隐藏"""
        resp = client.get("/api/config")
        data = resp.json()
        
        # 检查所有环境的凭证
        for env in data.get("envs", []):
            cred = env.get("credentials", {})
            password = cred.get("password", "")
            if password:
                assert set(password) == {"*"} and len(password) >= 3, "Password should be masked"
    
    def test_get_envs_returns_list(self, client):
        """获取环境列表"""
        resp = client.get("/api/envs")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestCasesEndpoints:
    """用例端点测试"""
    
    @pytest.fixture
    def client(self):
        try:
            from fastapi.testclient import TestClient
            from lib.webui.server import APP
            return TestClient(APP)
        except ImportError:
            pytest.skip("FastAPI TestClient not available")
    
    def test_list_cases_returns_200(self, client):
        """列出用例"""
        resp = client.get("/api/cases")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
    
    def test_case_metadata_structure(self, client):
        """用例元数据结构"""
        resp = client.get("/api/cases")
        cases = resp.json()
        
        if cases:  # 如果有用例
            case = cases[0]
            assert "name" in case
            assert "file" in case
    
    def test_get_nonexistent_case_yaml(self, client):
        """获取不存在用例的YAML"""
        resp = client.get("/api/cases/nonexistent_case_xyz/yaml")
        assert resp.status_code == 404
    
    def test_delete_nonexistent_case(self, client):
        """删除不存在用例"""
        resp = client.delete("/api/cases/nonexistent_case_xyz")
        # 可能返回200或404，取决于实现
        assert resp.status_code in (200, 404)


class TestHistoryEndpoints:
    """历史端点测试"""
    
    @pytest.fixture
    def client(self):
        try:
            from fastapi.testclient import TestClient
            from lib.webui.server import APP
            return TestClient(APP)
        except ImportError:
            pytest.skip("FastAPI TestClient not available")
    
    def test_get_history_returns_200(self, client):
        """获取历史"""
        resp = client.get("/api/history")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
    
    def test_history_limit_parameter(self, client):
        """历史数量参数"""
        resp = client.get("/api/history?limit=5")
        assert resp.status_code == 200
        assert len(resp.json()) <= 5
    
    def test_get_case_history(self, client):
        """获取用例历史"""
        resp = client.get("/api/history/test_case_name")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestRunEndpoints:
    """运行端点测试"""
    
    @pytest.fixture
    def client(self):
        try:
            from fastapi.testclient import TestClient
            from lib.webui.server import APP
            return TestClient(APP)
        except ImportError:
            pytest.skip("FastAPI TestClient not available")
    
    def test_run_nonexistent_case(self, client):
        """运行不存在用例"""
        resp = client.post("/api/cases/nonexistent_case_xyz/run", json={})
        assert resp.status_code == 404
    
    def test_runs_endpoint_exists(self, client):
        """运行列表端点存在"""
        resp = client.get("/api/runs/")
        assert resp.status_code == 200


class TestVnextWorkspaceEndpoints:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from lib.webui.server import APP

        return TestClient(APP)

    @pytest.fixture
    def workspace_case(self, tmp_path, monkeypatch):
        from lib.webui import server

        path = tmp_path / "workspace.yaml"
        path.write_text(
            yaml.safe_dump(
                {
                    "schema_version": "1.0",
                    "name": "vNext API 用例",
                    "vars": {"person_name": "录制姓名"},
                    "vars_meta": {
                        "person_name": {
                            "recorded_value": "录制姓名",
                            "source_step_id": "load",
                        },
                    },
                    "field_catalog": [{
                        "field_id": "person_name",
                        "order": 1,
                        "label": "姓名",
                        "field_key": "name",
                        "field_type": "text",
                        "vars": ["person_name"],
                        "source_step_id": "load",
                    }],
                    "steps": [{
                        "id": "load",
                        "type": "invoke",
                        "ac": "loadData",
                        "skip_replay": True,
                    }],
                    "assertions": [],
                },
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(server, "case_path_from_name", lambda _name: path)
        return path

    def test_case_detail_and_variable_save_share_canonical_field_catalog(
        self, client, workspace_case
    ):
        detail = client.get("/api/vnext/cases/workspace/detail")
        saved = client.put(
            "/api/vnext/cases/workspace/variables",
            json={
                "fields": {
                    "person_name": {"user_override": "目标姓名"},
                },
            },
        )

        assert detail.status_code == 200
        assert detail.json()["field_catalog"][0]["recorded_value"] == "录制姓名"
        assert saved.status_code == 200
        field = saved.json()["detail"]["field_catalog"][0]
        assert field["user_override"] == "目标姓名"
        assert field["final_request_value"] == "目标姓名"
        persisted = yaml.safe_load(workspace_case.read_text(encoding="utf-8"))
        assert persisted["vars"]["person_name"] == "目标姓名"

    def test_resolver_endpoint_rejects_non_exact_result(
        self, client, workspace_case
    ):
        response = client.post(
            "/api/vnext/cases/workspace/resolver/apply",
            json={
                "field_id": "person_name",
                "resolution": {
                    "resolve_status": "ambiguous",
                    "candidates": [{"id": "1"}, {"id": "2"}],
                },
            },
        )

        assert response.status_code == 422
        assert response.json()["detail"]["error_code"] == "resolution_not_exact"

    def test_run_snapshot_and_cancel_endpoint_use_live_replayable_session(
        self, client, monkeypatch
    ):
        from lib.webui import server

        monkeypatch.setattr(
            server.LOG_STORE,
            "save_run_event",
            lambda *_args, **_kwargs: None,
        )
        session = server.RunSession("vnext-api-run", "workspace", "target")
        session.emit("case_start", {"name": "显示名称"})
        session.emit("step_start", {
            "id": "load",
            "label": "加载",
            "business_stage": "查询",
        })
        monkeypatch.setitem(server.RUNS, session.run_id, session)

        snapshot = client.get(f"/api/vnext/runs/{session.run_id}")
        cancelled = client.post(f"/api/vnext/runs/{session.run_id}/cancel")

        assert snapshot.status_code == 200
        assert snapshot.json()["case_name"] == "workspace"
        assert snapshot.json()["events"][0]["seq"] == 1
        assert cancelled.status_code == 200
        assert cancelled.json()["accepted"] is True
        assert session.cancel_event.is_set()

    def test_sse_replays_only_events_after_requested_sequence(
        self, client, monkeypatch
    ):
        from lib.webui import server

        monkeypatch.setattr(
            server.LOG_STORE,
            "save_run_event",
            lambda *_args, **_kwargs: None,
        )
        session = server.RunSession("vnext-sse-run", "workspace", "target")
        session.emit("case_start", {"name": "显示名称"})
        session.emit("preflight_start", {"id": "preflight_contract"})
        session.emit("preflight_ok", {"id": "preflight_contract"})
        session.close()
        monkeypatch.setitem(server.RUNS, session.run_id, session)

        response = client.get(
            f"/api/runs/{session.run_id}/events?after_seq=1"
        )

        assert response.status_code == 200
        assert "id: 1\n" not in response.text
        assert "id: 2\n" in response.text
        assert "event: preflight_start" in response.text
        assert "id: 3\n" in response.text
        assert "event: preflight_ok" in response.text
        assert "event: close" in response.text


class TestBatchEndpoints:
    """批量操作端点测试"""
    
    @pytest.fixture
    def client(self):
        try:
            from fastapi.testclient import TestClient
            from lib.webui.server import APP
            return TestClient(APP)
        except ImportError:
            pytest.skip("FastAPI TestClient not available")
    
    def test_batch_delete_empty_list(self, client):
        """批量删除空列表"""
        resp = client.post("/api/cases/batch_delete", json={"names": []})
        assert resp.status_code == 200
        assert resp.json()["count"] == 0
    
    def test_batch_delete_nonexistent_cases(self, client):
        """批量删除不存在用例"""
        resp = client.post("/api/cases/batch_delete", json={
            "names": ["nonexistent_1", "nonexistent_2"]
        })
        assert resp.status_code == 200
        # 应该返回成功但删除数为0
        assert resp.json()["count"] == 0

    def test_copy_case_creates_unique_yaml_with_new_name(self, client):
        """复制用例会新建 YAML 并同步 name 字段"""
        from lib.webui import server

        source_name = "_pytest_copy_source"
        copy_name = "_pytest_copy_target"
        source_path = server.case_path_from_name(source_name)
        copy_path = server.case_path_from_name(copy_name)
        second_copy_path = server.case_path_from_name(f"{copy_name}-2")
        for path in (source_path, copy_path, second_copy_path):
            if path.exists():
                path.unlink()
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text(
            "name: _pytest_copy_source\ncreated_at: 2026-01-01T00:00:00\nsteps: []\n",
            encoding="utf-8",
        )
        try:
            resp = client.post(f"/api/cases/{source_name}/copy", json={"new_name": copy_name})
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert data["name"] == copy_name
            assert copy_path.exists()
            text = copy_path.read_text(encoding="utf-8")
            assert "name: _pytest_copy_target" in text
            assert "created_at: 2026-01-01T00:00:00" not in text

            resp2 = client.post(f"/api/cases/{source_name}/copy", json={"new_name": copy_name})
            assert resp2.status_code == 200
            assert resp2.json()["name"] == f"{copy_name}-2"
            assert second_copy_path.exists()
        finally:
            for path in (source_path, copy_path, second_copy_path):
                if path.exists():
                    path.unlink()

    def test_har_extract_creates_unique_case_name_instead_of_overwriting(self, client):
        """重新导入同名 HAR 时自动添加后缀，不能覆盖已有用例"""
        from lib.webui import server

        case_name = "_pytest_har_duplicate"
        existing_path = server.case_path_from_name(case_name)
        generated_path = server.case_path_from_name(f"{case_name}-2")
        har_path = server.har_upload_dir() / "_pytest_har_duplicate.har"
        original_yaml = "name: _pytest_har_duplicate\ncreated_at: 2026-01-01T00:00:00\nsteps: []\n"
        for path in (existing_path, generated_path, har_path):
            if path.exists():
                path.unlink()
        existing_path.parent.mkdir(parents=True, exist_ok=True)
        existing_path.write_text(original_yaml, encoding="utf-8")
        query_actions = [{
            "key": "billlistap",
            "methodName": "loadData",
            "args": [],
            "postData": [{}, []],
        }]
        har_path.write_text(
            json.dumps({
                "log": {
                    "entries": [{
                        "request": {
                            "method": "POST",
                            "url": (
                                "http://example.test/form/batchInvokeAction.do"
                                "?appId=demo&f=demo_list&ac=loadData"
                            ),
                            "postData": {
                                "text": urllib.parse.urlencode({
                                    "params": json.dumps(query_actions),
                                    "pageId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                                })
                            },
                        },
                        "response": {
                            "content": {
                                "text": json.dumps([{
                                    "p": [{
                                        "k": "billlistap",
                                        "data": {
                                            "dataindex": {"number": 0},
                                            "rows": [],
                                        },
                                    }],
                                }])
                            }
                        },
                    }]
                }
            }),
            encoding="utf-8",
        )
        try:
            resp = client.post("/api/har/extract", json={
                "har_file": har_path.name,
                "case_name": case_name,
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert data["name"] == f"{case_name}-2"
            assert data["renamed_from"] == case_name
            assert data["overwritten"] is False
            assert existing_path.read_text(encoding="utf-8") == original_yaml
            assert generated_path.exists()
            generated_text = generated_path.read_text(encoding="utf-8")
            assert f"name: {case_name}-2" in generated_text
        finally:
            for path in (existing_path, generated_path, har_path):
                if path.exists():
                    path.unlink()

    def test_validation_point_update_writes_safe_yaml(self, client):
        """启用校验点后写回的 YAML 仍可 safe_load，不含 Python 对象标签"""
        from lib.webui import server

        case_name = "_pytest_validation_point_update"
        case_path = server.case_path_from_name(case_name)
        if case_path.exists():
            case_path.unlink()
        case_path.parent.mkdir(parents=True, exist_ok=True)
        case_path.write_text(
            "\n".join([
                f"name: {case_name}",
                "vars: {}",
                "vars_meta: {}",
                "pick_fields: {}",
                "steps:",
                "- id: fill_name",
                "  type: update_fields",
                "assertions:",
                "- type: no_error_actions",
                "  last_step: true",
                "validation_points:",
                "- id: field_var_test_name",
                "  label: 名称：维护值进入回放请求",
                "  category: recommended",
                "  enabled: false",
                "  required: false",
                "  kind: variable",
                "  target_id: test_name",
                "  step_id: fill_name",
                "  assertion:",
                "    type: maintained_value_applied",
                "    kind: variable",
                "    target_id: test_name",
                "    step: fill_name",
                "",
            ]),
            encoding="utf-8",
        )
        try:
            resp = client.post("/api/validation-point-update", json={
                "case_name": case_name,
                "point_id": "field_var_test_name",
                "enabled": True,
            })
            assert resp.status_code == 200
            text = case_path.read_text(encoding="utf-8")
            assert "!!python/object" not in text
            parsed = yaml.safe_load(text)
            assert parsed["validation_points"][0]["enabled"] is True
            assert {
                "type": "maintained_value_applied",
                "kind": "variable",
                "target_id": "test_name",
                "step": "fill_name",
            } in parsed["assertions"]
        finally:
            if case_path.exists():
                case_path.unlink()


class TestCORSHeaders:
    """CORS头测试"""
    
    @pytest.fixture
    def client(self):
        try:
            from fastapi.testclient import TestClient
            from lib.webui.server import APP
            return TestClient(APP)
        except ImportError:
            pytest.skip("FastAPI TestClient not available")
    
    def test_health_allows_cors(self, client):
        """健康检查允许CORS"""
        resp = client.options("/api/health")
        # OPTIONS请求应该成功或返回204
        assert resp.status_code in (200, 204, 405)


# 运行测试命令：
# cd cosmic-replay-v4 && python -m pytest tests/integration/test_api_endpoints.py -v
