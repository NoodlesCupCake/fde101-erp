import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.ERP_API ?? "http://127.0.0.1:8010";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // /api is proxied so the session cookie stays same-origin
  server: { port: 5180, proxy: { "/api": API } },
});
