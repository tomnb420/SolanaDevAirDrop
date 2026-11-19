import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 explicitly; Node's default "localhost" may resolve to ::1 only.
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    open: true,
    proxy: {
      "/api": "http://127.0.0.1:4100",
    },
  },
});
