import { defineConfig } from 'tsup'

export default defineConfig([
  // ESM + CJS for npm consumers
  {
    entry: {
      index: 'src/index.ts',
      testing: 'src/testing.ts',
      // 构建预设（Node 环境，tsup 配置上下文用）
      build: 'src/build.ts',
      dev: 'src/dev.ts',
      // react-shim（浏览器，供构建预设 alias 进插件 bundle）
      'react-shim': 'src/react-shim.ts',
      // react/jsx-runtime 的 shim。**必须单独出一个产物** —— esbuild 的 alias 是
      // 前缀替换，靠 react-shim 兜不住这个子路径，详见该文件头部。
      'react-jsx-runtime-shim': 'src/react-jsx-runtime-shim.ts',
    },
    format: ['esm', 'cjs'],
    dts: { entry: { index: 'src/index.ts', testing: 'src/testing.ts', build: 'src/build.ts', dev: 'src/dev.ts' } },
    clean: true,
    sourcemap: true,
    shims: true,
    external: ['tsup'],
  },
  // UMD global for Helm plugin JS bundles (loaded via <script> tag)
  {
    entry: { 'index.umd': 'src/index.ts' },
    format: ['iife'],
    globalName: 'ModelSpherePluginSDK',
    outExtension: () => ({ js: '.js' }),
    minify: true,
  },
])
