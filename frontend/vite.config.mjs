import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": {
        target: env.API_PROXY_TARGET || "http://localhost:8080",
        changeOrigin: true,
        // Dev only: lets a locally started backend (whose sign-in is overridden for tests) see a fixed test user.
        headers: env.API_PROXY_TEST_USER ? { "X-Test-User": env.API_PROXY_TEST_USER } : undefined,
      },
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
  };
});
