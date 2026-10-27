import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the local FastAPI (override with API_PROXY_TARGET, e.g. when 8080 is taken).
// In prod, Firebase Hosting rewrites /api/** to Cloud Run.
const apiTarget = process.env.API_PROXY_TARGET || "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": apiTarget } },
});
