const { readFileSync } = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')

// Helper function to format output (copied from BidiCharacterTest.js)
function mapToColumns (values, colSize) {
  return [...values].map(v => `${v}`.padEnd(colSize)).join('')
}

// Main test runner function for multibyte characters
module.exports.runBidiMultibyteCharacterTest = function (bidi) {
  const testFileName = './BidiMultibyteCharacterTest.txt'
  console.log(`\nRunning Bidi Multibyte Character Tests from ${testFileName}...`)

  const text = readFileSync(path.join(__dirname, testFileName), 'utf-8')
  const lines = text.split('\n')

  const BAIL_COUNT = 10
  let testCount = 0
  let passCount = 0
  let failCount = 0
  let totalTime = 0

  lines.forEach((line, lineIdx) => {
    line = line.trim()
    if (line && !line.startsWith('#')) {
      let [inputCodes, paraDirCode, , expectedLevelsStr, expectedOrderStr] = line.split(';')

      // Trim potential whitespace
      inputCodes = inputCodes.trim()
      paraDirCode = paraDirCode.trim()
      expectedLevelsStr = expectedLevelsStr.trim()
      expectedOrderStr = expectedOrderStr.trim()

      const inputString = inputCodes.split(' ').map(d => String.fromCodePoint(parseInt(d, 16))).join('')
      const paraDir = paraDirCode === '0' ? 'ltr' : paraDirCode === '1' ? 'rtl' : 'auto'
      let expectedLevels = expectedLevelsStr.split(' ').map(s => s === 'x' ? 'x' : parseInt(s, 10))
      let expectedOrder = expectedOrderStr.split(' ').map(s => parseInt(s, 10))

      const start = performance.now()
      const embedLevelsResult = bidi.getEmbeddingLevels(inputString, paraDir)
      const { levels, paragraphs } = embedLevelsResult
      let reordered = bidi.getReorderedIndices(inputString, embedLevelsResult)
      totalTime += performance.now() - start

      // Filter out indices corresponding to characters with 'x' level, as per original test
      const filteredIndices = expectedLevels.map((lvl, idx) => lvl === 'x' ? -1 : idx).filter(idx => idx !== -1)
      reordered = reordered.filter(i => filteredIndices.includes(i));
      expectedOrder = expectedOrder.filter((_, idx) => expectedLevels[idx] !== 'x');
      expectedLevels = expectedLevels.filter(lvl => lvl !== 'x');

      // Perform checks
      let levelsOk = expectedLevels.length === levels.length;
      if (levelsOk) {
        for (let i = 0; i < expectedLevels.length; i++) {
          if (expectedLevels[i] !== levels[i]) {
            levelsOk = false
            break
          }
        }
      }

      let orderOk = expectedOrder.length === reordered.length;
      if (orderOk) {
        for (let i = 0; i < reordered.length; i++) {
          // Adjust index mapping for comparison: UAX#9 order refers to original codepoint indices
          const originalIndex = inputString.length > i ? inputString.slice(0, i + 1).length - 1 : i; // Approximate original index
          if (reordered[i] !== expectedOrder[i]) { 
            orderOk = false;
            break;
          }
        }
      }
      
      // Check paragraph structure (assuming single paragraph for these tests)
      const paragraphsOk = paragraphs.length === 1;

      const ok = levelsOk && orderOk && paragraphsOk;

      testCount++
      if (ok) {
        passCount++
      } else {
        if (++failCount <= BAIL_COUNT) {
          const types = Array.from(inputString).map(ch => bidi.getBidiCharTypeName(ch)) // Use Array.from for code points
          console.error(`Multibyte test on line ${lineIdx + 1} FAILED, direction "${paraDir}":
  Input codes:     ${inputCodes}
  Input string:    ${inputString}
  Input Types:     ${mapToColumns(types, 5)}
  Expected levels: ${mapToColumns(expectedLevels, 5)} (Length: ${expectedLevels.length})
  Received levels: ${mapToColumns(levels, 5)} (Length: ${levels.length}) -> ${levelsOk ? 'OK' : 'FAIL'}
  Expected order:  ${mapToColumns(expectedOrder, 4)} (Length: ${expectedOrder.length})
  Received order:  ${mapToColumns(reordered, 4)} (Length: ${reordered.length}) -> ${orderOk ? 'OK' : 'FAIL'}
  Paragraphs:      ${paragraphs.length} -> ${paragraphsOk ? 'OK' : 'FAIL'}`)
        }
      }
    }
  })

  let message = `Bidi Multibyte Character Tests: ${testCount} total, ${passCount} passed, ${failCount} failed`
  if (failCount >= BAIL_COUNT) {
    message += ` (only first ${BAIL_COUNT} failures shown)`
  }
  message += `\n    ${totalTime.toFixed(4)}ms total, ${(totalTime / testCount).toFixed(4)}ms average`

  console.log(message)

  return failCount ? 1 : 0
} 