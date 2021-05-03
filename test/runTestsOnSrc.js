import { runBidiTest } from './BidiTest.js'
import { runBidiCharacterTest } from './BidiCharacterTest.js'

import * as bidiFromSrc from '../src/index.js'

console.log('Running test suite on src files...')

const results = [
  runBidiTest(bidiFromSrc),
  runBidiCharacterTest(bidiFromSrc)
]

process.exit(Math.max(...results))
