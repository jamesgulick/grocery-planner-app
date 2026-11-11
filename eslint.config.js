// Dev-only safety net (never shipped). It checks the two runtime error classes
// that `vite build` lets through: a name used where it isn't in scope
// (no-undef, react/jsx-no-undef) and a const/let read before its declaration
// runs (no-use-before-define → "Cannot access 'X' before initialization").
// Style is deliberately not linted.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  { ignores: ["dist/**", "node_modules/**", "engine/**"] },
  {
    files: ["src/**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      // variables:false = a closure (effect body, handler) may read a later
      // const, which is safe; a read in the same scope before the line is not.
      "no-use-before-define": ["error", { functions: false, classes: false, variables: false }],
    },
  },
];
