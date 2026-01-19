import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rawBasePath = process.env.VITE_BASE_PATH || "/";
const normalizedBasePath = rawBasePath.startsWith("/")
  ? rawBasePath
  : `/${rawBasePath}`;
const basePath = normalizedBasePath.endsWith("/")
  ? normalizedBasePath
  : `${normalizedBasePath}/`;

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000"
    }
  }
});
