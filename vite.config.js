import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3001"
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        app: "app.html",
        report: "report.html"
      }
    }
  }
});
