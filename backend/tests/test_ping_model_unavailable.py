"""llm_ping 结构化错误响应的集成测试（S3 端到端验证）。

直接驱动 main.llm_ping 路由逻辑：当底层 chat 抛 LLMModelUnavailable 时，
/api/llm/ping 必须返回 reason=model_unavailable 且携带 suggested_model，
供前端点亮「一键迁移」自愈入口。
"""
import pytest

from app.core.llm import LLMModelUnavailable
from app.main import llm_ping


def test_ping_returns_model_unavailable(monkeypatch):
    def _boom(*a, **k):
        raise LLMModelUnavailable(
            "This model models/gemini-2.5-pro is no longer available "
            "to new users. Please update your code to use models/gemini-3.1-pro-preview",
            suggested_model="gemini-3.1-pro-preview",
        )

    # llm_ping 内通过 `from app.core.llm import chat` 绑定了 chat 名字，
    # 需 patch app.main.chat 才能改变其行为。
    import app.main as main

    monkeypatch.setattr(main, "chat", _boom)

    resp = llm_ping()
    assert resp["ok"] is False
    assert resp["reason"] == "model_unavailable"
    assert resp["suggested_model"] == "gemini-3.1-pro-preview"
    assert "gemini-3.1-pro-preview" in (resp.get("message") or "")


def test_ping_generic_error_not_misclassified(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("connection reset by peer")

    import app.main as main

    monkeypatch.setattr(main, "chat", _boom)

    resp = llm_ping()
    assert resp["ok"] is False
    # 普通错误不应被识别为模型不可用
    assert resp.get("reason") != "model_unavailable"


def test_ping_returns_temporarily_unavailable(monkeypatch):
    def _boom(*a, **k):
        e = RuntimeError(
            "Error code: 503 ... currently experiencing high demand ... status: 'UNAVAILABLE'"
        )
        e.status_code = 503  # 模拟 openai.APIStatusError.status_code
        raise e

    import app.main as main

    monkeypatch.setattr(main, "chat", _boom)

    resp = llm_ping()
    assert resp["ok"] is False
    assert resp["reason"] == "temporarily_unavailable"
    assert "负载较高" in (resp.get("message") or "")


def test_ping_503_no_google_text_not_misclassified(monkeypatch):
    # P1-a 守卫在 ping 层：503 但无 Google 文案（如永久下架）→ reason=error
    def _boom(*a, **k):
        e = RuntimeError("model not found")
        e.status_code = 503
        raise e

    import app.main as main

    monkeypatch.setattr(main, "chat", _boom)

    resp = llm_ping()
    assert resp["ok"] is False
    assert resp.get("reason") == "error"
    assert resp.get("reason") != "temporarily_unavailable"
