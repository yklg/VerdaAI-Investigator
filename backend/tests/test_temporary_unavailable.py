"""503 临时不可用谓词测试（S2 / 评审 P1-a）。

守护 `is_temporary_unavailable`：必须同时命中「HTTP 503」+
Google 文案特征（high demand / temporarily / UNAVAILABLE / overloaded），
否则不误判为「临时」——避免把「永久下架也返回 503」的厂商误导为可重试。
"""
from app.core.llm import is_temporary_unavailable


def _err(status, text):
    e = RuntimeError(text)
    if status is not None:
        e.status_code = status  # 模拟 openai.APIStatusError.status_code
    return e


def test_503_high_demand():
    assert is_temporary_unavailable(_err(503, "...currently experiencing high demand...")) is True


def test_503_unavailable():
    assert is_temporary_unavailable(_err(503, "status: 'UNAVAILABLE'")) is True


def test_503_temporarily():
    assert is_temporary_unavailable(_err(503, "temporarily unable to serve")) is True


def test_503_overloaded():
    assert is_temporary_unavailable(_err(503, "service overloaded")) is True


def test_503_no_google_text_not_misclassified():
    # P1-a 守卫：503 但无 Google 文案（如永久下架）→ 不应误判为临时
    assert is_temporary_unavailable(_err(503, "model not found")) is False


def test_404_with_unavailable_word_not_misclassified():
    # P1-a status 守卫：404 带 unavailable 词但非 503 → False
    assert (
        is_temporary_unavailable(_err(404, "Error code: 404 this model is no longer available"))
        is False
    )


def test_429_rate_limit_not_misclassified():
    assert is_temporary_unavailable(_err(None, "429 rate limit")) is False


def test_500_with_high_demand_not_misclassified():
    # 非 503 的 5xx 即使有 high demand 文案也不算临时
    assert is_temporary_unavailable(_err(500, "high demand")) is False
