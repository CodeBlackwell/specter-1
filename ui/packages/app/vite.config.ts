import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import compression from "vite-plugin-compression";

export default defineConfig({
  plugins: [
    react(),
    compression({ algorithm: "gzip", ext: ".gz", threshold: 1024 }),
    compression({ algorithm: "brotliCompress", ext: ".br", threshold: 1024 }),
  ],
  server: { port: 5180 },
});
