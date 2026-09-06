// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

/* profileStore 纯前端单测：默认回退、持久化、从 localStorage 还原。
每条用例用 vi.resetModules() + 动态 import 保证 store 单例按「当时 localStorage」
重新初始化，互不污染。 */

const LS_KEY = 'verda.profile.v1'

describe('profileStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('默认回退为 林研究员 / 青野科技', async () => {
    const { useProfileStore, DEFAULT_NAME, DEFAULT_COMPANY } = await import('./profileStore')
    const s = useProfileStore.getState()
    expect(s.name).toBe(DEFAULT_NAME)
    expect(s.company).toBe(DEFAULT_COMPANY)
  })

  it('setName / setCompany 写回 localStorage', async () => {
    const { useProfileStore } = await import('./profileStore')
    useProfileStore.getState().setName('李工')
    useProfileStore.getState().setCompany('某科技公司')
    const raw = JSON.parse(localStorage.getItem(LS_KEY)!)
    expect(raw).toEqual({ name: '李工', company: '某科技公司' })
    // store 内存同步
    expect(useProfileStore.getState().name).toBe('李工')
    expect(useProfileStore.getState().company).toBe('某科技公司')
  })

  it('setProfile 支持局部更新（只改昵称，公司保留）', async () => {
    const { useProfileStore } = await import('./profileStore')
    useProfileStore.getState().setCompany('保留公司')
    useProfileStore.getState().setProfile({ name: '王研究员' })
    const raw = JSON.parse(localStorage.getItem(LS_KEY)!)
    expect(raw).toEqual({ name: '王研究员', company: '保留公司' })
  })

  it('从 localStorage 还原（模拟刷新后重新初始化）', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ name: '赵分析师', company: 'X Lab' }))
    vi.resetModules()
    const { useProfileStore } = await import('./profileStore')
    const s = useProfileStore.getState()
    expect(s.name).toBe('赵分析师')
    expect(s.company).toBe('X Lab')
  })

  it('localStorage 损坏时回退默认，不抛错', async () => {
    localStorage.setItem(LS_KEY, '{不是合法json')
    vi.resetModules()
    const { useProfileStore, DEFAULT_NAME, DEFAULT_COMPANY } = await import('./profileStore')
    const s = useProfileStore.getState()
    expect(s.name).toBe(DEFAULT_NAME)
    expect(s.company).toBe(DEFAULT_COMPANY)
  })
})
