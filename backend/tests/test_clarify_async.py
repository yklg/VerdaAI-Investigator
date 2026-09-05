"""方案 A（Clarify 异步化）回归测试：守护 3 个 P0 + 4 个 P1 不退化。

复用 conftest 的 VERDA_DB_PATH 临时库隔离 + autouse _isolate。
异步用例用 asyncio.run 包裹，避免引入 pytest-asyncio 依赖。
"""
import asyncio
import threading
from unittest.mock import patch, MagicMock

import pytest

import app.core.db as db
from app.core import orchestrator as O


@pytest.fixture(autouse=True)
def _clear_gen_lock():
    yield
    O._GEN_INFLIGHT.clear()


# ── P0：create_task 不调 LLM（根因守卫）─────────────────────
def test_ct2_create_task_no_llm():
    with patch.object(O, "_clarify_questions", MagicMock()) as m:
        resp = O.create_task("分析特斯拉竞品", mode="deep", model=None)
    m.assert_not_called()
    assert "taskId" in resp
    assert "needClarify" not in resp
    task = db.get_task(resp["taskId"])
    assert task is not None
    assert task["query"] == "分析特斯拉竞品"
    assert task["clarifications"].get("_mode") == "deep"


def test_ct1_create_task_shape():
    resp = O.create_task("q", "quick", "glm-5.2")
    assert set(resp.keys()) == {"taskId"}
    task = db.get_task(resp["taskId"])
    assert task["clarifications"].get("_model_override") == "glm-5.2"


def test_ct4_model_override_passthrough():
    resp = O.create_task("q", "expert", "some-model")
    task = db.get_task(resp["taskId"])
    assert task["clarifications"].get("_model_override") == "some-model"


# ── P0：generate_clarify 用 asyncio.to_thread（不阻塞事件循环）──
def test_gc1_generate_uses_to_thread():
    captured = {}
    real_to_thread = asyncio.to_thread

    async def fake_to_thread(func, *a, **k):
        captured["func"] = func
        return await real_to_thread(func, *a, **k)

    # 显式持有 mock 引用（补丁退出后 O._clarify_questions 会还原为真实函数）
    mock_q = MagicMock(
        return_value=[{"id": "x", "question": "q", "type": "text", "options": []}]
    )

    async def impl():
        tid = O._sid("t")
        db.save_task(tid, "q", {"_mode": "deep"})
        with patch.object(O, "_clarify_questions", mock_q):
            with patch.object(asyncio, "to_thread", fake_to_thread):
                return [ev async for ev in O.generate_clarify(tid, "q")]

    events = asyncio.run(impl())
    # P0#1：必须经由 asyncio.to_thread 调用同步阻塞的 _clarify_questions
    assert captured.get("func") is mock_q
    ready = [e for e in events if e["type"] == "clarify_ready"]
    assert ready, "应产出 clarify_ready"
    assert ready[0]["data"]["questions"]


# ── P1：LLM 抛错降级静态问卷（不卡 loading）────────────────
def test_gc2_degraded_on_error():
    async def impl():
        tid = O._sid("t")
        db.save_task(tid, "q", {})
        with patch.object(O, "_clarify_questions", side_effect=RuntimeError("boom")):
            return [ev async for ev in O.generate_clarify(tid, "q")]

    events = asyncio.run(impl())
    ready = [e for e in events if e["type"] == "clarify_ready"]
    assert ready, "降级仍应产出 clarify_ready"
    assert ready[0]["data"]["degraded"] is True
    assert ready[0]["data"]["questions"]  # 静态降级问卷非空


# ── P1：并发重入（在途 future）防双生成 ──────────────────
def test_gc3_inflight_prevents_double_gen():
    tid = O._sid("t")
    db.save_task(tid, "q", {})

    async def impl():
        # 模拟已有在途生成（DB 尚空），后续进入的协程应复用而非重生成
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        fut.set_result([{"id": "a", "question": "a", "type": "text", "options": []}])
        O._GEN_INFLIGHT[tid] = fut
        with patch.object(O, "_clarify_questions", MagicMock()) as m:
            evs = [e async for e in O.generate_clarify(tid, "q")]
        return evs, m

    events, mock_q = asyncio.run(impl())
    mock_q.assert_not_called()  # 复用在途结果，不重复调 LLM
    assert any(e["type"] == "clarify_ready" for e in events)


def test_gc4_concurrent_no_double_gen():
    counter = {"n": 0}

    def fake_q(q):
        counter["n"] += 1
        return [{"id": "x", "question": "q", "type": "text", "options": []}]

    async def drain(gen):
        out = []
        async for ev in gen:
            out.append(ev)
        return out

    async def impl():
        tid = O._sid("t")
        db.save_task(tid, "q", {})
        with patch.object(O, "_clarify_questions", side_effect=fake_q):
            return await asyncio.gather(
                drain(O.generate_clarify(tid, "q")),
                drain(O.generate_clarify(tid, "q")),
            )

    asyncio.run(impl())
    # 并发应只生成一次（锁 + 首个落库后第二个直读）
    assert counter["n"] == 1, f"并发应只生成一次，实际 {counter['n']}"


# ── P1：存量库 ALTER 迁移补齐列 ──────────────────────────
def test_db2_alter_migration():
    import sqlite3
    import tempfile
    import os

    # 用 /tmp 临时库（与 conftest 的 VERDA_DB_PATH 隔离方式一致，规避 sandbox 对 tmp_path 的写限制）
    d = tempfile.mkdtemp(prefix="verda-mig-")
    p = os.path.join(d, "old.db")
    conn = sqlite3.connect(p)
    # 模拟存量库：tasks 表无 clarify_questions 列
    conn.execute(
        "CREATE TABLE tasks (task_id TEXT PRIMARY KEY, query TEXT, clarifications TEXT, "
        "status TEXT, created_at TEXT, report_id TEXT)"
    )
    conn.commit()
    conn.close()

    c = sqlite3.connect(p)
    db._init_schema(c)  # 内部 CREATE IF NOT EXISTS + ALTER 补齐列
    cols = [r[1] for r in c.execute("PRAGMA table_info(tasks)").fetchall()]
    c.close()
    assert "clarify_questions" in cols


# ── P2：读写往返 / 未生成为 None ──────────────────────────
def test_db1_save_get_roundtrip():
    tid = O._sid("t")
    db.save_task(tid, "q", {})
    qs = [{"id": "f", "question": "聚焦维度？", "type": "multi", "options": ["功能"]}]
    db.save_clarify_questions(tid, qs)
    got = db.get_clarify_questions(tid)
    assert got == {"questions": qs}


def test_db3_get_none_when_empty():
    tid = O._sid("t")
    db.save_task(tid, "q", {})
    assert db.get_clarify_questions(tid) is None


# ── P0：POST /api/tasks < 100ms 且不含问卷（集成，不再调 LLM）──
def test_api1_post_tasks_fast():
    from fastapi.testclient import TestClient
    import app.main as main_mod
    import time

    with TestClient(main_mod.app) as client:
        t0 = time.perf_counter()
        resp = client.post(
            "/api/tasks",
            json={"query": "分析 A 与 B 竞争", "mode": "deep", "model": None},
        )
        dt = time.perf_counter() - t0

    assert resp.status_code == 200
    body = resp.json()
    assert "taskId" in body
    assert "needClarify" not in body
    assert dt < 0.1, f"POST /api/tasks 应 <100ms，实际 {dt * 1000:.1f}ms"
