import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // src/business/ 下业务组件的纯逻辑单测（SpecSelect / ImageSelect）也要跑 ——
    // 此前只收 test/，那几份从写下来就没进过 CI（2026-09-10 发现）
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    restoreMocks: true,
  },
})
