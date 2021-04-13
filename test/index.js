import { runBidiTest } from './BidiTest.js'
import { runBidiCharacterTest } from './BidiCharacterTest.js'

const results = [
  runBidiTest(),
  runBidiCharacterTest()
]

process.exit(Math.max(...results))
