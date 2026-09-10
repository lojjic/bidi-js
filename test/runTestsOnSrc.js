import * as bidiFactory from '../src/index.js'
const { runBidiCharacterTest } = require('./BidiCharacterTest.js')
const { runBidiMultibyteCharacterTest } = require('./BidiMultibyteCharacterTest.js')
const { runBidiTest } = require('./BidiTest.js')

console.log('Running test suite on src files...')

const bidi = bidiFactory
let failures = 0
const bidiInstance = bidiFactory.getEmbeddingLevels ? bidiFactory : bidiFactory()

failures += runBidiTest(bidiInstance)
failures += runBidiCharacterTest(bidiInstance)
failures += runBidiMultibyteCharacterTest(bidiInstance)

process.exit(failures)
