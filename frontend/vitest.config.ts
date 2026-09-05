// 纯函数单测用 node 环境（无需 jsdom / React Testing Library）。
// 若后续补组件测试（T4），可在此切到 jsdom 并加 @testing-library/react。
// 用纯对象导出（不 import vitest/config），保证「项目内 npm test」与
// 「隔离 workspace 跑」两种场景都能加载，避免 ESM 解析依赖 vitest 安装位置。
export default {
  // 组件测试通过 @vitest-environment jsdom 逐文件切换；
  // 全局默认仍用 node 跑纯函数单测（modelResolution 等）。
  // 组件测试依赖 @testing-library/react + jsdom（见 clarifyAsync.test.tsx 头注释），
  // 安装后 frontend 内为单一 react 实例，无需额外 alias 配置。
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
}
