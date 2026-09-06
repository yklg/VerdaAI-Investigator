"""模型 ID 前缀归一化测试（S1 / 评审 P0）。

守护 `_normalize_model_id` 的捕获组提取逻辑，以及 `/api/llm/models`
对 Google OpenAI-兼容网关返回 `models/{model}` resource name 的剥离。

关键守卫（P0）：tuned 模型形态 `publishers/{publisher}/models/{model}`
不以 `models/` 开头，必须原样保留——验证「捕获组提取」而非「全局替换」。
"""
import httpx

from app.main import _normalize_model_id, list_provider_models


def test_normalize_strips_prefix():
    assert _normalize_model_id("models/gemini-2.5-flash") == "gemini-2.5-flash"


def test_normalize_keeps_bare_id():
    assert _normalize_model_id("gemini-2.5-flash") == "gemini-2.5-flash"


def test_normalize_keeps_publishers_form_p0():
    # P0 核心守卫：tuned 模型不以 `models/` 开头，捕获组不得截断
    assert (
        _normalize_model_id("publishers/google/models/gemini-x")
        == "publishers/google/models/gemini-x"
    )


def test_normalize_keeps_singular_model_prefix():
    # 边界：单数 `model/`（非 `models/`）不应被误剥
    assert _normalize_model_id("model/gemini-x") == "model/gemini-x"


def test_normalize_keeps_bare_models():
    # 边界：裸 `models`（无斜杠后段）不应被误剥
    assert _normalize_model_id("models") == "models"


def test_list_provider_models_returns_short_ids(monkeypatch):
    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "data": [
                    {"id": "models/gemini-2.5-flash"},
                    {"id": "gemini-2.0-flash"},
                ]
            }

    def _fake_get(url, headers=None, timeout=None):
        return _Resp()

    monkeypatch.setattr(httpx, "get", _fake_get)
    monkeypatch.setattr(
        "app.main.get_effective_settings",
        lambda: {"llm_base_url": "https://example.com/v1", "llm_api_key": "k"},
    )

    resp = list_provider_models()
    assert resp["ok"] is True
    assert resp["models"] == ["gemini-2.5-flash", "gemini-2.0-flash"]
