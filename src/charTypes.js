import DATA from './data/bidiCharTypes.data.js'

const TYPES = {}
const TYPES_TO_NAMES = {}
TYPES.L = 1 //L is the default
TYPES_TO_NAMES[1] = 'L'
Object.keys(DATA).forEach((type, i) => {
  TYPES[type] = 1 << (i + 1)
  TYPES_TO_NAMES[TYPES[type]] = type
})
Object.freeze(TYPES)

const ISOLATE_INIT_TYPES = TYPES.LRI | TYPES.RLI | TYPES.FSI
const STRONG_TYPES = TYPES.L | TYPES.R | TYPES.AL
const NEUTRAL_ISOLATE_TYPES = TYPES.B | TYPES.S | TYPES.WS | TYPES.ON | TYPES.FSI | TYPES.LRI | TYPES.RLI | TYPES.PDI
const BN_LIKE_TYPES = TYPES.BN | TYPES.RLE | TYPES.LRE | TYPES.RLO | TYPES.LRO | TYPES.PDF
const TRAILING_TYPES = TYPES.S | TYPES.WS | TYPES.B | ISOLATE_INIT_TYPES | TYPES.PDI | BN_LIKE_TYPES

let map = null

function parseData () {
  if (!map) {
    map = new Map()
    for (let type in DATA) {
      if (DATA.hasOwnProperty(type)) {
        let lastCode = 0
        DATA[type].split(',').forEach(range => {
          let [skip, step] = range.split('+')
          skip = parseInt(skip, 36)
          step = step ? parseInt(step, 36) : 0
          map.set(String.fromCodePoint(lastCode += skip), TYPES[type])
          for (let i = 0; i < step; i++) {
            map.set(String.fromCodePoint(++lastCode), TYPES[type])
          }
        })
      }
    }
  }
}

/**
 * @param {string} char
 * @return {number}
 */
function getBidiCharType (char) {
  parseData()
  return map.get(char) || TYPES.L
}

export {
  getBidiCharType,
  TYPES,
  TYPES_TO_NAMES,
  ISOLATE_INIT_TYPES,
  STRONG_TYPES,
  NEUTRAL_ISOLATE_TYPES,
  BN_LIKE_TYPES,
  TRAILING_TYPES
}
