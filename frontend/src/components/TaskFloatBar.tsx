import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { useTaskRegistry, type TaskRecord } from '../store/taskRegistry'
import { getTaskStatus } from '../lib/api'

/**
 * 全局悬浮任务条：任何页面常驻，显示后台运行中的调研进度，点击直接回到工作台。
 * 与页面路由解耦（只读全局 taskRegistry，不依赖 WorkspacePage 局部状态）。
 * 用户不在工作台页时 SSE 未连接，故对 running 任务轮询后端 status 感知终态。
 */
export default function TaskFloatBar() {
  const navigate = useNavigate()
  const tasks = useTaskRegistry((s) => s.tasks)
  const markDone = useTaskRegistry((s) => s.markDone)
  const markFailed = useTaskRegistry((s) => s.markFailed)
  const remove = useTaskRegistry((s) => s.remove)

  const running = Object.values(tasks).filter((t) => t.status === 'running')
  const finished = Object.values(tasks).filter((t) => t.status === 'done' || t.status === 'failed')

  // 轮询 running 任务，同步进度 + 感知终态（脱离 SSE 的关键兜底）
  const pollRef = useRef<number | null>(null)
  useEffect(() => {
    if (pollRef.current) return
    pollRef.current = window.setInterval(async () => {
      const cur = useTaskRegistry.getState().tasks
      for (const t of Object.values(cur)) {
        if (t.status !== 'running') continue
        try {
          const st = await getTaskStatus(t.taskId)
          if (st.status === 'done' && st.report_id) markDone(t.taskId, st.report_id)
          else if (st.status === 'failed') markFailed(t.taskId)
          else if (st.status === 'running')
            useTaskRegistry.getState().upsert({
              taskId: t.taskId,
              percent: st.percent,
              stage: st.stage,
              evidence_count: st.evidence_count,
              updatedAt: st.updated_at ?? t.updatedAt,
            })
        } catch {
          /* 后端暂不可用，下一轮再试 */
        }
      }
    }, 3000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [markDone, markFailed])

  if (running.length === 0 && finished.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
      {running.map((t: TaskRecord) => (
        <button
          key={t.taskId}
          onClick={() => navigate(`/workspace/${t.taskId}`)}
          className="pointer-events-auto flex w-[min(92vw,520px)] items-center gap-3 rounded-card border border-line bg-card/95 px-4 py-2.5 shadow-card backdrop-blur transition-colors hover:border-primary/60"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-btn bg-primary-tint text-primary">
            <Activity size={16} className="animate-pulse" />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-aux font-medium text-ink">{t.query || '调研任务'}</div>
            <div className="text-tag text-ink-3">
              后台运行中 · {t.percent}%{t.stage ? ` · ${t.stage}` : ''} · {t.evidence_count} 条证据
            </div>
          </div>
          <div className="flex w-24 shrink-0 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-chip bg-line">
              <div
                className="h-full rounded-chip bg-primary transition-all"
                style={{ width: `${t.percent}%` }}
              />
            </div>
            <span className="text-tag font-medium text-primary-deep">{t.percent}%</span>
          </div>
        </button>
      ))}

      {finished.map((t: TaskRecord) => (
        <div
          key={t.taskId}
          className="pointer-events-auto flex w-[min(92vw,520px)] items-center gap-3 rounded-card border border-line bg-card/95 px-4 py-2.5 shadow-card backdrop-blur"
        >
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-btn ${
              t.status === 'done' ? 'bg-ok/15 text-ok' : 'bg-risk/15 text-risk'
            }`}
          >
            {t.status === 'done' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          </span>
          <button
            onClick={() => {
              if (t.status === 'done' && t.reportId) {
                navigate(`/report/${t.reportId}`)
                remove(t.taskId)
              } else {
                remove(t.taskId)
              }
            }}
            className="min-w-0 flex-1 text-left"
          >
            <div className="truncate text-aux font-medium text-ink">{t.query || '调研任务'}</div>
            <div className="text-tag text-ink-3">
              {t.status === 'done' ? '报告已就绪 · 点击查看' : '任务失败，点击关闭'}
            </div>
          </button>
          <button
            onClick={() => remove(t.taskId)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-btn text-ink-3 transition-colors hover:bg-primary-tint/50"
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
