import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig(environment => mergeConfig(viteConfig(environment), {
  test: { exclude: [...configDefaults.exclude, "packages/plugin-sdk/**"] },
}));
