// @vitest-environment jsdom
/**
 * 简报视图（ReportBriefView）渲染 + ReportPage 「简报/演示」入口接线测试（test-coverage-expander 方案）。
 *
 * 依赖的生产实现（TDD 红→绿，落地后转绿）：
 * - components/ReportBriefView.tsx（props: { report: Report }，report 含可选 brief / brief_failed_at）
 * - lib/api generateReportBrief、pages/ReportPage.tsx 顶栏「简报」「演示」按钮 + briefMode 切换
 *
 * 覆盖：
 *  - brief 四段渲染 / 无 brief 生成按钮 / 失败显式 + 30s 冷却置灰
 *  - 纯文本渲染（禁用 dangerouslySetInnerHTML，防注入）
 *  - 章节卡片：空节过滤、核心判断+亮点≤4、展开全文折叠
 *  - ReportPage：点「简报」切简报视图、再点恢复完整视图（指标带仍在）；点「演示」跳 /report/{id}/slides
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ReportBriefView from '../components/ReportBriefView'
import * as api from '../lib/api'
import type { Report } from '../types'

const { navigateFn } = vi.hoisted(() => ({ navigateFn: vi.fn() }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateFn,
  useParams: () => ({ reportId: 'r1' }),
  MemoryRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Route: ({ element }: { element: React.ReactNode }) => <div>{element}</div>,
}))

// ReportPage 渲染路径需要的 api 全集（与 reportRefine.test.tsx 对齐 + 新增 generateReportBrief）
vi.mock('../lib/api', () => ({
  refineReportEvidence: vi.fn(),
  openTaskStream: vi.fn(() => () => {}),
  fetchReport: vi.fn(),
  generateReportBrief: vi.fn(),
}))

vi.mock('../store/reportStore', () => ({
  useReportStore: () => ({
    current: {
      id: 'r1',
      title: '测试报告',
      subtitle: '副标题',
      created_at: '2026-09-06T10:00:00',
      experts: [],
      cover_image: '/assets/brand/report-cover.png',
      toc: [],
      sections: [
        {
          id: 'summary',
          title: '执行摘要',
          key_takeaway: '摘要核心判断',
          highlights: ['摘要亮点1'],
          paragraphs: ['摘要全文段落。'],
          claims: [],
          charts: [],
        },
      ],
      claims: [],
      evidence: [],
      figures: [],
      sentiment: undefined,
      trace: [],
      glossary: [],
      metrics: {},
      audit_review: undefined,
      quality_before: undefined,
      quality_after: undefined,
    },
    loading: false,
    error: null,
    load: vi.fn(),
  }),
}))

const mockedGenerate = api.generateReportBrief as unknown as ReturnType<typeof vi.fn>

function makeReport(overrides: Partial<Report> = {}): Report {
  const id = overrides.id ?? 'r1'
  return {
    id,
    title: '测试报告',
    subtitle: '副标题',
    created_at: '2026-09-06T10:00:00',
    experts: [],
    cover_image: '',
    toc: [],
    claims: [],
    evidence: [],
    figures: [],
    charts: [],
    glossary: [],
    sentiment: undefined,
    trace: [],
    metrics: {},
    audit_review: undefined,
    quality_before: undefined,
    quality_after: undefined,
    sections: [],
    ...overrides,
  }
}

const fakeBrief = {
  summary: '一句话概括',
  judgments: ['判断1', '判断2', '判断3'],
  key_data: ['数据甲', '数据乙'],
  actions: ['行动A', '行动B', '行动C'],
}

beforeEach(() => {
  mockedGenerate.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ReportBriefView 一页纸精炼', () => {
  it('存在 brief → 渲染一句话概括/核心判断/关键数据/行动建议 四段', () => {
    render(<ReportBriefView report={makeReport({ brief: fakeBrief })} />)
    expect(screen.getByText('一句话概括')).toBeTruthy()
    expect(screen.getByText('判断1')).toBeTruthy()
    expect(screen.getByText('数据甲')).toBeTruthy()
    expect(screen.getByText('行动A')).toBeTruthy()
  })

  it('无 brief → 显示「AI 生成一页纸精炼」按钮，点击调用 generateReportBrief 并渲染结果', async () => {
    mockedGenerate.mockResolvedValue({ ok: true, brief: fakeBrief })
    render(<ReportBriefView report={makeReport()} />)
    const btn = screen.getByRole('button', { name: /AI 生成一页纸精炼/ })
    fireEvent.click(btn)
    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(screen.getByText('一句话概括')).toBeTruthy())
  })

  it('失败显式 + 冷却：brief_failed_at 距今 <30s 时按钮置灰并提示冷却', async () => {
    mockedGenerate.mockRejectedValue(new Error('LLM 未配置'))
    const failedAt = new Date(Date.now() - 5 * 1000).toISOString() // 5 秒前失败 → 冷却中
    render(<ReportBriefView report={makeReport({ brief_failed_at: failedAt })} />)
    const btn = screen.getByRole('button', { name: /AI 生成一页纸精炼/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByText(/上次失败不足 30 秒/)).toBeTruthy()
    // 冷却期点击无效：不会触发生成（也不会产生新的失败文案）
    fireEvent.click(btn)
    expect(mockedGenerate).not.toHaveBeenCalled()
  })

  it('冷却期过后（brief_failed_at 距今 ≥30s）按钮恢复可点击；点击失败 → 展示原因', async () => {
    mockedGenerate.mockRejectedValue(new Error('LLM 未配置'))
    const stale = new Date(Date.now() - 60 * 1000).toISOString()
    render(<ReportBriefView report={makeReport({ brief_failed_at: stale })} />)
    const btn = screen.getByRole('button', { name: /AI 生成一页纸精炼/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByText(/生成失败：LLM 未配置/)).toBeTruthy())
  })

  it('brief 含 HTML 特殊字符 → 以纯文本渲染，不产生元素（禁止 dangerouslySetInnerHTML）', () => {
    const evil = '<b onclick="window.__x=1">malicious</b>'
    const { container } = render(
      <ReportBriefView
        report={makeReport({
          brief: {
            summary: evil,
            judgments: ['<img src=x onerror=alert(1)>'],
            key_data: [],
            actions: [],
          },
        })}
      />,
    )
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    // 整串以纯文本渲染（React 转义，含标签字面量）
    expect(screen.getByText(evil)).toBeTruthy()
    expect(screen.queryByText('malicious')).toBeNull() // 不产生 <b> 元素 → 无独立文本节点
  })
})

describe('ReportBriefView 章节简报卡片流', () => {
  const reportWithSections = makeReport({
    sections: [
      {
        id: 'summary',
        title: '执行摘要',
        level: 0,
        key_takeaway: '摘要核心判断',
        highlights: ['摘要亮点1', '摘要亮点2', '摘要亮点3', '摘要亮点4', '摘要亮点5'],
        paragraphs: ['摘要全文段落。'],
        claims: [],
        charts: [],
      },
      { id: 'empty', title: '空章节（应被过滤）', level: 1, paragraphs: [] },
      {
        id: 'overview',
        title: '竞争格局',
        level: 1,
        key_takeaway: '格局判断',
        highlights: ['格局亮点'],
        paragraphs: ['格局全文。'],
        claims: [],
        charts: [],
      },
    ],
  })

  it('空章节被过滤；核心判断+亮点（≤4）渲染；「展开全文」折叠切换', () => {
    render(<ReportBriefView report={reportWithSections} />)
    expect(screen.queryByText('空章节（应被过滤）')).toBeNull()
    expect(screen.getAllByText('摘要核心判断').length).toBeGreaterThan(0)
    expect(screen.getAllByText('摘要亮点1').length).toBeGreaterThan(0)
    expect(screen.queryByText('摘要亮点5')).toBeNull() // 溢出省略
    // 默认收起全文
    expect(screen.queryByText('摘要全文段落。')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /展开全文/ })[0])
    expect(screen.getByText('摘要全文段落。')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /收起全文|收起/ })[0])
    expect(screen.queryByText('摘要全文段落。')).toBeNull()
  })
})

describe('ReportPage 简报/演示入口接线', () => {
  async function renderReportPage(withSlidesLanding = false) {
    const ReportPage = (await import('../pages/ReportPage')).default
    return render(
      <MemoryRouter initialEntries={['/report/r1']}>
        <Routes>
          <Route path="/report/:reportId" element={<ReportPage />} />
          {withSlidesLanding && (
            <Route path="/report/:reportId/slides" element={<div data-testid="slides-landing">幻灯片落地页</div>} />
          )}
        </Routes>
      </MemoryRouter>,
    )
  }

  it('点「简报」→ 简报视图出现（生成按钮/卡片流）；再点回 → 完整视图指标带仍在', async () => {
    await renderReportPage()
    const briefBtn = await screen.findByRole('button', { name: /简报/ })
    fireEvent.click(briefBtn)
    // 简报视图：无 brief 时出现「AI 生成一页纸精炼」
    expect(screen.getByRole('button', { name: /AI 生成一页纸精炼/ })).toBeTruthy()
    // 返回完整视图：指标速览带（恒定标签）仍在
    fireEvent.click(briefBtn)
    expect(screen.getAllByText(/核心结论/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/联网证据/).length).toBeGreaterThan(0)
  })

  it('点「演示」→ 导航到 /report/r1/slides（落地路由出现）', async () => {
    await renderReportPage(true)
    fireEvent.click(await screen.findByRole('button', { name: /演示/ }))
    await screen.findByTestId('slides-landing')
    expect(screen.getByTestId('slides-landing')).toBeTruthy()
  })
})