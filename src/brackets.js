import data from './data/bidiBrackets.data.js'

let openToClose, closeToOpen, canonical
const radix = 36

function parse () {
  if (!openToClose) {
    function parseString (string, includeReverse) {
      let lastCode = 0
      const map = new Map()
      const reverseMap = includeReverse && new Map()
      string.split(',').forEach(pair => {
        let [a, b] = pair.split('>')
        a = String.fromCodePoint(lastCode += parseInt(a, radix))
        b = String.fromCodePoint(lastCode += parseInt(b, radix))
        map.set(a, b)
        includeReverse && reverseMap.set(b, a)
      })
      return { map, reverseMap }
    }

    let { map, reverseMap } = parseString(data.pairs, true)
    openToClose = map
    closeToOpen = reverseMap
    canonical = parseString(data.canonical, false).map
  }
}

export function openingToClosingBracket (ch) {
  parse()
  return openToClose.get(ch) || null
}

export function closingToOpeningBracket (ch) {
  parse()
  return closeToOpen.get(ch) || null
}

export function getCanonicalBracket (ch) {
  parse()
  return canonical.get(ch) || null
}
