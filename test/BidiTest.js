const { readFileSync } = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')

module.exports.runBidiTest = function (bidi) {
  const text = readFileSync(path.join(__dirname, './BidiTest.txt'), 'utf-8')
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
  let expectedOrder

  let testCount = 0
  let passCount = 0
  let failCount = 0
  let totalTime = 0

  lines.forEach((line, lineIdx) => {
    if (line && !line.startsWith('#')) {
      let match = line.match(/^@(Levels|Reorder):\s*(.*)$/)
      if (match) {
        const values = match[2].trim() ? match[2].trim().split(/\s+/).map(s => s === 'x' ? s : parseInt(s, 10)) : []
        if (match[1] === 'Levels') {
          expectedLevels = values
        } else if (match[1] === 'Reorder') {
          expectedOrder = values
        }
        return
      }

      let [types, paraDirs] = line.split(/\s*;\s*/)

      types = types.trim().split(/\s+/)
      const inputString = types.map(type => CLASS_REPS[type]).join('')

      paraDirs = parseInt(paraDirs.trim(), 10)
      paraDirs = paraDirBits.filter((dirString, i) => paraDirs & (1 << i))

      for (let paraDir of paraDirs) {
        if (testFilter && testFilter(lineIdx + 1, paraDir) === false) continue

        const start = performance.now()
        const embedLevelsResult = bidi.getEmbeddingLevels(inputString, paraDir)
        const {levels, paragraphs} = embedLevelsResult
        let reordered = bidi.getReorderedIndices(inputString, embedLevelsResult)
        totalTime += performance.now() - start
        reordered = reordered.filter(i => expectedLevels[i] !== 'x') //those with indeterminate level are ommitted

        let ok = expectedLevels.length === levels.length && paragraphs.length === 1
        if (ok) {
          for (let i = 0; i < expectedLevels.length; i++) {
            if (expectedLevels[i] !== 'x' && expectedLevels[i] !== levels[i]) {
              ok = false
              break
            }
          }
        }
        if (ok) {
          for (let i = 0; i < reordered.length; i++) {
            if (reordered[i] !== expectedOrder[i]) {
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
            console.error(`Test on line ${lineIdx + 1}, direction "${paraDir}":
  Input Types:     ${mapToColumns(types, 5)}
  Expected levels: ${mapToColumns(expectedLevels, 5)}
  Received levels: ${mapToColumns(levels, 5)}
  Expected order:  ${mapToColumns(expectedOrder, 3)}
  Received order:  ${mapToColumns(reordered, 3)}`)
          }
        }
      }
    }
  })

  let message = `Bidi Tests: ${testCount} total, ${passCount} passed, ${failCount} failed`
  if (failCount >= BAIL_COUNT) {
    message += ` (only first ${BAIL_COUNT} failures shown)`
  }
  message += `\n    ${totalTime.toFixed(4)}ms total, ${(totalTime / testCount).toFixed(4)}ms average`

  console.log(message)

  return failCount ? 1 : 0
}

function mapToColumns (values, colSize) {
  return [...values].map(v => `${v}`.padEnd(colSize)).join('')
}
