// @vitest-environment node
/**
 * 报告精修 api 封装测试（单一摄入架构下保留：证据库 → refineReportEvidence）。
 *
 * 在真实 api 模块上跑（不 mock ../lib/api），用 vi.stubGlobal('fetch') 拦截请求。
 *
 * 覆盖：
 *  - test_refineReportEvidence_api     refineReportEvidence(rid,{min_cred:70}) → POST → {taskId}
 */
import { describe, it, expect, vi } from 'vitest'
import { refineReportEvidence } from '../lib/api'

describe('api 封装', () => {
  it('refineReportEvidence → POST /api/reports/{id}/refine-evidence → {taskId}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ taskId: 't_refine_1' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await refineReportEvidence('r1', { min_cred: 70 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/reports/r1/refine-evidence'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ min_cred: 70 }) }),
    )
    expect(res.taskId).toBe('t_refine_1')
    vi.unstubAllGlobals()
  })
})