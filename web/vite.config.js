import { defineConfig } from "vite";

// Production is served from https://plutodev1.github.io/ajo_monad/
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/ajo_monad/" : "/",
}));
