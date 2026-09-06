import { FileText, Database, Layers, ShieldCheck } from 'lucide-react'
import { VCountUp } from './ui'
import type { Report } from '../types'

/**
 * 关键指标速览数据带（封面下方）。指标定义单一来源，
 * 完整视图 / 简报视图 / 幻灯片共用，避免复制导致口径分叉。
 */
export default function MetricsStrip({ report }: { report: Report }) {
  const r = report
  const indepDomains = new Set(r.evidence.map((e) => e.domain).filter(Boolean)).size
  const highConf = r.claims.filter((c) => c.confidence === 'high').length
  const confRate = r.claims.length ? Math.round((highConf / r.claims.length) * 100) : 0
  const metrics = [
    { icon: FileText, label: '核心结论', value: r.claims.length, unit: '条' },
    { icon: Database, label: '联网证据', value: r.evidence.length, unit: '条' },
    { icon: Layers, label: '独立信源', value: indepDomains, unit: '个' },
    { icon: ShieldCheck, label: '高置信占比', value: confRate, unit: '%' },
  ]
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-2 gap-px px-6 sm:grid-cols-4">
      {metrics.map((m, i) => (
        <div key={i} className="flex flex-col items-center gap-1 py-5">
          <m.icon size={16} className="text-primary" />
          <div className="flex items-baseline gap-0.5">
            <VCountUp value={m.value} className="font-serif text-[26px] leading-none text-ink" />
            <span className="text-tag text-ink-3">{m.unit}</span>
          </div>
          <span className="text-tag text-ink-3">{m.label}</span>
        </div>
      ))}
    </div>
  )
}