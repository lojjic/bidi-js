import { calculateBidiEmbeddingLevels } from '../src/bidi.js'
import { getBidiCharType, TYPES_TO_NAMES } from '../src/bidiCharTypes.js'
import { readFileSync } from 'fs'

export function runBidiCharacterTest() {
  const text = readFileSync(new URL('./BidiCharacterTest.txt', import.meta.url), 'utf-8');
  const lines = text.split('\n')

  const BAIL_COUNT = 10

  let testFilter = null
  // testFilter = (lineNum, dir) => lineNum === 65 && dir === 'auto'

  let testCount = 0
  let passCount = 0
  let failCount = 0

  lines.forEach((line, lineIdx) => {
    if (line && !line.startsWith('#')) {
      let [input, paraDir, , expectedLevels] = line.split(';')

      const inputOrig = input
      input = input.split(' ').map(d => String.fromCodePoint(parseInt(d, 16))).join('')
      paraDir = paraDir === '0' ? 'ltr' : paraDir === '1' ? 'rtl' : 'auto'

      if (testFilter && testFilter(lineIdx + 1, paraDir) === false) return

      expectedLevels = expectedLevels.split(' ').map(s => s === 'x' ? s : parseInt(s, 10))

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
        if (++failCount <= BAIL_COUNT) {
          const types = input.split('').map(ch => TYPES_TO_NAMES[getBidiCharType(ch)])
          console.error(`Test on line ${lineIdx + 1}, direction "${paraDir}":
  Input:    ${inputOrig}
  Types:    ${mapToColumns(types, 5)}
  Expected: ${mapToColumns(expectedLevels, 5)}
  Received: ${mapToColumns(levels, 5)}`)
          //  Chars:    ${mapToColumns(input.split(''), 5)}
        }
      }

    }
  })

  let message = `Bidi Character Tests: ${testCount} total, ${passCount} passed, ${failCount} failed`
  if (failCount >= BAIL_COUNT) {
    message += ` (only first ${BAIL_COUNT} failures shown)`
  }

  console.log(message)

  return failCount ? 1 : 0
}

function mapToColumns(values, colSize) {
  return values.map(v => `${v}`.padEnd(colSize)).join('')
}
