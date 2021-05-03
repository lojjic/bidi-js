const { runBidiTest } = require('./BidiTest.js')
const { runBidiCharacterTest } = require('./BidiCharacterTest.js')

const { transformFileSync } = require("@babel/core")
const requireFromString = require('require-from-string')

/*
 This runs the built dist file through Babel with preset-env for ES5 support,
 and runs the test suite on the result, to verify that Babel is not injecting calls to
 external polyfills or other helper functions, which would break the factory
 function's ability to be stringified and rehydrated in a worker.

 Assumes `npm run build` has been executed and files in dist/ are up to date.
*/
const { code } = transformFileSync('dist/bidi.js', {
  presets: ['@babel/preset-env'] //ES5 by default
})
const bidiFactory = requireFromString(code, 'babelified-bidi.js')
const bidi = bidiFactory()

console.log('Running test suite on build file...')
const results = [
  runBidiTest(bidi),
  runBidiCharacterTest(bidi)
]

process.exit(Math.max(...results))



