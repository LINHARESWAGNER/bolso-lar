import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    viteReact(),
  ],
  server: {
    host: "::",
    port: 8080,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
