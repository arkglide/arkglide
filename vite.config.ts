import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ArkGlide - Vite 构建配置
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['monaco-editor', 'monaco-editor/language/typescript/ts.worker'] },
  server: {
    port: 5173,
    open: true,
  },
});