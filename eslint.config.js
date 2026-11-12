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
  // Tokens only (polish Phase 1.6): in the new UI layer, colours and sizes come from
  // src/ui/tokens.css via var(--…). The list of covered files grows as each screen is
  // rebuilt from primitives (add its path here).
  {
    files: ["src/ui/**/*.{js,jsx}"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "No raw colours here: use a token, e.g. \"var(--action)\"." },
        { selector: "Property[key.name=/^(fontSize|lineHeight|fontWeight|borderRadius|gap|width|height|minHeight|minWidth|top|right|bottom|left|padding|margin)(Top|Right|Bottom|Left|Inline|Block)?$/] > Literal[raw=/^-?[0-9]/]",
          message: "No raw sizes here: use a token, e.g. \"var(--space-3)\"." },
        { selector: "Property[key.name=/^(fontSize|lineHeight|borderRadius|gap|width|height|minHeight|minWidth|top|right|bottom|left|padding|margin)(Top|Right|Bottom|Left|Inline|Block)?$/] > Literal[value=/[0-9](px|rem|em)/]",
          message: "No raw sizes here: use a token, e.g. \"var(--space-3)\"." },
      ],
    },
  },
];
