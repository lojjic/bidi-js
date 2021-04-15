import { getBidiCharType, TRAILING_TYPES } from './charTypes.js'

/**
 * Given a start and end denoting a single line within a string, and a set of precalculated
 * bidi embedding levels, produce a list of segments whose ordering should be flipped, in sequence.
 * @param {string} string - the full input string
 * @param {Uint8Array} embedLevels - the `levels` result from calling getEmbeddingLevels on the full string
 * @param {number} start - first character in the segment being reordered
 * @param {number} end - last character in the segment being reordered
 * @param {number} paragraphLevel - the paragraph level, this can be found in `paragraphs` from calling getEmbeddingLevels
 * @return {Array<[start, end]>} - the list of start/end segments that should be flipped, in order.
 */
export function getReorderSegments(string, embedLevels, start, end, paragraphLevel) {
  // Local slice for mutation
  const lineLevels = embedLevels.slice(start, end + 1)

  // 3.4 L1.4: Reset any sequence of whitespace characters and/or isolate formatting characters at the
  // end of the line to the paragraph level.
  for (let i = end; i >= start && (getBidiCharType(string[i]) & TRAILING_TYPES); i--) {
    lineLevels[i - start] = paragraphLevel
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
        if (i > segStart) {
          segments.push([segStart + start, i + start])
        }
      }
    }
  }
  return segments
}

/**
 * @param {string} string
 * @param {Uint8Array} embedLevels
 * @param {number} start
 * @param {number} end
 * @param {number} paragraphLevel
 * @return {string} the new string with bidi segments reordered
 */
export function getReorderedString(string, embedLevels, start, end, paragraphLevel) {
  const indices = getReorderedIndices(string, embedLevels, start, end, paragraphLevel)
  const chars = []
  indices.forEach((charIndex, i) => {
    chars[i] = string[charIndex]
  })
  return chars.join('')
}

/**
 * @param {string} string
 * @param {Uint8Array} embedLevels
 * @param {number} start
 * @param {number} end
 * @param {number} paragraphLevel
 * @return {number[]} an array with character indices in their new bidi order
 */
export function getReorderedIndices(string, embedLevels, start, end, paragraphLevel) {
  const segments = getReorderSegments(string, embedLevels, start, end, paragraphLevel)
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
