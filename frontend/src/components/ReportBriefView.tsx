import { useState } from 'react'
import { Sparkles, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'
import { generateReportBrief } from '../lib/api'
import { VChart } from './VChart'
import type { Report, ReportBrief } from '../types'

const COOLDOWN_MS = 30_000

/**
 * 简报视图（只读快览）：一页纸精炼（AI 生成四段）+ 逐节核心判断/亮点/图表 + 展开全文折叠。
 * 原则：纯文本渲染（禁 dangerouslySetInnerHTML，防注入）；空章节自动过滤；亮点 ≤4 条；
 * 失败显式：展示错误并按 brief_failed_at 冷却 30s 禁用重新生成。
 */
export default function ReportBriefView({ report }: { report: Report }) {
  const [brief, setBrief] = useState<ReportBrief | undefined>(report.brief)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const failedAt = report.brief_failed_at ? new Date(report.brief_failed_at).getTime() : 0
  const cooling = Date.now() - failedAt < COOLDOWN_MS
  const canGenerate = !loading && !cooling && !brief

  const onGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await generateReportBrief(report.id)
      if (res.brief) setBrief(res.brief)
      else setError(res.message || '生成失败，请稍后重试')
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sections = report.sections.filter(
    (s) => s.key_takeaway || (s.highlights && s.highlights.length > 0) || (s.charts && s.charts.length > 0),
  )

  return (
    <div className="relative mx-auto max-w-3xl px-6 py-8">
      {/* 一页纸精炼 */}
      <div className="rounded-card border border-line bg-card p-5 shadow-card">
        <div className="flex items-center gap-2 text-aux font-semibold text-primary-deep">
          <Sparkles size={16} /> 一页纸精炼
          {brief && <span className="text-tag font-normal text-ink-3">· 结论已压缩为汇报要点，完整论证见全文</span>}
        </div>

        {brief ? (
          <>
            <p className="mt-3 text-aux leading-relaxed text-ink">
              <span className="font-semibold text-primary-deep">一句话概括：</span>
              {brief.summary || '（暂无概括）'}
            </p>
            <BriefList title="核心判断" items={brief.judgments} />
            <BriefList title="关键数据" items={brief.key_data} />
            <BriefList title="行动建议" items={brief.actions} />
          </>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-tag text-ink-3">
              未生成一页纸精炼。点击右侧按钮由 AI 压缩整份报告，生成后随报告持久保存。
              {cooling && <span className="text-warn"> · 上次失败不足 30 秒，请稍后再试</span>}
            </p>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-btn bg-primary px-4 h-9 text-sm font-medium text-white shadow-card transition-all hover:bg-primary-deep disabled:opacity-50"
            >
              <Sparkles size={14} />
              {loading ? '生成中…' : 'AI 生成一页纸精炼'}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-card border border-warn/40 bg-red-50 px-3 py-2 text-tag text-warn">
            生成失败：{error}
          </div>
        )}
      </div>

      {/* 章节简报卡片流 */}
      <div className="mt-6 space-y-3">
        {sections.length === 0 && (
          <p className="py-10 text-center text-tag text-ink-3">报告暂无可用章节要点</p>
        )}
        {sections.map((sec, idx) => {
          const isOpen = expanded.has(sec.id)
          return (
            <div key={sec.id} className="overflow-hidden rounded-card border border-line bg-card shadow-card">
              <div className="flex items-center gap-3 px-5 pt-4">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-chip bg-primary-tint font-serif text-[14px] font-semibold text-primary-deep">
                  {idx + 1}
                </span>
                <h3 className="text-aux font-semibold text-ink">{sec.title}</h3>
              </div>
              {sec.key_takeaway && (
                <div className="mx-5 mt-3 flex gap-2 rounded-card border-l-[3px] border-primary bg-primary-tint/40 p-3">
                  <Lightbulb size={15} className="mt-0.5 shrink-0 text-primary-deep" />
                  <p className="text-aux leading-relaxed text-ink-2">{sec.key_takeaway}</p>
                </div>
              )}
              {(sec.highlights ?? []).slice(0, 4).length > 0 && (
                <ul className="mx-5 mt-3 space-y-1.5">
                  {(sec.highlights ?? []).slice(0, 4).map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-aux text-ink-2">
                      <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-primary" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              )}
              {sec.charts && sec.charts.length > 0 && (
                <div className="mx-5 mt-3">
                  {sec.charts.map((c) => (
                    <VChart key={c.chart_id} spec={c} />
                  ))}
                </div>
              )}
              {sec.paragraphs && sec.paragraphs.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => toggle(sec.id)}
                    className="mx-5 my-3 inline-flex items-center gap-1 text-tag text-primary-deep hover:underline"
                  >
                    {isOpen ? (
                      <>
                        <ChevronUp size={13} /> 收起全文
                      </>
                    ) : (
                      <>
                        <ChevronDown size={13} /> 展开全文（{sec.paragraphs.length} 段）
                      </>
                    )}
                  </button>
                  {isOpen && (
                    <div className="brief-para-expand space-y-3 border-t border-line px-5 py-4">
                      {sec.paragraphs.map((p, i) => (
                        <p key={i} className="text-aux leading-relaxed text-ink-2">{p}</p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="mt-3">
      <div className="text-tag font-semibold text-ink-3">{title}</div>
      <ul className="mt-1.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-aux text-ink-2">
            <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-primary" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}