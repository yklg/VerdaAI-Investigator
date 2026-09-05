/** 模型矩阵解析纯函数（与 React/组件无关，便于单测）。
   被 SettingsPage 的 candidateModels / modelMismatch / recommendedModels / syncAndSave / applyProviderPreset 复用。 */

import type { LLMProviderPreset } from './llmProviders'

/** 把厂商推荐 models 数组映射到模型矩阵 4 字段（见「切厂商模型联动修复计划」§1.1）：
    - 默认/核心章（重活）→ M[0]（厂商主推/最强）
    - 辅助章 → M[1]（第二档）
    - 杂务快速 → M[末]（末尾通常是 fast/flash/air 轻量档）
    models 为空（如火山方舟按 ep-xxx 接入点调用）→ 清空，交由用户手填。 */
export function presetModels(p: Pick<LLMProviderPreset, 'models'>): Record<string, string> {
  const M = p.models
  if (M.length === 0) {
    return { llm_model: '', llm_model_core: '', llm_model_aux: '', llm_model_fast: '' }
  }
  if (M.length === 1) {
    return { llm_model: M[0], llm_model_core: M[0], llm_model_aux: M[0], llm_model_fast: M[0] }
  }
  return {
    llm_model: M[0],
    llm_model_core: M[0],
    llm_model_aux: M[1],
    llm_model_fast: M[M.length - 1],
  }
}

/** 数组去重（保序） */
export function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr))
}

/** 把 live 模型列表规整为「角色有序」推荐集：剔除多模态(vision)实验模型，
   强模型(pro/max/plus/大上下文)前置作 default/core，轻量(flash/lite/air/mini/turbo)后置作 fast。
   与 curated `models` 的语义一致，但来源是实时列表，避免依赖手工维护的 curated。 */
export function reorderForRoles(list: string[]): string[] {
  const filtered = list.filter((m) => !/vision/i.test(m))
  const strong = /pro|max|plus|128k|32k|large|mini-\d|larget/i
  const weak = /flash|lite|air|mini|turbo|8k|light/i
  const head = filtered.filter((m) => strong.test(m))
  const tail = filtered.filter((m) => weak.test(m) && !strong.test(m))
  const mid = filtered.filter((m) => !strong.test(m) && !weak.test(m))
  return [...head, ...mid, ...tail]
}

/** 同步目标推荐集（纯函数，便于单测）：live 优先、curated 兜底。
   守卫：若 curated 默认模型(p.models[0])仍在 live 集中 → 直接沿用 curated（其角色意图已验证有效），
   避免 reorderForRoles 的 DeepSeek 中心化启发式扰动 Moonshot 等其它厂商的同步默认模型。
   仅当 curated 已过期（p.models[0] 不在 live）才回退 reorderForRoles(live)。 */
export function resolveRecommended(
  p: Pick<LLMProviderPreset, 'id' | 'models'>,
  savedId: string | undefined,
  liveModels: string[],
): string[] {
  if (p.id === savedId && liveModels.length > 0) {
    const liveSet = new Set(liveModels)
    if (p.models.length > 0 && liveSet.has(p.models[0])) return p.models
    const r = reorderForRoles(liveModels)
    if (r.length > 0) return r
  }
  return p.models
}
