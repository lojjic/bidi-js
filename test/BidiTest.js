import { calculateBidiEmbeddingLevels } from '../src/bidi.js'
import { readFileSync } from 'fs'

export function runBidiTest() {
  const text = readFileSync(new URL('./BidiTest.txt', import.meta.url), 'utf-8');
  let lines = text.split('\n')

  const BAIL_COUNT = 10

  let testFilter = null
  // testFilter = (lineNum, dir) => lineNum === 7187 && dir === 'ltr'

  const paraDirBits = ['auto', 'ltr', 'rtl']

  const CLASS_REPS = {
    L: '\u0041',
    R: '\u05D0',
    EN: '\u0030',
    ES: '\u002B',
    ET: '\u0023',
    AN: '\u0660',
    CS: '\u002C',
    B: '\u2029',
    S: '\u0009',
    WS: '\u0020',
    ON: '\u0021',
    BN: '\u00AD',
    NSM: '\u036F',
    AL: '\u06D5',
    LRO: '\u202D',
    RLO: '\u202E',
    LRE: '\u202A',
    RLE: '\u202B',
    PDF: '\u202C',
    LRI: '\u2066',
    RLI: '\u2067',
    FSI: '\u2068',
    PDI: '\u2069'
  }

  let expectedLevels

  let testCount = 0
  let passCount = 0
  let failCount = 0

  lines.forEach((line, lineIdx) => {
    if (line && !line.startsWith('#')) {
      let match = line.match(/^@(Levels|Reorder):\s*(.*)$/)
      if (match) {
        if (match[1] === 'Levels') {
          expectedLevels = match[2].trim().split(/\s+/).map(s => s === 'x' ? s : parseInt(s, 10))
        }
        return
      }

      let [input, paraDirs] = line.split(/\s*;\s*/)

      const inputStr = input
      input = input.trim().split(/\s+/)
        .map(type => CLASS_REPS[type])
        .join('')

      paraDirs = parseInt(paraDirs.trim(), 10)
      paraDirs = paraDirBits.filter((dirString, i) => paraDirs & (1 << i))

      for (let paraDir of paraDirs) {
        if (testFilter && testFilter(lineIdx + 1, paraDir) === false) continue

        const levels = [...calculateBidiEmbeddingLevels(input, paraDir)]

        // Replace 'x' placeholders for indeterminate levels so they don't trigger failures
        let ok = expectedLevels.length === levels.length
        if (ok) {
          for (let i = 0; i < expectedLevels.length; i++) {
            if (expectedLevels[i] !== 'x' && expectedLevels[i] !== levels[i]) {
              ok = false
              break
            }
          }
        }

        testCount++
        if (ok) {
          passCount++
        } else {
          if (failCount++ <= BAIL_COUNT) {
            const msg = `Expected ${expectedLevels.join(' ')}, got ${levels.join(' ')}`
            console.error(`Line ${lineIdx + 1}, input [${inputStr}], dir "${paraDir}": ${msg}`)
          }
        }
      }

    }
  })

  let message = `Bidi Tests: ${testCount} total, ${passCount} passed, ${failCount} failed`
  if (failCount >= BAIL_COUNT) {
    message += ` (only first ${BAIL_COUNT} failures shown)`
  }

  console.log(message)

  return failCount ? 1 : 0
}
