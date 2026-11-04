// ESLint 9 settings (2026-11-04). Same rules as the old .eslintrc.json: Next.js "core-web-vitals",
// loaded through FlatCompat because eslint-config-next 15 still ships the old config format.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-e2e/**',
      'test-results/**',
      'playwright-report/**',
      '_BACKUP/**',
      '_CLEAN/**',
      'coverage/**',
      'dist/**',
      'build/**',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
  // ESLint 8 did not report unused eslint-disable comments; keep it that way.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
];

export default config;
