// 依赖无关验证：用 `node --experimental-strip-types` 直接跑（无需 vitest）。
// 仅验证 modelResolution.ts 的纯函数逻辑（对应 T1–T3）。
import {
  reorderForRoles,
  presetModels,
  dedupe,
  resolveRecommended,
} from '../src/lib/modelResolution.ts'

let pass = 0
let fail = 0
function eq(actual: unknown, expected: unknown, name: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`)
  }
}

const deepseek = { id: 'deepseek', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] }

console.log('reorderForRoles (T1)')
eq(
  reorderForRoles(['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']),
  ['deepseek-v4-pro', 'deepseek-v4-flash'],
  'T1.1 DeepSeek live → 剔 vision + pro 前置',
)
eq(reorderForRoles(['deepseek-v4-pro', 'deepseek-v4-flash']), ['deepseek-v4-pro', 'deepseek-v4-flash'], 'T1.2 已有序稳定')
eq(reorderForRoles(['xxx-vision-exp']), [], 'T1.3 全多模态 → 空')
eq(
  reorderForRoles(['kimi-latest', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k']),
  ['moonshot-v1-128k', 'moonshot-v1-32k', 'kimi-latest', 'moonshot-v1-8k'],
  'T1.4 Moonshot 命名 → strong 前置',
)
eq(reorderForRoles([]), [], 'T1.5 空 → 空')

console.log('presetModels (T2)')
eq(
  presetModels({ models: [] }),
  { llm_model: '', llm_model_core: '', llm_model_aux: '', llm_model_fast: '' },
  'T2.1 0 模型 → 全空',
)
eq(
  presetModels({ models: ['m1'] }),
  { llm_model: 'm1', llm_model_core: 'm1', llm_model_aux: 'm1', llm_model_fast: 'm1' },
  'T2.2 1 模型 → 全同',
)
eq(
  presetModels({ models: ['a', 'b', 'c', 'd', 'e'] }),
  { llm_model: 'a', llm_model_core: 'a', llm_model_aux: 'b', llm_model_fast: 'e' },
  'T2.3 ≥2 → core=M[0]/aux=M[1]/fast=M[末]',
)

console.log('dedupe')
eq(dedupe(['a', 'b', 'a', 'c', 'b']), ['a', 'b', 'c'], '保序去重')

console.log('resolveRecommended (T3 · P1-② 守卫)')
eq(
  resolveRecommended(deepseek, 'deepseek', ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']),
  ['deepseek-v4-pro', 'deepseek-v4-flash'],
  'T3.1 curated 有效 → 沿用 curated（不重排）',
)
eq(
  resolveRecommended(
    { id: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] },
    'deepseek',
    ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'],
  ),
  ['deepseek-v4-pro', 'deepseek-v4-flash'],
  'T3.2 curated 过期 → 回退 reorderForRoles',
)
eq(
  resolveRecommended(deepseek, 'moonshot', ['deepseek-v4-pro', 'deepseek-v4-flash']),
  ['deepseek-v4-pro', 'deepseek-v4-flash'],
  'T3.3 草稿≠已保存 → 不并入 live',
)
eq(resolveRecommended(deepseek, 'deepseek', []), ['deepseek-v4-pro', 'deepseek-v4-flash'], 'T3.4 live 空 → curated')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
