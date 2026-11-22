import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import type { Rule } from 'eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const effectMessage =
  '禁止 useEffect/useLayoutEffect/useInsertionEffect（含别名、包装与解构）；订阅改用 useSyncExternalStore，命令式资源改用 ref 回调。';

const noComments: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow comments in TypeScript and JavaScript' },
    schema: [],
    messages: { unexpected: '注释已禁止：把意图写进命名与代码。' },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/^\s*@vitest-environment\b/.test(comment.value)) continue;
          context.report({ loc: comment.loc ?? undefined, messageId: 'unexpected' });
        }
      },
    };
  },
};

export default [
  {
    ignores: [
      'node_modules/',
      'out/',
      'dist/',
      'coverage/',
      '.tools/',
      'vendor/',
      '.build/',
      'assets/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        sourceType: 'module',
        babelOptions: {
          presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
        },
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/display-name': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['**/*.{ts,tsx,cjs}'],
    rules: {
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', 'scripts/**/*.{ts,cjs}'],
    plugins: { local: { rules: { 'no-comments': noComments } } },
    rules: { 'local/no-comments': 'error' },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportSpecifier[imported.name=/^use(Layout|Insertion)?Effect$/]',
          message: effectMessage,
        },
        {
          selector: 'ExportSpecifier[local.name=/^use(Layout|Insertion)?Effect$/]',
          message: effectMessage,
        },
        {
          selector: 'MemberExpression[property.name=/^use(Layout|Insertion)?Effect$/]',
          message: effectMessage,
        },
        {
          selector: 'MemberExpression[property.value=/^use(Layout|Insertion)?Effect$/]',
          message: effectMessage,
        },
        {
          selector:
            "Property[key.name=/^use(Layout|Insertion)?Effect$/][parent.type='ObjectPattern']",
          message: effectMessage,
        },
        {
          selector:
            "Property[key.value=/^use(Layout|Insertion)?Effect$/][parent.type='ObjectPattern']",
          message: effectMessage,
        },
        {
          selector: 'CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/]',
          message: effectMessage,
        },
        {
          selector: "MethodDefinition[key.name='getDerivedStateFromProps']",
          message: '禁止派生 state：在渲染中由 props 计算。',
        },
      ],
    },
  },
];
