"""模型不可用异常的解析与转抛逻辑测试（评审 P1：补充单测）。

覆盖 _parse_model_unavailable 的守卫与提取规则，以及
_raise_if_model_unavailable 对非限速错误的转抛。
不依赖 DB / LLM 客户端，纯函数级验证。
"""
import pytest

from app.core.llm import (
    LLMModelUnavailable,
    _parse_model_unavailable,
    _raise_if_model_unavailable,
)


def test_gemini_404_extracts_suggested():
    msg = (
        "Error code: 404 This model models/gemini-2.5-pro is no longer available "
        "to new users. Please update your code to use models/gemini-3.1-pro-preview"
    )
    current, suggested = _parse_model_unavailable(Exception(msg))
    assert current == "gemini-2.5-pro"
    assert suggested == "gemini-3.1-pro-preview"


def test_gemini_deprecated_try_form():
    msg = "models/gemini-2.5-pro is deprecated, try models/gemini-3.1-pro-preview instead"
    current, suggested = _parse_model_unavailable(Exception(msg))
    assert current == "gemini-2.5-pro"
    assert suggested == "gemini-3.1-pro-preview"


def test_openai_with_models_prefix_no_suggestion():
    # OpenAI 给出不存在模型但无建议模型时，current 可提取、suggested 为 None
    msg = "The model 'models/gpt-4o-old' does not exist"
    current, suggested = _parse_model_unavailable(Exception(msg))
    assert current == "gpt-4o-old"
    assert suggested is None


def test_openai_without_models_prefix_returns_none():
    # 模型名未带 models/ 前缀，无法定位 current，正确返回 (None, None)
    msg = "The model `gpt-4o-old` does not exist"
    current, suggested = _parse_model_unavailable(Exception(msg))
    assert current is None
    assert suggested is None


def test_401_not_misclassified():
    # 401 不应被识别为模型不可用
    assert _parse_model_unavailable(Exception("401 Unauthorized: API key invalid")) == (None, None)


def test_429_not_misclassified():
    # 429 限速错误不应被识别为模型不可用
    assert _parse_model_unavailable(Exception("Rate limit reached, retry later")) == (None, None)


def test_raise_converts_model_unavailable():
    msg = "This model models/gemini-2.5-pro is no longer available ... use models/gemini-3.1-pro-preview"
    with pytest.raises(LLMModelUnavailable) as exc:
        _raise_if_model_unavailable(Exception(msg))
    assert exc.value.suggested_model == "gemini-3.1-pro-preview"


def test_raise_passes_through_rate_limit():
    # 限速错误应原样 raise，不应被转成 LLMModelUnavailable
    with pytest.raises(Exception) as exc:
        _raise_if_model_unavailable(Exception("429 rate limit"))
    assert not isinstance(exc.value, LLMModelUnavailable)


def test_raise_passes_through_generic_error():
    # 普通错误（无「不可用」关键词）原样 raise
    with pytest.raises(Exception) as exc:
        _raise_if_model_unavailable(Exception("connection reset by peer"))
    assert not isinstance(exc.value, LLMModelUnavailable)
