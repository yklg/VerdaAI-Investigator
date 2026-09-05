import type { ReactNode, ButtonHTMLAttributes, HTMLAttributes } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { useEffect } from 'react'

/* ── 卡片 VCard ─────────────────────────────────────────── */
export function VCard({
  children,
  className = '',
  hover = true,
  ...rest
}: { children: ReactNode; className?: string; hover?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-card rounded-card shadow-card p-6 border border-line/60 transition-all duration-300 ease-verda ${
        hover ? 'hover:shadow-float hover:-translate-y-0.5' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

/* ── 按钮 VButton ───────────────────────────────────────── */
export function VButton({
  children,
  variant = 'primary',
  className = '',
  ...p
}: {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'soft'
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'inline-flex items-center justify-center gap-2 px-5 h-11 rounded-btn font-medium text-sm transition-all duration-200 ease-verda active:scale-95 disabled:opacity-50 disabled:pointer-events-none'
  const styles =
    variant === 'primary'
      ? 'bg-primary text-white hover:bg-primary-deep shadow-card hover:shadow-float'
      : variant === 'soft'
        ? 'bg-primary-tint text-primary-deep hover:bg-primary-soft/40'
        : 'bg-transparent text-ink-2 hover:bg-primary-tint hover:text-primary-deep'
  return (
    <button className={`${base} ${styles} ${className}`} {...p}>
      {children}
    </button>
  )
}

/* ── Chip / 置信度标签 VChip ────────────────────────────── */
const tone = {
  high: 'bg-ok/15 text-ok',
  medium: 'bg-warn/15 text-warn',
  low: 'bg-risk/15 text-risk',
  unverified: 'bg-ink-3/15 text-ink-3',
  neutral: 'bg-primary-tint text-primary-deep',
} as const

export function VChip({
  label,
  level = 'neutral',
  icon,
  className = '',
}: {
  label: ReactNode
  level?: keyof typeof tone
  icon?: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-3 h-7 rounded-chip text-xs font-medium ${tone[level]} ${className}`}
    >
      {icon}
      {label}
    </span>
  )
}

/* ── 柔光晕 VSunGlow（春日阳光氛围） ────────────────────── */
export function VSunGlow({ className = '' }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute -z-0 ${className}`}
      style={{
        width: 520,
        height: 520,
        top: -160,
        right: -120,
        background: 'radial-gradient(circle, #F4E2B8 0%, rgba(244,226,184,0) 70%)',
        opacity: 0.5,
        filter: 'blur(8px)',
      }}
    />
  )
}

/* ── 数字滚动 VCountUp（Agent 感关键） ──────────────────── */
export function VCountUp({ value, className = '' }: { value: number; className?: string }) {
  const mv = useMotionValue(0)
  const rounded = useTransform(mv, (v) => Math.round(v))
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.8, ease: 'easeOut' })
    return () => c.stop()
  }, [value, mv])
  return <motion.span className={className}>{rounded}</motion.span>
}

/* ── 骨架占位 VSkeleton（降级用，绝不白屏） ─────────────── */
export function VSkeleton({ className = '' }: { className?: string }) {
  return <div className={`v-skeleton ${className}`} />
}

/* ── 通用弹窗 VModal（SettingsPage 弹窗化首用，未来可复用） ──
   结构：遮罩（点击关闭）+ 居中卡（标题行 + 内容体）。
   约束：
   - 内容体 overflow-hidden，纵向滚动由消费方内容区自行控制
     （惯例：children 根节点给 `flex h-full`，右内容区给 overflow-y-auto）；
   - 打开期间锁 body 滚动，关闭时还原前值（防多实例互踩）；Esc 关闭。 */
export function VModal({
  open,
  onClose,
  title,
  width = 780,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  width?: number
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      {/* 遮罩：点击关闭 */}
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      {/* 居中卡：固定高度避免切 tab 时 content-driven 伸缩；h-[min(720px,85vh)] 兼顾小屏与桌面 */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-[min(720px,85vh)] flex-col bg-card shadow-float border border-line/60 rounded-card"
        style={{ width, maxWidth: 'calc(100vw - 32px)' }}
      >
        {/* 标题行 */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line/50 px-6 py-4">
          <div className="truncate text-base font-semibold text-ink">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn text-xl leading-none text-ink-2 transition-colors duration-200 ease-verda hover:bg-primary-tint hover:text-primary-deep"
          >
            ×
          </button>
        </div>
        {/* 内容体：overflow-hidden + overflow-y-scroll 让滚动条轨道常驻，切 tab 时右 pane 宽度恒定防抽搐 */}
        <div className="min-h-0 flex-1 overflow-hidden overflow-y-scroll">{children}</div>
      </div>
    </div>
  )
}
