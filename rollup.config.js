import { terser } from 'rollup-plugin-terser'
import buble from '@rollup/plugin-buble'

export default [
  // First compile to an iife, and wrap the whole thing into an exported factory function.
  // This ensures all the code is self-contained within that one factory function.
  {
    input: 'src/index.js',
    output: {
      file: 'dist/bidi.js',
      format: 'iife',
      name: 'bidi',
      banner: `export default function bidiFactory() {`,
      footer: `return bidi}`
    },
    plugins: [
      // Transpile down to ES5 for all build artifacts. This helps ensure that downstream
      // transpilers won't inject references to external helpers/polyfills, which would
      // break its ability to be serialized to a web worker.
      buble()
    ]
  },
  // Then wrap that exported factory function as esm and umd
  {
    input: 'dist/bidi.js',
    output: [
      {
        file: 'dist/bidi.mjs',
        format: 'esm'
      },
      {
        file: 'dist/bidi.min.mjs',
        format: 'esm',
        plugins: [
          terser({
            ecma: 5,
            mangle: {properties: {regex: /^_/}}
          })
        ]
      },
      {
        file: 'dist/bidi.js',
        format: 'umd',
        name: 'bidi_js'
      },
      {
        file: 'dist/bidi.min.js',
        format: 'umd',
        name: 'bidi_js',
        plugins: [
          terser({
            ecma: 5,
            mangle: {properties: {regex: /^_/}}
          })
        ]
      }
    ]
  }
]
