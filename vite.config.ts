import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ArkGlide - Vite 构建配置
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Workers are outside Vite's initial HTML crawl. Discover their build-time
    // dependencies up front so the first export cannot trigger a full reload.
    entries: ["index.html"],
    include: [
      "monaco-editor",
      "monaco-editor/language/typescript/ts.worker",
      "fflate",
      "terser",
    ],
  },
  server: {
    port: 5173,
    open: true,
  },
});
