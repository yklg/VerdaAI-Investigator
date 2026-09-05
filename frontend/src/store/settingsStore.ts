import { create } from 'zustand'
import type { SettingsResp } from '../types'
import { fetchSettings } from '../lib/api'

interface SettingsState {
  resp: SettingsResp | null
  loading: boolean
  /** 拉取运行时配置（失败容错：resp 置 null，UI 不强依赖） */
  load: () => Promise<void>
  /** 清空缓存，触发下次 load 重新拉取 */
  invalidate: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  resp: null,
  loading: false,
  load: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const resp = await fetchSettings()
      set({ resp, loading: false })
    } catch {
      set({ resp: null, loading: false })
    }
  },
  invalidate: () => set({ resp: null }),
}))
