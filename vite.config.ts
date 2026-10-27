import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  // Strip dev logging from production builds (keeps warn/error for real issues)
  esbuild: {
    pure: ["console.log", "console.debug", "console.info"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Keep shared runtime helpers out of optional heavy vendor chunks.
        // Otherwise an initial-page dependency can pull in all of PDF/charts.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@firebase") || id.includes("firebase")) return "firebase";
          if (id.includes("pdfjs-dist") || id.includes("jspdf") || id.includes("html2pdf")) return "pdf";
          if (id.includes("xlsx")) return "xlsx";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("katex")) return "katex";
          if (id.includes("@radix-ui")) return "radix";
        },
      },
    },
  },
});
