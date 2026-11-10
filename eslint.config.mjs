import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // the android project holds a copy of the built app
    "android/**",
    // pieces of mowbite-art.js that scripts/build-art.mjs puts together, not modules of their own
    "scripts/art-runtime.js",
    "scripts/art-exports.js",
  ]),
]);

export default eslintConfig;
