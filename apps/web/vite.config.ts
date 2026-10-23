import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.API_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: api, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: api, changeOrigin: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
});
