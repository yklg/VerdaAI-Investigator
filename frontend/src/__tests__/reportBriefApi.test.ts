// @vitest-environment node
/**
 * api 层封装测试：generateReportBrief（《报告简报与 PPT 汇报方案 v3》）。
 * 契约：POST /api/reports/{id}/brief → {ok, brief?}；非 2xx / 网络异常必须 throw（失败显式，不做静默兜底）。
 * 依赖的真实 api 函数在生产实现落地后转绿（TDD 红→绿）。
 */
import { describe, it, expect, vi } from 'vitest'
import { generateReportBrief } from '../lib/api'

const fakeBrief = {
  summary: '一句话概括',
  judgments: ['判断1', '判断2'],
  key_data: ['数据1'],
  actions: ['行动1', '行动2'],
}

describe('generateReportBrief api 封装', () => {
  it('POST /api/reports/{id}/brief → 返回 {ok, brief}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, brief: fakeBrief }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await generateReportBrief('r1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/reports/r1/brief'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(res.ok).toBe(true)
    expect(res.brief).toEqual(fakeBrief)
    vi.unstubAllGlobals()
  })

  it('HTTP 非 2xx（500）→ throw（失败显式，不伪装成功）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'boom' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateReportBrief('r1')).rejects.toThrow()
    vi.unstubAllGlobals()
  })

  it('网络异常（fetch reject）→ throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('NetworkError')))
    await expect(generateReportBrief('r1')).rejects.toThrow()
    vi.unstubAllGlobals()
  })
})