import { terser } from 'rollup-plugin-terser'

export default {
  input: 'src/bidi.js',
  output: [
    {
      file: 'dist/bidi.js',
      format: 'umd',
      name: 'bidi'
    },
    {
      file: 'dist/bidi.min.js',
      format: 'umd',
      name: 'bidi',
      plugins: [
        terser({
          ecma: 5,
          //mangle: { properties: true }
        })
      ]
    }
  ]
}
