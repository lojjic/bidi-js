import data from './data/bidiMirroring.data.js'
import { parseCharacterMap } from './util/parseCharacterMap.js'

let mirrorMap

function parse () {
  if (!mirrorMap) {
    //const start = performance.now()
    const { map, reverseMap } = parseCharacterMap(data, true)
    // Combine both maps into one
    reverseMap.forEach((value, key) => {
      map.set(key, value)
    })
    mirrorMap = map
    //console.log(`mirrored chars parsed in ${performance.now() - start}ms`)
  }
}

/**
 * Get the mirrored character for a given character, if one exists.
 * @param {string} char
 * @return {string|null}
 */
export function getMirroredCharacter (char) {
  parse()
  return mirrorMap.get(char) || null
}

/**
 * Given a string and its resolved embedding levels, build a map of indices to replacement chars
 * for any characters in right-to-left segments that have defined mirrored characters.
 * @param {string} string
 * @param {Uint8Array} embeddingLevels
 * @param {number?} [start]
 * @param {number?} [end]
 * @return {Map<number, string>}
 */
export function getMirroredCharactersMap(string, {levels: embeddingLevels}, start, end) {
  let strLen = string.length
  start = Math.max(0, start == null ? 0 : +start)
  end = Math.min(strLen - 1, end == null ? strLen - 1 : +end)

  const map = new Map()
  // Iterate by code unit index i
  for (let i = start; i <= end; /* i is advanced in loop */) {
    // Check level using code unit index i
    if (embeddingLevels[i] & 1) { //only odd (rtl) levels
      // Get character using code point
      const codePoint = string.codePointAt(i);
      const char = String.fromCodePoint(codePoint);
      const mirror = getMirroredCharacter(char) // Use full character
      if (mirror !== null) {
        map.set(i, mirror) // Map using code unit index i
      }
      // Advance index by character length (1 or 2)
      i += char.length;
    } else {
      // Level is not RTL, advance by 1 code unit
      i++;
    }
  }
  return map
}
