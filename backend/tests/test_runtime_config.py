"""migrate_model_values() 单元测试（T1–T7）。

覆盖维度（来自 test-coverage-expander 评估）：
- 等价类：legacy 命中 → 升级 / 非 legacy → 不变
- 边界：部分命中 / 空值·缺失
- 异常分支：db.set_setting 抛错 → best-effort 不向外抛
- 状态迁移：幂等（二次调用返回 0）
- 不变量：角色映射语义（core=pro、aux/fast=flash）
- 返回值：changed 计数正确
"""
import app.core.db as db
import app.core.runtime_config as rc


def _seed(**kwargs):
    """用 DB 覆盖值播种遗留配置（模拟启动前已落库的旧值）。"""
    for k, v in kwargs.items():
        db.set_setting(k, v)


# ── T1：legacy 全命中升级 ──────────────────────────────
def test_t1_legacy_all_upgraded():
    _seed(
        llm_model="deepseek-chat",
        llm_model_core="deepseek-chat",
        llm_model_aux="deepseek-reasoner",
        llm_model_fast="deepseek-reasoner",
    )
    changed = rc.migrate_model_values()
    assert changed == 4
    # 角色映射不变量：core=pro、aux/fast=flash
    eff = rc.get_effective_settings()
    assert eff["llm_model"] == "deepseek-v4-pro"
    assert eff["llm_model_core"] == "deepseek-v4-pro"
    assert eff["llm_model_aux"] == "deepseek-v4-flash"
    assert eff["llm_model_fast"] == "deepseek-v4-flash"
    assert db.get_setting("llm_model") == "deepseek-v4-pro"
    assert db.get_setting("llm_model_aux") == "deepseek-v4-flash"


# ── T2：非 legacy 值完全不变 ───────────────────────────
def test_t2_non_legacy_untouched():
    _seed(
        llm_model="gpt-4",
        llm_model_core="deepseek-v4-pro",   # 已是新预设
        llm_model_aux="",                    # 空串
        llm_model_fast="my-custom-model-id",
    )
    changed = rc.migrate_model_values()
    assert changed == 0
    assert db.get_setting("llm_model") == "gpt-4"
    assert db.get_setting("llm_model_core") == "deepseek-v4-pro"
    assert db.get_setting("llm_model_aux") == ""
    assert db.get_setting("llm_model_fast") == "my-custom-model-id"


# ── T3：部分命中，仅 legacy 字段被改 ───────────────────
def test_t3_partial_hit_only_legacy_changed():
    _seed(
        llm_model="deepseek-chat",           # legacy → pro
        llm_model_core="deepseek-v4-pro",    # 非 legacy → 不动
        llm_model_aux="deepseek-reasoner",   # legacy → flash
        llm_model_fast="my-custom-id",       # 自定义 → 不动
    )
    changed = rc.migrate_model_values()
    assert changed == 2
    assert db.get_setting("llm_model") == "deepseek-v4-pro"
    assert db.get_setting("llm_model_core") == "deepseek-v4-pro"
    assert db.get_setting("llm_model_aux") == "deepseek-v4-flash"
    assert db.get_setting("llm_model_fast") == "my-custom-id"


# ── T4：空值 / 字段缺失 ────────────────────────────────
def test_t4_empty_value_not_migrated():
    _seed(llm_model="")  # 空串：isinstance str 但不在映射 → 不改
    changed = rc.migrate_model_values()
    assert changed == 0
    assert db.get_setting("llm_model") == ""


def test_t4_missing_field_no_write():
    # 不播种 llm_model：回落 env 默认（当前预设，非 legacy）→ 不应写库
    changed = rc.migrate_model_values()
    assert changed == 0
    assert db.get_setting("llm_model") is None


# ── T5：幂等（二次调用返回 0、值不变）──────────────────
def test_t5_idempotent():
    _seed(
        llm_model="deepseek-chat",
        llm_model_core="deepseek-chat",
        llm_model_aux="deepseek-reasoner",
        llm_model_fast="deepseek-reasoner",
    )
    first = rc.migrate_model_values()
    assert first == 4
    second = rc.migrate_model_values()  # 已是新值，不应再改
    assert second == 0
    assert db.get_setting("llm_model") == "deepseek-v4-pro"
    assert db.get_setting("llm_model_aux") == "deepseek-v4-flash"


# ── T6：best-effort 失败语义 ───────────────────────────
def test_t6_best_effort_on_set_setting_error(monkeypatch):
    _seed(llm_model="deepseek-chat", llm_model_core="deepseek-chat")

    def _boom(key, value):  # 模拟 DB 写入瞬时失败
        raise RuntimeError("injected db failure")

    monkeypatch.setattr(db, "set_setting", _boom)
    # 不应向外抛；返回 0；标记置位避免后续重试
    changed = rc.migrate_model_values()
    assert changed == 0
    assert rc._MODEL_MIGRATED is True
    # 二次调用直接短路返回 0（不会再触发 set_setting，故不抛）
    assert rc.migrate_model_values() == 0


# ── T7：角色映射不变量（仅 aux/fast 为 legacy）─────────
def test_t7_role_invariant_aux_fast_only():
    _seed(
        llm_model="gpt-4",                   # 非 legacy → 不动
        llm_model_core="deepseek-v4-pro",    # 非 legacy → 不动
        llm_model_aux="deepseek-reasoner",   # legacy → flash
        llm_model_fast="deepseek-reasoner",  # legacy → flash
    )
    changed = rc.migrate_model_values()
    assert changed == 2
    assert db.get_setting("llm_model") == "gpt-4"
    assert db.get_setting("llm_model_core") == "deepseek-v4-pro"
    assert db.get_setting("llm_model_aux") == "deepseek-v4-flash"
    assert db.get_setting("llm_model_fast") == "deepseek-v4-flash"
