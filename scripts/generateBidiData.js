import fetch from 'node-fetch'
import { writeFileSync } from 'fs'

const radix = 36

/**
 * Generate data file containing all bidi character types.
 *
 * The format is an object whose keys are the bidi character classes (omitting the default "L"),
 * and its values are a comma-delimited string defining all the codepoint ranges in that class. Each
 * range is either a single codepoint or start+end codepoints separated by "+". Every codepoint is
 * stored as a base36-encoded relative offset from the previous codepoint.
 */
async function generateBidiCharTypesData() {
  const response = await fetch('https://www.unicode.org/Public/13.0.0/ucd/extracted/DerivedBidiClass.txt')
  const txt = await response.text()
  const classMap = new Map()
  txt.split('\n').forEach(line => {
    line.trim()
    if (!line || line.startsWith('#')) return
    const match = line.match(/^([A-Z0-9.]+)\s*;\s([\w]+)*/)
    if (match) {
      const cls = match[2]
      if (cls !== 'L') { // L is the default so omit it
        let codePoints = match[1].split('..').map(c => parseInt(c, 16))
        let ranges = classMap.get(cls)
        if (!ranges) {
          classMap.set(cls, ranges = [])
        }
        ranges.push(codePoints)
      }
    }
  })

  const out = {}
  classMap.forEach((ranges, cls) => {
    let lastCode = 0
    ranges.sort((a, b) => a[0] - b[0])

    // Map absolute ranges to relative skip/step increments
    ranges = ranges.map(([from, to]) => {
      const skip = from - lastCode
      const step = to - from
      lastCode = to || from
      return [skip, step]
    })

    // Collapse ranges that were adjacent in the data
    for (let i = 0; i < ranges.length - 1; i++) {
      while (ranges[i + 1] && ranges[i + 1][0] === 1) {
        ranges[i][1] = (ranges[i][1] || 0) + 1 + (ranges[i + 1][1] || 0)
        ranges.splice(i + 1, 1)
      }
    }

    // Stringify
    ranges = ranges.map(([skip, step]) => {
      return `${skip.toString(radix)}${step ? '+' + step.toString(radix) : ''}`
    })

    out[cls] = ranges.join(',')
  })

  const fileContent = `// Bidi character types data, auto generated
export default ${JSON.stringify(out, null, 2)}
`
  const filePath = new URL('../src/data/bidiCharTypes.data.js', import.meta.url)
  writeFileSync(filePath, fileContent)

  console.log(`Wrote file ${filePath}, size ${fileContent.length}`)
}

/**
 * Generate data file containing all bidi bracket pairs and canonical mappings. It is an object
 * with keys "pairs" and "canonical", each holding a string value
 *
 * The string format is a comma-delimited string defining a set of pairs. Each pair contains two
 * codepoints separated by ">"; these are the opening and closing brackets for pairs and the
 * non-canonical and canonical characters for canonical. Every codepoint is stored as a
 * base36-encoded relative offset from the previous codepoint.
 */
async function generateBracketsData() {
  // Build Map of opening to closing bracket codepoints
  let response = await fetch('https://www.unicode.org/Public/13.0.0/ucd/BidiBrackets.txt')
  let txt = await response.text()
  let pairs = new Map()
  let reversePairs = new Map()
  txt.split('\n').forEach(line => {
    line.trim()
    if (!line || line.startsWith('#')) return
    const match = line.match(/^([A-Z0-9.]+)\s*;\s*([A-Z0-9.]+)\s*;\s*o/)
    if (match) {
      const opener = parseInt(match[1], 16)
      const closer = parseInt(match[2], 16)
      pairs.set(opener, closer)
      reversePairs.set(closer, opener)
    }
  })

  // Get canonical equivs for each closing bracket
  response = await fetch('https://www.unicode.org/Public/UCD/latest/ucd/UnicodeData.txt')
  txt = await response.text()
  const canonical = new Map()
  txt.split('\n').forEach(line => {
    if (!line || line.startsWith('#')) return
    const fields = line.split(';')
    const nonCanon = parseInt(fields[0], 16)
    const canon = fields[5] && fields[5].replace(/^<[^>]+>\s*/, '')
    if (canon && (pairs.has(nonCanon) || reversePairs.has(nonCanon))) {
      canonical.set(
        nonCanon,
        parseInt(canon, 16)
      )
    }
  })

  // Encode to strings
  function encodeCodePointsMap(map) {
    let lastCode = 0
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([a, b]) => {
      const str = `${(a - lastCode).toString(radix)}>${(b - a).toString(radix)}`
      lastCode = b
      return str
    }).join(',')
  }
  const out = {
    pairs: encodeCodePointsMap(pairs),
    canonical: encodeCodePointsMap(canonical)
  }

  const fileContent = `// Bidi bracket pairs data, auto generated
export default ${JSON.stringify(out, null, 2)}
`
  const filePath = new URL('../src/data/bidiBrackets.data.js', import.meta.url)
  writeFileSync(filePath, fileContent)

  console.log(`Wrote file ${filePath}, size ${fileContent.length}`)
}


generateBidiCharTypesData()
generateBracketsData()
