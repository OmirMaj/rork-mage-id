const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
    rules: {
      // Stylistic rule that flags literal `'` / `"` inside JSX text. We
      // chose readability over compliance — copy like "Don't worry" reads
      // better than "Don&apos;t worry" in source. Rule was producing 87
      // "errors" with zero runtime impact and blocking lint exit-0.
      "react/no-unescaped-entities": "off",

      // ─── Design-system discipline ─────────────────────────────────────
      // The audit found 23 distinct fontSize values, 30+ borderRadius
      // values, and ~20 status-color hex literals scattered across the
      // codebase. Premium SaaS apps in 2026 ship 6-8 fontSizes / 5 radii
      // / 3 shadow tiers TOTAL. These rules surface offenses as warnings
      // (not errors) so we don't block CI, but every new edit shows up
      // red in the editor — which forces new code through the tokens.
      //
      // Migration path:
      //   - inline `fontSize: 14` → `...Type.body` from constants/typography.ts
      //   - inline `borderRadius: 12` → `Tokens.radius.lg` from constants/designTokens.ts
      //   - inline `color: '#34C759'` → `Colors.success` from constants/colors.ts
      //
      // To allow a one-off intentional literal, add:
      //   // eslint-disable-next-line no-restricted-syntax
      // Production hygiene — strip stray console.log from new code.
      // Audit found 131 in the codebase; existing ones aren't blocked,
      // but new ones surface as warnings so we don't ship debug noise.
      // Use `console.warn` for genuine concerns (allowed); use
      // `if (__DEV__) console.log(...)` for dev-only diagnostics.
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],

      // Discourage new `as any` and `as never` type escape hatches.
      // Audit found 407 occurrences — TypeScript strict mode was being
      // bypassed silently. New code that needs an escape hatch must add
      // an `// eslint-disable-next-line` with a justifying comment so it
      // shows up in PR review.
      "@typescript-eslint/consistent-type-assertions": ["warn", {
        assertionStyle: "as",
        objectLiteralTypeAssertions: "allow-as-parameter",
      }],

      "no-restricted-syntax": ["warn",
        {
          selector: "TSAsExpression > TSAnyKeyword",
          message: "Avoid `as any`. Use a proper type, an `as unknown as X` two-step, or a typed escape hatch. If unavoidable, add `// eslint-disable-next-line` with a comment.",
        },
        {
          selector: "Property[key.name='fontSize'][value.type='Literal']",
          message: "Use Type.* from constants/typography.ts instead of an inline fontSize literal. Premium apps ship 6-8 sizes total.",
        },
        {
          selector: "Property[key.name='borderRadius'][value.type='Literal']",
          message: "Use Tokens.radius.* from constants/designTokens.ts instead of an inline borderRadius literal.",
        },
        {
          selector: "Property[key.name='color'][value.type='Literal'][value.value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "Use Colors.* from constants/colors.ts instead of a hex color literal (success/warning/error/info live as semantic tokens).",
        },
        {
          selector: "Property[key.name='backgroundColor'][value.type='Literal'][value.value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "Use Colors.* from constants/colors.ts instead of a hex color literal.",
        },
        {
          selector: "Property[key.name='borderColor'][value.type='Literal'][value.value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "Use Colors.* from constants/colors.ts instead of a hex color literal.",
        },
      ],
    },
  },
  // Token files themselves are exempt — they ARE the source of literals.
  {
    files: [
      "constants/colors.ts",
      "constants/typography.ts",
      "constants/designTokens.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);
