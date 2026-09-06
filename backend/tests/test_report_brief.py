"""报告一页纸精炼（brief）—— 派生数据生命周期测试（test-coverage-expander 方案）。

契约（《报告简报与 PPT 汇报方案 v3》）：
- `orchestrator.generate_brief(report_id)`：幂等（已存在不重复调 LLM）、失败记 brief_failed_at、
  成功清 brief_failed_at、并发经 db._LOCK 串行 + 写回前重读校验、无 summary/metrics 时降级组装。
- `db.invalidate_report_brief(report_id)`：清除 data.brief / brief_failed_at，幂等（brief 不存在不报错）。
- `POST /api/reports/{id}/brief`：已生成/新生成均 200 + {ok,brief}；不存在 404；LLM 未配置 503。
- 失效挂点：post_refine、post_feedback、refine_report_pipeline 成功出口各清除一次 brief。

依赖真实逻辑的注入点：
- orchestrator.chat_json（模块级 from-import 绑定，见 orchestrator.py:38）→ monkeypatch 假实现。
- orchestrator._rewrite_section → monkeypatch 假实现（沿用 test_refine_evidence 模式）。

mock 策略（对齐 test_refine_evidence.py）：patch orchestrator 模块属性，不调真实 LLM；
TestClient 测端点；内嵌 asyncio.run 消费 pipeline；VERDA_DB_PATH 由 conftest 在 import app 前隔离。
运行：backend/ 下 `pytest tests/test_report_brief.py -q`
"""
import asyncio
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.core import db, orchestrator
from app.main import app


def _conn():
    return db._connect()


def _make_report(rid, with_summary: bool = True):
    """种子报告：含可被 generate_brief 组装的最小结构。"""
    summary_section = {
        "id": "summary",
        "title": "执行摘要 · 核心判断",
        "key_takeaway": "摘要结论",
        "highlights": ["亮点1", "亮点2"],
        "paragraphs": ["全文"],
    }
    sections = [summary_section] if with_summary else []
    report = {
        "id": rid, "title": "报告 " + rid, "subtitle": "副标题", "query": "测试查询",
        "brands": ["品牌A"], "experts": [], "cover_image": "",
        "created_at": db._now(),
        "evidence": [], "claims": [], "metrics": {},
        "sections": sections,
    }
    db.save_report(report, task_id="")


def _fake_chat_json(calls_holder):
    """假 LLM：接收真实签名 (messages, **kwargs)，返回一页纸精炼四段结构并计数调用。"""
    def _fake(messages, **kwargs):
        calls_holder.append(messages)
        return {
            "summary": "一句话概括",
            "judgments": ["判断1", "判断2", "判断3"],
            "key_data": ["数据1", "数据2"],
            "actions": ["行动1", "行动2", "行动3"],
        }
    return _fake


def _seed_brief(rid, calls_holder=None, monkeypatch=None):
    """生成报告 + 用假 LLM 落一份 brief，返回该 brief。"""
    _make_report(rid)
    holder = calls_holder if calls_holder is not None else []
    if monkeypatch is not None:
        monkeypatch.setattr(orchestrator, "chat_json", _fake_chat_json(holder))
    brief = orchestrator.generate_brief(rid)
    assert brief, "种子自检：generate_brief 应产出 brief"
    return brief


def _seed_brief_with_evidence(rid, specs, monkeypatch):
    """生成报告（带 evidences 表证据，specs=[(eid,cred)]）并落一份 brief（仿 test_refine_evidence 种子）。"""
    _make_report(rid)
    for eid, cred in specs:
        _conn().execute(
            "INSERT OR REPLACE INTO evidences(evidence_id,report_id,source_url,source_type,domain,"
            "title,excerpt,credibility,collected_by,brand,captured_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (eid, rid, "https://example.com/" + eid, "web", "example.com", "证据 " + eid,
             "内容", cred, "tester", "品牌A", db._now()),
        )
    _conn().commit()
    monkeypatch.setattr(orchestrator, "chat_json", _fake_chat_json([]))
    brief = orchestrator.generate_brief(rid)
    assert brief, "种子自检：generate_brief 应产出 brief"
    return brief


def _fake_rewrite(section, extra_context, system_prompt):
    """替换 _rewrite_section：就地重写，不调真实 LLM（沿用 test_refine_evidence）。"""
    section["paragraphs"] = ["重写段落：" + section.get("title", "")]
    section["refined"] = True
    section["absorbed_evidence_ids"] = extra_context.get("absorbed_evidence_ids", []) \
        if isinstance(extra_context, dict) else []
    return section


async def _drain(pipeline_coro):
    events = []
    async for ev in pipeline_coro:
        events.append(ev)
    return events


# ── 幂等：已存在 brief 不再触发 LLM ─────────────────────────
def test_brief_idempotent_no_llm_call(monkeypatch):
    """首次生成后 data.brief 存在；再次调用不再调 chat_json，返回同一份 brief。"""
    calls = []
    monkeypatch.setattr(orchestrator, "chat_json", _fake_chat_json(calls))
    _make_report("r_idem_1")

    first = orchestrator.generate_brief("r_idem_1")
    n_after_first = len(calls)
    assert first and n_after_first == 1

    second = orchestrator.generate_brief("r_idem_1")
    assert len(calls) == n_after_first, "已有 brief 时不应再次调用 LLM"
    assert second == first


# ── 端点：200 / 404 / 503 ──────────────────────────────────
def test_brief_endpoint_ok(monkeypatch):
    """POST brief → 200 + {ok:true, brief:{四段}}。"""
    monkeypatch.setattr(orchestrator, "chat_json", _fake_chat_json([]))
    _make_report("r_ep_ok")
    client = TestClient(app)
    r = client.post("/api/reports/r_ep_ok/brief")
    assert r.status_code == 200
    j = r.json()
    assert j.get("ok") is True
    b = j.get("brief") or {}
    assert b.get("summary") and b.get("judgments") and b.get("key_data") and b.get("actions")


def test_brief_endpoint_not_found_404():
    """不存在的 report_id → 404。"""
    client = TestClient(app)
    r = client.post("/api/reports/r_missing_404/brief")
    assert r.status_code == 404


def test_brief_endpoint_unconfigured_503(monkeypatch):
    """LLM 未配置（chat_json 抛 LLMNotConfigured）→ 503 + 可读消息。"""
    def _raise(*args, **kwargs):
        raise orchestrator.LLMNotConfigured("LLM 未配置")
    monkeypatch.setattr(orchestrator, "chat_json", _raise)
    _make_report("r_503")
    client = TestClient(app)
    r = client.post("/api/reports/r_503/brief")
    assert r.status_code == 503
    assert r.json().get("detail"), "503 应携带可读 detail 消息"


# ── 失效挂点 ×3 ────────────────────────────────────────────
def test_invalidate_via_refine_endpoint(monkeypatch):
    """挂点1：post_refine 成功后 data.brief / brief_failed_at 被清除。"""
    _seed_brief("r_inv_rf", monkeypatch=monkeypatch)
    monkeypatch.setattr(orchestrator, "_rewrite_section", _fake_rewrite, raising=False)
    client = TestClient(app)
    section_id = db.get_report("r_inv_rf")["sections"][0]["id"]
    r = client.post("/api/reports/r_inv_rf/refine",
                    json={"section_id": section_id, "annotations": ["批注"]})
    assert r.status_code == 200
    rep = db.get_report("r_inv_rf")
    assert "brief" not in (rep or {}), "refine 后 brief 应被清除"
    assert "brief_failed_at" not in (rep or {})


def test_invalidate_via_feedback_endpoint(monkeypatch):
    """挂点2：post_feedback 成功后 brief 被清除。"""
    _seed_brief("r_inv_fb", monkeypatch=monkeypatch)
    client = TestClient(app)
    r = client.post("/api/reports/r_inv_fb/feedback",
                    json={"edited_blocks": 1, "total_blocks": 3, "data": {}})
    assert r.status_code == 200
    rep = db.get_report("r_inv_fb")
    assert "brief" not in (rep or {}), "feedback 后 brief 应被清除"
    assert "brief_failed_at" not in (rep or {})


def test_invalidate_via_refine_pipeline_done(monkeypatch):
    """挂点3：refine_report_pipeline 成功出口（save_report 后、done 前）清除 brief。"""
    # 与 test_refine_evidence 一致：需要 ≥min_cred 的证据才会进入重写 → done
    _seed_brief_with_evidence("r_inv_pl", [("e_pl_1", 90.0)], monkeypatch=monkeypatch)
    monkeypatch.setattr(orchestrator, "_rewrite_section", _fake_rewrite, raising=False)

    async def _real():
        tid = orchestrator.create_refine_task("r_inv_pl", None, 70)["taskId"]
        return await _drain(orchestrator.refine_report_pipeline(tid))
    events = asyncio.run(_real())
    assert any(e["type"] == "done" for e in events)
    rep = db.get_report("r_inv_pl")
    assert "brief" not in (rep or {}), "pipeline done 后 brief 应被清除"


# ── 生命周期三步：生成 → 失效 → 重建 ────────────────────────
def test_brief_rebuild_after_invalidate(monkeypatch):
    """invalidate 后再次 generate 可重建新 brief（派生数据完整闭环）。"""
    calls = []
    monkeypatch.setattr(orchestrator, "chat_json", _fake_chat_json(calls))
    _make_report("r_rebuild")
    first = orchestrator.generate_brief("r_rebuild")
    assert first

    db.invalidate_report_brief("r_rebuild")
    assert "brief" not in db.get_report("r_rebuild")

    second = orchestrator.generate_brief("r_rebuild")
    assert second and second.get("judgments"), "失效后应可重建"


# ── 失败路径 / 防重 ─────────────────────────────────────────
def test_brief_llm_failure_records_failed_at(monkeypatch):
    """LLM 失败 → 记 brief_failed_at、不写 brief。"""
    def _boom(*args, **kwargs):
        raise RuntimeError("upstream down")
    monkeypatch.setattr(orchestrator, "chat_json", _boom)
    _make_report("r_fail")
    brief = orchestrator.generate_brief("r_fail")
    assert brief is None, "失败不应产出 brief"
    rep = db.get_report("r_fail")
    assert "brief" not in (rep or {})
    assert rep.get("brief_failed_at"), "应记录失败时间戳用于防重"


def test_brief_success_clears_failed_at(monkeypatch):
    """先失败后成功 → brief_failed_at 被清除。"""
    state = {"boom": True}
    def _flaky(messages, **kwargs):
        if state["boom"]:
            raise RuntimeError("first try fails")
        return {"summary": "S", "judgments": ["J"], "key_data": [], "actions": []}
    monkeypatch.setattr(orchestrator, "chat_json", _flaky)
    _make_report("r_retry")
    orchestrator.generate_brief("r_retry")
    assert db.get_report("r_retry").get("brief_failed_at")

    state["boom"] = False
    brief = orchestrator.generate_brief("r_retry")
    assert brief
    rep = db.get_report("r_retry")
    assert rep.get("brief")
    assert "brief_failed_at" not in rep, "成功后应清除失败标记"


def test_invalidate_brief_idempotent():
    """无 brief 的报告调用 invalidate_report_brief 不抛错、无副作用。"""
    _make_report("r_plain")
    db.invalidate_report_brief("r_plain")  # 不应抛异常
    db.invalidate_report_brief("r_does_not_exist")  # 不存在报告也不应抛


# ── 并发串行 ───────────────────────────────────────────────
def test_brief_concurrent_generate_serialized(monkeypatch):
    """并发两次 generate_brief：_LOCK 串行 + 写回前重读校验，结果一致、落库一份、无异常。"""
    import threading
    import time
    calls = []
    real_fake = _fake_chat_json([])

    def _slow_fake(messages, **kwargs):
        time.sleep(0.05)  # 放大竞态窗口
        calls.append(messages)
        return real_fake(messages, **kwargs)

    monkeypatch.setattr(orchestrator, "chat_json", _slow_fake)
    _make_report("r_conc")
    outs = []

    def _job():
        try:
            outs.append(orchestrator.generate_brief("r_conc"))
        except Exception as e:  # noqa: BLE001
            outs.append(e)

    t1 = threading.Thread(target=_job)
    t2 = threading.Thread(target=_job)
    t1.start(); t2.start(); t1.join(); t2.join()
    assert not any(isinstance(o, Exception) for o in outs), "并发不应抛异常"
    assert outs[0] == outs[1], "并发返回应一致（串行化 + 读命中）"
    rep = db.get_report("r_conc")
    assert rep.get("brief"), "最终应落库一份有效 brief"


# ── 降级：无 summary / metrics 组装不崩 ─────────────────────
def test_brief_assembly_without_summary(monkeypatch):
    """无 summary 节 / 无 metrics 的存量报告：上下文组装降级，产出完整结构。"""
    calls = []
    monkeypatch.setattr(orchestrator, "chat_json", _fake_chat_json(calls))
    _make_report("r_nosum", with_summary=False)
    brief = orchestrator.generate_brief("r_nosum")
    assert brief and brief.get("summary") and isinstance(brief.get("judgments"), list)


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))