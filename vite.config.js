import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` makes built asset paths relative, so the site works whether it's
// served from a user/organization Pages root (username.github.io) or a project
// subpath (username.github.io/repo-name/). No need to hardcode the repo name.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
  },
});
