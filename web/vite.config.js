import { defineConfig } from "vite";

// Production is served from https://plutodev1.github.io/ajobook/
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/ajobook/" : "/",
}));
