import { delimiter, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve('src/app/renderer') } },
  define: {
    __FILE_ICONS_DIR__: JSON.stringify(
      resolve('node_modules/material-icon-theme/icons').replaceAll('\\', '/'),
    ),
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    // 限制并发，避免慢用例在满载时超过默认 5s 超时。
    maxWorkers: 4,
    setupFiles: ['test/core/host-mock.ts'],
    // 单元测试不启动 Electron，也需能找到应用随包分发的搜索工具。
    env: {
      PATH: [
        resolve('vendor/bin', process.platform === 'darwin' ? `darwin-${process.arch}` : ''),
        process.env.PATH ?? '',
      ].join(delimiter),
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '.tools/**',
      '**/*.remote.test.ts',
    ],
  },
});
