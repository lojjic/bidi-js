import { getBidiCharType, TRAILING_TYPES } from './charTypes.js'

/**
 * Given a start and end denoting a single line within a string, and a set of precalculated
 * bidi embedding levels, produce a list of segments whose ordering should be flipped, in sequence.
 * @param {string} string
 * @param {Uint8Array} embedLevels
 * @param {number} lineStart
 * @param {number} lineEnd
 * @param {number} paragraphLevel
 */
export function getReorderSegments(string, embedLevels, lineStart, lineEnd, paragraphLevel) {
  // Local slice for mutation
  const lineLevels = embedLevels.slice(lineStart, lineEnd + 1)

  // 3.4 L1.4: Reset any sequence of whitespace characters and/or isolate formatting characters at the
  // end of the line to the paragraph level.
  for (let i = lineEnd; i >= lineStart && (getBidiCharType(string[i]) & TRAILING_TYPES); i--) {
    lineLevels[i - lineStart] = paragraphLevel
  }

  // L2. From the highest level found in the text to the lowest odd level on each line, including intermediate levels
  // not actually present in the text, reverse any contiguous sequence of characters that are at that level or higher.
  let maxLevel = paragraphLevel
  let minOddLevel = Infinity
  for (let i = 0; i < lineLevels.length; i++) {
    const level = lineLevels[i]
    if (level > maxLevel) maxLevel = level
    if (level < minOddLevel) minOddLevel = level | 1
  }
  const segments = []
  for (let lvl = maxLevel; lvl >= minOddLevel; lvl--) {
    for (let i = 0; i < lineLevels.length; i++) {
      if (lineLevels[i] >= lvl) {
        const segStart = i
        while (i + 1 < lineLevels.length && lineLevels[i + 1] >= lvl) {
          i++
        }
        segments.push([segStart + lineStart, i + lineStart])
      }
    }
  }
  return segments
}

/**
 * @param {string} string
 * @param {Uint8Array} embedLevels
 * @param {number} lineStart
 * @param {number} lineEnd
 * @param {number} paragraphLevel
 * @return {string} the new string with bidi segments reordered
 */
export function getReorderedString(string, embedLevels, lineStart, lineEnd, paragraphLevel) {
  const indices = getReorderedIndices(string, embedLevels, lineStart, lineEnd, paragraphLevel)
  const chars = []
  indices.forEach((charIndex, i) => {
    chars[i] = string[charIndex]
  })
  return chars.join('')
}

/**
 * @param {string} string
 * @param {Uint8Array} embedLevels
 * @param {number} lineStart
 * @param {number} lineEnd
 * @param {number} paragraphLevel
 * @return {number[]} an array with character indices in their new bidi order
 */
export function getReorderedIndices(string, embedLevels, lineStart, lineEnd, paragraphLevel) {
  const segments = getReorderSegments(string, embedLevels, lineStart, lineEnd, paragraphLevel)
  // Fill an array with indices
  const indices = []
  for (let i = 0; i < string.length; i++) {
    indices[i] = i
  }
  // Reverse each segment in order
  segments.forEach(([start, end]) => {
    const slice = indices.slice(start, end + 1)
    for (let i = slice.length; i--;) {
      indices[end - i] = slice[i]
    }
  })
  return indices
}
