import { describe, it, expect } from 'vitest'
import {
  reorderForRoles,
  presetModels,
  dedupe,
  resolveRecommended,
} from '../modelResolution'
import type { LLMProviderPreset } from '../llmProviders'

const deepseek: Pick<LLMProviderPreset, 'id' | 'models'> = {
  id: 'deepseek',
  models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
}

describe('reorderForRoles (S3a)', () => {
  it('T1.1 DeepSeek live 原始顺序：剔除 vision + pro 前置', () => {
    expect(
      reorderForRoles([
        'deepseek-v4-flash',
        'deepseek-v4-pro',
        'deepseek-v4-flash-vision-exp',
      ]),
    ).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
  })

  it('T1.2 已有序时保持稳定', () => {
    expect(reorderForRoles(['deepseek-v4-pro', 'deepseek-v4-flash'])).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ])
  })

  it('T1.3 全为多模态 → 空', () => {
    expect(reorderForRoles(['xxx-vision-exp'])).toEqual([])
  })

  it('T1.4 非 DeepSeek 命名（Moonshot）：strong 前置', () => {
    expect(
      reorderForRoles([
        'kimi-latest',
        'moonshot-v1-128k',
        'moonshot-v1-32k',
        'moonshot-v1-8k',
      ]),
    ).toEqual(['moonshot-v1-128k', 'moonshot-v1-32k', 'kimi-latest', 'moonshot-v1-8k'])
  })

  it('T1.5 空输入 → 空', () => {
    expect(reorderForRoles([])).toEqual([])
  })
})

describe('presetModels (既有映射，S3 复用)', () => {
  it('T2.1 0 模型（火山）→ 全空', () => {
    expect(presetModels({ models: [] })).toEqual({
      llm_model: '',
      llm_model_core: '',
      llm_model_aux: '',
      llm_model_fast: '',
    })
  })

  it('T2.2 1 模型 → 四字段全同', () => {
    expect(presetModels({ models: ['m1'] })).toEqual({
      llm_model: 'm1',
      llm_model_core: 'm1',
      llm_model_aux: 'm1',
      llm_model_fast: 'm1',
    })
  })

  it('T2.3 ≥2 模型：core=M[0] / aux=M[1] / fast=M[末]', () => {
    expect(presetModels({ models: ['a', 'b', 'c', 'd', 'e'] })).toEqual({
      llm_model: 'a',
      llm_model_core: 'a',
      llm_model_aux: 'b',
      llm_model_fast: 'e',
    })
  })
})

describe('dedupe', () => {
  it('保序去重', () => {
    expect(dedupe(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })
})

describe('resolveRecommended (S3b · P1-② 守卫)', () => {
  it('T3.1 curated 有效（默认在 live）→ 沿用 curated，不触发重排', () => {
    expect(
      resolveRecommended(deepseek, 'deepseek', [
        'deepseek-v4-pro',
        'deepseek-v4-flash',
        'deepseek-v4-flash-vision-exp',
      ]),
    ).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
  })

  it('T3.2 curated 过期（默认不在 live）→ 回退 reorderForRoles(live)', () => {
    expect(
      resolveRecommended(
        { id: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] },
        'deepseek',
        ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'],
      ),
    ).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
  })

  it('T3.3 草稿≠已保存 → 不并入 live，返回 curated', () => {
    expect(
      resolveRecommended(deepseek, 'moonshot', [
        'deepseek-v4-pro',
        'deepseek-v4-flash',
      ]),
    ).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
  })

  it('T3.4 live 为空 → 返回 curated', () => {
    expect(resolveRecommended(deepseek, 'deepseek', [])).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ])
  })
})
