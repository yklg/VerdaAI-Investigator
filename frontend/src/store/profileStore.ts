import { create } from 'zustand'

/* 当前用户展示资料（前端本地偏好，无登录鉴权）。

把原先写死在「侧边栏左下角」与「首页问候语」两处的「林研究员 / 青野科技」
收拢为单一数据源：
- localStorage 持久化（verda.profile.v1），刷新/重开浏览器不丢；
- 侧边栏、首页问候语、右上角头像统一消费此处，消除硬编码漂移；
- 纯前端展示偏好，不触达任何后端接口。

持久化写法与 taskRegistry 一致：load() 在模块初始化时读取，save() 在每次
mutation 后写回（store 动作内部调用）。 */

const LS_KEY = 'verda.profile.v1'

export const DEFAULT_NAME = '林研究员'
export const DEFAULT_COMPANY = '青野科技'

export interface ProfileData {
  name: string
  company: string
}

export interface ProfileState extends ProfileData {
  setName: (name: string) => void
  setCompany: (company: string) => void
  setProfile: (p: Partial<ProfileData>) => void
}

/** 从 localStorage 读取；缺失/损坏时回退默认值。 */
export function loadProfile(): ProfileData {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<ProfileData>
      return {
        name: typeof p.name === 'string' && p.name.trim() ? p.name : DEFAULT_NAME,
        company:
          typeof p.company === 'string' && p.company.trim() ? p.company : DEFAULT_COMPANY,
      }
    }
  } catch {
    /* 解析失败 → 回退默认 */
  }
  return { name: DEFAULT_NAME, company: DEFAULT_COMPANY }
}

/** 落盘当前资料（仅写数据字段，忽略 store 动作函数）。 */
export function saveProfile(value: ProfileData): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ name: value.name, company: value.company }))
  } catch {
    /* 忽略配额 / 隐私模式异常 */
  }
}

const initial = loadProfile()

export const useProfileStore = create<ProfileState>((set, get) => ({
  ...initial,

  setName: (name) => {
    set({ name })
    saveProfile(get())
  },

  setCompany: (company) => {
    set({ company })
    saveProfile(get())
  },

  setProfile: (p) => {
    set((s) => ({
      name: typeof p.name === 'string' ? p.name : s.name,
      company: typeof p.company === 'string' ? p.company : s.company,
    }))
    saveProfile(get())
  },
}))
