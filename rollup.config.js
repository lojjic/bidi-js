import { terser } from 'rollup-plugin-terser'

const banner = `export default function bidi() {`
const footer = `return bidi}`

export default {
  input: 'src/index.js',
  output: [
    {
      file: 'dist/bidi.js',
      format: 'iife',
      name: 'bidi',
      sourcemap: true,
      banner,
      footer
    },
    {
      file: 'dist/bidi.min.js',
      format: 'iife',
      name: 'bidi',
      sourcemap: true,
      banner,
      footer,
      plugins: [
        terser({
          ecma: 5,
          mangle: {properties: {regex: /^_/}}
        })
      ]
    }
  ]
}
