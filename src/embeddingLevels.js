import {
  BN_LIKE_TYPES,
  getBidiCharType,
  ISOLATE_INIT_TYPES,
  NEUTRAL_ISOLATE_TYPES,
  STRONG_TYPES,
  TRAILING_TYPES,
  TYPES
} from './charTypes.js'
import { closingToOpeningBracket, getCanonicalBracket, openingToClosingBracket } from './brackets.js'

// Local type aliases
const {
  L: TYPE_L,
  R: TYPE_R,
  EN: TYPE_EN,
  ES: TYPE_ES,
  ET: TYPE_ET,
  AN: TYPE_AN,
  CS: TYPE_CS,
  B: TYPE_B,
  S: TYPE_S,
  ON: TYPE_ON,
  BN: TYPE_BN,
  NSM: TYPE_NSM,
  AL: TYPE_AL,
  LRO: TYPE_LRO,
  RLO: TYPE_RLO,
  LRE: TYPE_LRE,
  RLE: TYPE_RLE,
  PDF: TYPE_PDF,
  LRI: TYPE_LRI,
  RLI: TYPE_RLI,
  FSI: TYPE_FSI,
  PDI: TYPE_PDI
} = TYPES

// Define specific types for L1 rule
const L1_RESET_TYPES = TYPES.WS | ISOLATE_INIT_TYPES | TYPES.PDI | TYPES.S | TYPES.B;

/**
 * @typedef {object} GetEmbeddingLevelsResult
 * @property {{start: number, end: number, level: number}[]} paragraphs
 * @property {Uint8Array} levels
 */

/**
 * This function applies the Bidirectional Algorithm to a string, returning the resolved embedding levels
 * in a single Uint8Array plus a list of objects holding each paragraph's start and end indices and resolved
 * base embedding level.
 *
 * @param {string} string - The input string
 * @param {"ltr"|"rtl"|"auto"} [baseDirection] - Use "ltr" or "rtl" to force a base paragraph direction,
 *        otherwise a direction will be chosen automatically from each paragraph's contents.
 * @return {GetEmbeddingLevelsResult}
 */
export function getEmbeddingLevels (string, baseDirection) {
  const MAX_DEPTH = 125
  const stringLength = string.length

  // === Convert string to code points and build index mappings ===
  // Iterate over Unicode code points instead of UTF-16 code units
  // to handle multibyte characters correctly according to UAX#9.
  const codePoints = Array.from(string)
  const numCodePoints = codePoints.length
  // Map code point indices back to their starting code unit index.
  const codePointIndexToCodeUnitIndex = new Uint32Array(numCodePoints)
  // Map code unit indices back to their corresponding code point index.
  const codeUnitIndexToCodePointIndex = new Uint32Array(stringLength)

  // Start by mapping all characters to their unicode type, as a bitmask integer
  // Array sized by the number of code points.
  const charTypes = new Uint32Array(numCodePoints)
  let currentCodeUnitIndex = 0
  for (let cpIdx = 0; cpIdx < numCodePoints; cpIdx++) {
    const char = codePoints[cpIdx]
    const charLength = char.length // 1 for BMP, 2 for surrogate pair
    charTypes[cpIdx] = getBidiCharType(char)
    codePointIndexToCodeUnitIndex[cpIdx] = currentCodeUnitIndex
    for (let i = 0; i < charLength; i++) {
      codeUnitIndexToCodePointIndex[currentCodeUnitIndex + i] = cpIdx
    }
    currentCodeUnitIndex += charLength
  }

  const charTypeCounts = new Map() //will be cleared at start of each paragraph
  function changeCharType(cpIdx, type) { // NOTE: Index is now code point index (cpIdx)
    const oldType = charTypes[cpIdx]
    charTypes[cpIdx] = type
    charTypeCounts.set(oldType, charTypeCounts.get(oldType) - 1)
    if (oldType & NEUTRAL_ISOLATE_TYPES) {
      charTypeCounts.set(NEUTRAL_ISOLATE_TYPES, charTypeCounts.get(NEUTRAL_ISOLATE_TYPES) - 1)
    }
    charTypeCounts.set(type, (charTypeCounts.get(type) || 0) + 1)
    if (type & NEUTRAL_ISOLATE_TYPES) {
      charTypeCounts.set(NEUTRAL_ISOLATE_TYPES, (charTypeCounts.get(NEUTRAL_ISOLATE_TYPES) || 0) + 1)
    }
  }

  // Array sized by the number of code points.
  const embedLevels = new Uint8Array(numCodePoints)
  const isolationPairs = new Map() // init->pdi and pdi->init

  // === 3.3.1 The Paragraph Level ===
  // 3.3.1 P1: Split the text into paragraphs
  const paragraphs = [] // [{start, end, level}, ...]
  let paragraph = null
  // Iterate using code points
  for (let cpIdx = 0; cpIdx < numCodePoints; cpIdx++) {
    const codeUnitIndex = codePointIndexToCodeUnitIndex[cpIdx]
    if (!paragraph) {
      // Store code unit indices in paragraph object
      const paraStartCodeUnitIndex = codeUnitIndex
      paragraphs.push(paragraph = {
        start: paraStartCodeUnitIndex, // Use code unit index
        end: stringLength - 1,       // Use code unit index
        // 3.3.1 P2-P3: Determine the paragraph level
        // Pass code point index to helper, but helper needs adjustment
        level: baseDirection === 'rtl' ? 1 : baseDirection === 'ltr' ? 0 : determineAutoEmbedLevel(cpIdx, false)
      })
    }
    // Check type using code point index
    if (charTypes[cpIdx] & TYPE_B) {
      // Store code unit index
      paragraph.end = codeUnitIndex // Use code unit index
      paragraph = null
    }
  }
  // Ensure the last paragraph ends correctly (using code unit index)
  if (paragraph) {
    paragraph.end = stringLength - 1;
  }

  const FORMATTING_TYPES = TYPE_RLE | TYPE_LRE | TYPE_RLO | TYPE_LRO | ISOLATE_INIT_TYPES | TYPE_PDI | TYPE_PDF | TYPE_B
  const nextEven = n => n + ((n & 1) ? 1 : 2)
  const nextOdd = n => n + ((n & 1) ? 2 : 1)

  // Everything from here on will operate per paragraph.
  for (let paraIdx = 0; paraIdx < paragraphs.length; paraIdx++) {
    paragraph = paragraphs[paraIdx]
    const statusStack = [{
      _level: paragraph.level,
      _override: 0, //0=neutral, 1=L, 2=R
      _isolate: 0 //bool
    }]
    let stackTop
    let overflowIsolateCount = 0
    let overflowEmbeddingCount = 0
    let validIsolateCount = 0
    charTypeCounts.clear()

    // === Determine code point indices for the paragraph ===
    const paraStartCpIdx = codeUnitIndexToCodePointIndex[paragraph.start]
    // For the end index, ensure we get the correct code point index.
    // If the last character is multibyte, its code point index is the same
    // for both its code units.
    const paraEndCpIdx = codeUnitIndexToCodePointIndex[paragraph.end]

    // === 3.3.2 Explicit Levels and Directions ===
    // Iterate using code point indices
    for (let cpIdx = paraStartCpIdx; cpIdx <= paraEndCpIdx; cpIdx++) {
      let charType = charTypes[cpIdx] // Use cpIdx
      stackTop = statusStack[statusStack.length - 1]

      // Set initial counts (using charType obtained via cpIdx)
      charTypeCounts.set(charType, (charTypeCounts.get(charType) || 0) + 1)
      if (charType & NEUTRAL_ISOLATE_TYPES) {
        charTypeCounts.set(NEUTRAL_ISOLATE_TYPES, (charTypeCounts.get(NEUTRAL_ISOLATE_TYPES) || 0) + 1)
      }

      // Explicit Embeddings: 3.3.2 X2 - X3
      if (charType & FORMATTING_TYPES) { //prefilter all formatters
        if (charType & (TYPE_RLE | TYPE_LRE)) {
          embedLevels[cpIdx] = stackTop._level // Use cpIdx
          const level = (charType === TYPE_RLE ? nextOdd : nextEven)(stackTop._level)
          if (level <= MAX_DEPTH && !overflowIsolateCount && !overflowEmbeddingCount) {
            statusStack.push({
              _level: level,
              _override: 0,
              _isolate: 0
            })
          } else if (!overflowIsolateCount) {
            overflowEmbeddingCount++
          }
        }

        // Explicit Overrides: 3.3.2 X4 - X5
        else if (charType & (TYPE_RLO | TYPE_LRO)) {
          embedLevels[cpIdx] = stackTop._level // Use cpIdx
          const level = (charType === TYPE_RLO ? nextOdd : nextEven)(stackTop._level)
          if (level <= MAX_DEPTH && !overflowIsolateCount && !overflowEmbeddingCount) {
            statusStack.push({
              _level: level,
              _override: (charType & TYPE_RLO) ? TYPE_R : TYPE_L,
              _isolate: 0
            })
          } else if (!overflowIsolateCount) {
            overflowEmbeddingCount++
          }
        }

        // Isolates: 3.3.2 X5a - X5c
        else if (charType & ISOLATE_INIT_TYPES) {
          // X5c - FSI becomes either RLI or LRI
          if (charType & TYPE_FSI) {
            // Pass cpIdx + 1, but function needs fixing
            charType = determineAutoEmbedLevel(cpIdx + 1, true) === 1 ? TYPE_RLI : TYPE_LRI
          }

          embedLevels[cpIdx] = stackTop._level // Use cpIdx
          if (stackTop._override) {
            changeCharType(cpIdx, stackTop._override) // Use cpIdx
          }
          const level = (charType === TYPE_RLI ? nextOdd : nextEven)(stackTop._level)
          if (level <= MAX_DEPTH && overflowIsolateCount === 0 && overflowEmbeddingCount === 0) {
            validIsolateCount++
            statusStack.push({
              _level: level,
              _override: 0,
              _isolate: 1,
              _isolInitIndex: cpIdx // Store cpIdx for now
            })
          } else {
            overflowIsolateCount++
          }
        }

        // Terminating Isolates: 3.3.2 X6a
        else if (charType & TYPE_PDI) {
          if (overflowIsolateCount > 0) {
            overflowIsolateCount--
          } else if (validIsolateCount > 0) {
            overflowEmbeddingCount = 0
            while (!statusStack[statusStack.length - 1]._isolate) {
              statusStack.pop()
            }
            // Add to isolation pairs bidirectional mapping:
            const isolInitCpIdx = statusStack[statusStack.length - 1]._isolInitIndex // Get cpIdx
            if (isolInitCpIdx != null) {
              // Map cpIdx to codeUnitIndex before storing
              const isolInitCodeUnitIndex = codePointIndexToCodeUnitIndex[isolInitCpIdx]
              const pdiCodeUnitIndex = codePointIndexToCodeUnitIndex[cpIdx]
              isolationPairs.set(isolInitCodeUnitIndex, pdiCodeUnitIndex)
              isolationPairs.set(pdiCodeUnitIndex, isolInitCodeUnitIndex)
            }
            statusStack.pop()
            validIsolateCount--
          }
          stackTop = statusStack[statusStack.length - 1]
          embedLevels[cpIdx] = stackTop._level // Use cpIdx
          if (stackTop._override) {
            changeCharType(cpIdx, stackTop._override) // Use cpIdx
          }
        }


        // Terminating Embeddings and Overrides: 3.3.2 X7
        else if (charType & TYPE_PDF) {
          if (overflowIsolateCount === 0) {
            if (overflowEmbeddingCount > 0) {
              overflowEmbeddingCount--
            } else if (!stackTop._isolate && statusStack.length > 1) {
              statusStack.pop()
              stackTop = statusStack[statusStack.length - 1]
            }
          }
          embedLevels[cpIdx] = stackTop._level // Use cpIdx
        }

        // End of Paragraph: 3.3.2 X8
        else if (charType & TYPE_B) {
          embedLevels[cpIdx] = paragraph.level // Use cpIdx
        }
      }

      // Non-formatting characters: 3.3.2 X6
      else {
        embedLevels[cpIdx] = stackTop._level // Use cpIdx
        // NOTE: This exclusion of BN seems to go against what section 5.2 says, but is required for test passage
        if (stackTop._override && charType !== TYPE_BN) {
          changeCharType(cpIdx, stackTop._override) // Use cpIdx
        }
      }
    }

    // === 3.3.3 Preparations for Implicit Processing ===

    // Remove all RLE, LRE, RLO, LRO, PDF, and BN characters: 3.3.3 X9
    // Note: Due to section 5.2, we won't remove them, but we'll use the BN_LIKE_TYPES bitset to
    // easily ignore them all from here on out.

    // 3.3.3 X10
    // Compute the set of isolating run sequences as specified by BD13
    const levelRuns = []
    let currentRun = null
    let isolationLevel = 0
    // Iterate using code point indices within the paragraph
    for (let cpIdx = paraStartCpIdx; cpIdx <= paraEndCpIdx; cpIdx++) {
      const charType = charTypes[cpIdx] // Use cpIdx
      // Rule 5.2 (Ignore BN like types implicitly covered by charTypes access)
      // if (!(charType & BN_LIKE_TYPES)) { // No longer needed? BN_LIKE_TYPES should have correct level assigned earlier.

      const lvl = embedLevels[cpIdx] // Use cpIdx
      const isIsolInit = charType & ISOLATE_INIT_TYPES
      const isPDI = charType === TYPE_PDI

      // Check if charType is BN - skip BN characters explicitly according to X10/BD13
      // BN characters should not contribute to runs. (They were assigned levels previously for rule 5.2)
      if (charType & TYPE_BN) { // Check for BN specifically
        continue;
      }

      if (isIsolInit) {
        isolationLevel++
      }
      if (currentRun && lvl === currentRun._level) {
        currentRun._end = cpIdx // Use cpIdx
        currentRun._endsWithIsolInit = isIsolInit
      } else {
        levelRuns.push(currentRun = {
          _start: cpIdx, // Use cpIdx
          _end: cpIdx,   // Use cpIdx
          _level: lvl,
          _startsWithPDI: isPDI,
          _endsWithIsolInit: isIsolInit
        })
      }
      if (isPDI) {
        isolationLevel--
      }
      // }
    }
    const isolatingRunSeqs = [] // [{seqIndices: [], sosType: L|R, eosType: L|R}]
    for (let runIdx = 0; runIdx < levelRuns.length; runIdx++) {
      const run = levelRuns[runIdx]
      // Use cpIdx stored in run._start for isolationPairs lookup
      if (!run._startsWithPDI || (run._startsWithPDI && !isolationPairs.has(run._start))) {
        const seqRuns = [currentRun = run]
        // Use cpIdx stored in run._end for isolationPairs lookup
        for (let pdiCpIdx; currentRun && currentRun._endsWithIsolInit && (pdiCpIdx = isolationPairs.get(currentRun._end)) != null;) {
          for (let i = runIdx + 1; i < levelRuns.length; i++) {
            // Compare cpIdx
            if (levelRuns[i]._start === pdiCpIdx) {
              seqRuns.push(currentRun = levelRuns[i])
              break
            }
          }
        }
        // build flat list of code point indices across all runs:
        const seqIndices = []
        for (let i = 0; i < seqRuns.length; i++) {
          const run = seqRuns[i]
          // Iterate using cpIdx from run._start to run._end
          for (let cpIdx_j = run._start; cpIdx_j <= run._end; cpIdx_j++) {
            seqIndices.push(cpIdx_j) // Push cpIdx
          }
        }
        // determine the sos/eos types:
        // Use cpIdx for access
        let firstLevel = embedLevels[seqIndices[0]]
        let prevLevel = paragraph.level
        // Iterate backwards using cpIdx
        for (let cpIdx_i = seqIndices[0] - 1; cpIdx_i >= paraStartCpIdx; cpIdx_i--) {
          // 5.2 check requires original type - use getBidiCharType on the character again?
          // Or assume charTypes is final for this stage? Let's assume charTypes is ok.
          // Use cpIdx_i for access
          if (!(charTypes[cpIdx_i] & BN_LIKE_TYPES)) { // Access with cpIdx_i
            prevLevel = embedLevels[cpIdx_i] // Access with cpIdx_i
            break
          }
        }
        const lastCpIdx = seqIndices[seqIndices.length - 1]
        let lastLevel = embedLevels[lastCpIdx] // Use cpIdx
        let nextLevel = paragraph.level
        // Check type using cpIdx
        if (!(charTypes[lastCpIdx] & ISOLATE_INIT_TYPES)) {
          // Iterate forwards using cpIdx
          for (let cpIdx_i = lastCpIdx + 1; cpIdx_i <= paraEndCpIdx; cpIdx_i++) {
            // Use cpIdx_i for access
            if (!(charTypes[cpIdx_i] & BN_LIKE_TYPES)) { // Access with cpIdx_i
              nextLevel = embedLevels[cpIdx_i] // Access with cpIdx_i
              break
            }
          }
        }
        isolatingRunSeqs.push({
          _seqIndices: seqIndices, // Now contains cpIdx
          _sosType: Math.max(prevLevel, firstLevel) % 2 ? TYPE_R : TYPE_L,
          _eosType: Math.max(nextLevel, lastLevel) % 2 ? TYPE_R : TYPE_L
        })
      }
    }

    // The next steps are done per isolating run sequence
    for (let seqIdx = 0; seqIdx < isolatingRunSeqs.length; seqIdx++) {
      const { _seqIndices: seqIndices, _sosType: sosType, _eosType: eosType } = isolatingRunSeqs[seqIdx]
      /**
       * All the level runs in an isolating run sequence have the same embedding level.
       * 
       * DO NOT change any `embedLevels[i]` within the current scope.
       */
      // Access embedLevels using the first code point index from seqIndices
      const embedDirection = ((embedLevels[seqIndices[0]]) & 1) ? TYPE_R : TYPE_L;

      // === 3.3.4 Resolving Weak Types ===

      // W1 + 5.2. Search backward from each NSM to the first character in the isolating run sequence whose
      // bidirectional type is not BN, and set the NSM to ON if it is an isolate initiator or PDI, and to its
      // type otherwise. If the NSM is the first non-BN character, change the NSM to the type of sos.
      if (charTypeCounts.get(TYPE_NSM)) {
        for (let si = 0; si < seqIndices.length; si++) {
          const cpIdx = seqIndices[si] // Get cpIdx
          if (charTypes[cpIdx] & TYPE_NSM) { // Access with cpIdx
            let prevType = sosType
            for (let sj = si - 1; sj >= 0; sj--) {
              const prevCpIdx = seqIndices[sj] // Get cpIdx
              if (!(charTypes[prevCpIdx] & BN_LIKE_TYPES)) { // Access with cpIdx
                prevType = charTypes[prevCpIdx] // Access with cpIdx
                break
              }
            }
            // Call changeCharType with cpIdx
            changeCharType(cpIdx, (prevType & (ISOLATE_INIT_TYPES | TYPE_PDI)) ? TYPE_ON : prevType)
          }
        }
      }

      // W2. Search backward from each instance of a European number until the first strong type (R, L, AL, or sos)
      // is found. If an AL is found, change the type of the European number to Arabic number.
      if (charTypeCounts.get(TYPE_EN)) {
        for (let si = 0; si < seqIndices.length; si++) {
          const cpIdx = seqIndices[si] // Get cpIdx
          if (charTypes[cpIdx] & TYPE_EN) { // Access with cpIdx
            for (let sj = si - 1; sj >= -1; sj--) {
              // Access charTypes using cpIdx from seqIndices[sj]
              const prevCharType = sj === -1 ? sosType : charTypes[seqIndices[sj]]
              if (prevCharType & STRONG_TYPES) {
                if (prevCharType === TYPE_AL) {
                  changeCharType(cpIdx, TYPE_AN) // Call with cpIdx
                }
                break
              }
            }
          }
        }
      }

      // W3. Change all ALs to R
      if (charTypeCounts.get(TYPE_AL)) {
        for (let si = 0; si < seqIndices.length; si++) {
          const cpIdx = seqIndices[si] // Get cpIdx
          if (charTypes[cpIdx] & TYPE_AL) { // Access with cpIdx
            changeCharType(cpIdx, TYPE_R) // Call with cpIdx
          }
        }
      }

      // W4. A single European separator between two European numbers changes to a European number. A single common
      // separator between two numbers of the same type changes to that type.
      if (charTypeCounts.get(TYPE_ES) || charTypeCounts.get(TYPE_CS)) {
        for (let si = 1; si < seqIndices.length - 1; si++) {
          const cpIdx = seqIndices[si] // Get cpIdx
          if (charTypes[cpIdx] & (TYPE_ES | TYPE_CS)) { // Access with cpIdx
            let prevType = 0, nextType = 0
            // Scan back using sequence index sj, access with cpIdx = seqIndices[sj]
            for (let sj = si - 1; sj >= 0; sj--) {
              prevType = charTypes[seqIndices[sj]] // Access with cpIdx
              if (!(prevType & BN_LIKE_TYPES)) { //5.2
                break
              }
            }
            // Scan forward using sequence index sj, access with cpIdx = seqIndices[sj]
            for (let sj = si + 1; sj < seqIndices.length; sj++) {
              nextType = charTypes[seqIndices[sj]] // Access with cpIdx
              if (!(nextType & BN_LIKE_TYPES)) { //5.2
                break
              }
            }
            // Access charTypes[cpIdx]
            if (prevType === nextType && (charTypes[cpIdx] === TYPE_ES ? prevType === TYPE_EN : (prevType & (TYPE_EN | TYPE_AN)))) {
              changeCharType(cpIdx, prevType) // Call with cpIdx
            }
          }
        }
      }

      // W5. A sequence of European terminators adjacent to European numbers changes to all European numbers.
      if (charTypeCounts.get(TYPE_EN)) {
        for (let si = 0; si < seqIndices.length; si++) {
          const cpIdx = seqIndices[si] // Get cpIdx
          if (charTypes[cpIdx] & TYPE_EN) { // Access with cpIdx
            // Scan back with sj, access with cpIdx = seqIndices[sj]
            for (let sj = si - 1; sj >= 0 && (charTypes[seqIndices[sj]] & (TYPE_ET | BN_LIKE_TYPES)); sj--) {
              changeCharType(seqIndices[sj], TYPE_EN) // Call with cpIdx
            }
            // Scan forward with si, access with cpIdx = seqIndices[si]
            for (si++; si < seqIndices.length && (charTypes[seqIndices[si]] & (TYPE_ET | BN_LIKE_TYPES | TYPE_EN)); si++) {
              if (charTypes[seqIndices[si]] !== TYPE_EN) {
                changeCharType(seqIndices[si], TYPE_EN) // Call with cpIdx
              }
            }
          }
        }
      }

      // W6. Otherwise, separators and terminators change to Other Neutral.
      if (charTypeCounts.get(TYPE_ET) || charTypeCounts.get(TYPE_ES) || charTypeCounts.get(TYPE_CS)) {
        for (let si = 0; si < seqIndices.length; si++) {
          const cpIdx = seqIndices[si] // Get cpIdx
          if (charTypes[cpIdx] & (TYPE_ET | TYPE_ES | TYPE_CS)) { // Access with cpIdx
            changeCharType(cpIdx, TYPE_ON) // Call with cpIdx
            // 5.2 transform adjacent BNs too:
            // Scan back with sj, access with cpIdx = seqIndices[sj]
            for (let sj = si - 1; sj >= 0 && (charTypes[seqIndices[sj]] & BN_LIKE_TYPES); sj--) {
              changeCharType(seqIndices[sj], TYPE_ON) // Call with cpIdx
            }
            // Scan forward with sj, access with cpIdx = seqIndices[sj]
            for (let sj = si + 1; sj < seqIndices.length && (charTypes[seqIndices[sj]] & BN_LIKE_TYPES); sj++) {
              changeCharType(seqIndices[sj], TYPE_ON) // Call with cpIdx
            }
          }
        }
      }

      // W7. Search backward from each instance of a European number until the first strong type (R, L, or sos)
      // is found. If an L is found, then change the type of the European number to L.
      // NOTE: implemented in single forward pass for efficiency
      if (charTypeCounts.get(TYPE_EN)) {
        for (let si = 0, prevStrongType = sosType; si < seqIndices.length; si++) {
          const cpIdx = seqIndices[si] // Get cpIdx
          const type = charTypes[cpIdx] // Access with cpIdx
          if (type & TYPE_EN) {
            if (prevStrongType === TYPE_L) {
              changeCharType(cpIdx, TYPE_L) // Call with cpIdx
            }
          } else if (type & STRONG_TYPES) {
            prevStrongType = type
          }
        }
      }

      // === 3.3.5 Resolving Neutral and Isolate Formatting Types ===

      if (charTypeCounts.get(NEUTRAL_ISOLATE_TYPES)) {
        // N0. Process bracket pairs in an isolating run sequence sequentially in the logical order of the text
        // positions of the opening paired brackets using the logic given below. Within this scope, bidirectional
        // types EN and AN are treated as R.
        const R_TYPES_FOR_N_STEPS = (TYPE_R | TYPE_EN | TYPE_AN)
        const STRONG_TYPES_FOR_N_STEPS = R_TYPES_FOR_N_STEPS | TYPE_L

        // * Identify the bracket pairs in the current isolating run sequence according to BD16.
        const bracketPairs = []
        {
          const openerStack = []
          for (let si = 0; si < seqIndices.length; si++) {
            const cpIdx = seqIndices[si] // Get cpIdx
            // NOTE: for any potential bracket character we also test that it still carries a NI
            // type, as that may have been changed earlier. This doesn't seem to be explicitly
            // called out in the spec, but is required for passage of certain tests.
            if (charTypes[cpIdx] & NEUTRAL_ISOLATE_TYPES) { // Access with cpIdx
              const char = codePoints[cpIdx] // Use codePoints array with cpIdx
              let oppositeBracket
              // Opening bracket
              if (openingToClosingBracket(char) !== null) {
                if (openerStack.length < 63) {
                  openerStack.push({ char, seqIndex: si }) // Store sequence index si
                } else {
                  break
                }
              }
              // Closing bracket
              else if ((oppositeBracket = closingToOpeningBracket(char)) !== null) {
                for (let stackIdx = openerStack.length - 1; stackIdx >= 0; stackIdx--) {
                  const stackChar = openerStack[stackIdx].char
                  if (stackChar === oppositeBracket ||
                    stackChar === closingToOpeningBracket(getCanonicalBracket(char)) ||
                    openingToClosingBracket(getCanonicalBracket(stackChar)) === char
                  ) {
                    // Store sequence indices si
                    bracketPairs.push([openerStack[stackIdx].seqIndex, si])
                    openerStack.length = stackIdx //pop the matching bracket and all following
                    break
                  }
                }
              }
            }
          }
          bracketPairs.sort((a, b) => a[0] - b[0])
        }
        // * For each bracket-pair element in the list of pairs of text positions
        for (let pairIdx = 0; pairIdx < bracketPairs.length; pairIdx++) {
          // Use sequence indices
          const [openSeqIdx, closeSeqIdx] = bracketPairs[pairIdx]
          // a. Inspect the bidirectional types of the characters enclosed within the bracket pair.
          // b. If any strong type (either L or R) matching the embedding direction is found, set the type for both
          // brackets in the pair to match the embedding direction.
          let foundStrongType = false
          let useStrongType = 0
          // Iterate using sequence index si
          for (let si = openSeqIdx + 1; si < closeSeqIdx; si++) {
            const cpIdx = seqIndices[si] // Get cpIdx
            if (charTypes[cpIdx] & STRONG_TYPES_FOR_N_STEPS) { // Access with cpIdx
              foundStrongType = true
              // Access with cpIdx
              const lr = (charTypes[cpIdx] & R_TYPES_FOR_N_STEPS) ? TYPE_R : TYPE_L
              if (lr === embedDirection) {
                useStrongType = lr
                break
              }
            }
          }
          // c. Otherwise, if there is a strong type it must be opposite the embedding direction. Therefore, test
          // for an established context with a preceding strong type by checking backwards before the opening paired
          // bracket until the first strong type (L, R, or sos) is found.
          //    1. If the preceding strong type is also opposite the embedding direction, context is established, so
          //    set the type for both brackets in the pair to that direction.
          //    2. Otherwise set the type for both brackets in the pair to the embedding direction.
          if (foundStrongType && !useStrongType) {
            useStrongType = sosType
            // Iterate using sequence index si
            for (let si = openSeqIdx - 1; si >= 0; si--) {
              const cpIdx = seqIndices[si] // Get cpIdx
              if (charTypes[cpIdx] & STRONG_TYPES_FOR_N_STEPS) { // Access with cpIdx
                // Access with cpIdx
                const lr = (charTypes[cpIdx] & R_TYPES_FOR_N_STEPS) ? TYPE_R : TYPE_L
                if (lr !== embedDirection) {
                  useStrongType = lr
                } else {
                  useStrongType = embedDirection
                }
                break
              }
            }
          }
          if (useStrongType) {
            // Call changeCharType with cpIdx from seqIndices
            changeCharType(seqIndices[openSeqIdx], useStrongType)
            changeCharType(seqIndices[closeSeqIdx], useStrongType)

            // * Any number of characters that had original bidirectional character type NSM prior to the application
            // of W1 that immediately follow a paired bracket which changed to L or R under N0 should change to match
            // the type of their preceding bracket.
            if (useStrongType !== embedDirection) {
              // Iterate using sequence index si
              for (let si = openSeqIdx + 1; si < seqIndices.length; si++) {
                const cpIdx = seqIndices[si] // Get cpIdx
                if (!(charTypes[cpIdx] & BN_LIKE_TYPES)) { // Access with cpIdx
                  // Use codePoints array and cpIdx for getBidiCharType
                  if (getBidiCharType(codePoints[cpIdx]) & TYPE_NSM) {
                    changeCharType(cpIdx, useStrongType) // Call with cpIdx
                  }
                  break
                }
              }
            }
            if (useStrongType !== embedDirection) {
              // Iterate using sequence index si
              for (let si = closeSeqIdx + 1; si < seqIndices.length; si++) {
                const cpIdx = seqIndices[si] // Get cpIdx
                if (!(charTypes[cpIdx] & BN_LIKE_TYPES)) { // Access with cpIdx
                  // Use codePoints array and cpIdx for getBidiCharType
                  if (getBidiCharType(codePoints[cpIdx]) & TYPE_NSM) {
                    changeCharType(cpIdx, useStrongType) // Call with cpIdx
                  }
                  break
                }
              }
            }
          }
        }

        // N1. A sequence of NIs takes the direction of the surrounding strong text if the text on both sides has the
        // same direction.
        // N2. Any remaining NIs take the embedding direction.
        for (let si = 0; si < seqIndices.length; si++) {
          const cpIdx = seqIndices[si] // Get cpIdx
          if (charTypes[cpIdx] & NEUTRAL_ISOLATE_TYPES) { // Access with cpIdx
            let niRunStartSi = si, niRunEndSi = si // Store sequence indices
            // Scan back using sequence index si2
            let prevStrongRunSi = -1;
            for (let si2 = si - 1; si2 >= 0; si2--) {
              const prevCpIdx = seqIndices[si2]; // Get cpIdx
              if (charTypes[prevCpIdx] & BN_LIKE_TYPES) { // Access with cpIdx
                niRunStartSi = si2 // Update sequence index
              } else {
                prevStrongRunSi = si2; // Store sequence index of the strong char
                break
              }
            }
            const prevType = prevStrongRunSi === -1 ? sosType : (charTypes[seqIndices[prevStrongRunSi]] & R_TYPES_FOR_N_STEPS) ? TYPE_R : TYPE_L; // Use stored sequence index

            // Scan forward using sequence index si2
            let nextStrongRunSi = -1;
            for (let si2 = si + 1; si2 < seqIndices.length; si2++) {
              const nextCpIdx = seqIndices[si2]; // Get cpIdx
              if (charTypes[nextCpIdx] & (NEUTRAL_ISOLATE_TYPES | BN_LIKE_TYPES)) { // Access with cpIdx
                niRunEndSi = si2 // Update sequence index
              } else {
                nextStrongRunSi = si2; // Store sequence index of the strong char
                break
              }
            }
            const nextType = nextStrongRunSi === -1 ? eosType : (charTypes[seqIndices[nextStrongRunSi]] & R_TYPES_FOR_N_STEPS) ? TYPE_R : TYPE_L; // Use stored sequence index

            const resolvedType = prevType === nextType ? prevType : embedDirection
            // Iterate using sequence index sj from niRunStartSi to niRunEndSi
            for (let sj = niRunStartSi; sj <= niRunEndSi; sj++) {
              changeCharType(seqIndices[sj], resolvedType) // Call with cpIdx from seqIndices
            }
            si = niRunEndSi // Continue outer loop using sequence index
          }
        }
      }
    }

    // === 3.3.6 Resolving Implicit Levels ===

    // Iterate using code point indices within the paragraph
    for (let cpIdx = paraStartCpIdx; cpIdx <= paraEndCpIdx; cpIdx++) {
      const level = embedLevels[cpIdx] // Access with cpIdx
      const type = charTypes[cpIdx]   // Access with cpIdx

      // I2. For all characters with an odd (right-to-left) embedding level, those of type L, EN or AN go up one level.
      if (level & 1) {
        if (type & (TYPE_L | TYPE_EN | TYPE_AN)) {
          embedLevels[cpIdx]++ // Access with cpIdx
        }
      }
        // I1. For all characters with an even (left-to-right) embedding level, those of type R go up one level
        // and those of type AN or EN go up two levels.
      else {
        if (type & TYPE_R) {
          embedLevels[cpIdx]++ // Access with cpIdx
        } else if (type & (TYPE_AN | TYPE_EN)) {
          embedLevels[cpIdx] += 2 // Access with cpIdx
        }
      }

      // 5.2: Resolve any LRE, RLE, LRO, RLO, PDF, or BN to the level of the preceding character if there is one,
      // and otherwise to the base level.
      if (type & BN_LIKE_TYPES) {
        // REVERTED: Use immediately preceding level, not searching back.
        embedLevels[cpIdx] = cpIdx === paraStartCpIdx ? paragraph.level : embedLevels[cpIdx - 1]
      }

      // 3.4 L1.1-4: Reset the embedding level of segment/paragraph separators, and any sequence of whitespace or
      // isolate formatting characters preceding them or the end of the paragraph, to the paragraph level.
      // NOTE: this will also need to be applied to each individual line ending after line wrapping occurs.
      // Check if the current character triggers the rule (End, S or B)
      if (cpIdx === paraEndCpIdx || (getBidiCharType(codePoints[cpIdx]) & (TYPES.S | TYPES.B))) {
         // REVERTED (again) to using TRAILING_TYPES for now to match original test expectations
         for (let j_cpIdx = cpIdx; j_cpIdx >= paraStartCpIdx; j_cpIdx--) {
           // Use the *original* Bidi type for the check
           if(getBidiCharType(codePoints[j_cpIdx]) & TRAILING_TYPES) { // Use TRAILING_TYPES
              embedLevels[j_cpIdx] = paragraph.level
           } else {
             break; // Stop once a non-trailing type is found
           }
         }
       }
    }
  }

  // === Map resolved code-point-based levels back to code units ===
  // The public API requires levels per code unit.
  const finalLevels = new Uint8Array(stringLength);
  for(let cpIdx = 0; cpIdx < numCodePoints; cpIdx++) {
    const level = embedLevels[cpIdx];
    const codeUnitIndex = codePointIndexToCodeUnitIndex[cpIdx];
    const char = codePoints[cpIdx];
    // Assign the level to the first code unit of the character.
    finalLevels[codeUnitIndex] = level;
    // If it's a surrogate pair (2 code units), assign the same level to the second unit.
    if (char.length === 2) {
      finalLevels[codeUnitIndex + 1] = level;
    }
  }

  // DONE! The resolved levels can then be used, after line wrapping, to flip runs of characters
  // according to section 3.4 Reordering Resolved Levels
  return {
    levels: finalLevels, // Return code-unit-indexed levels
    paragraphs // Already contains code unit indices
  }

  // Takes a start code point index
  function determineAutoEmbedLevel (startCpIdx, isFSI) {
    // 3.3.1 P2 - P3
    // Iterate using code point index
    for (let cpIdx_i = startCpIdx; cpIdx_i < numCodePoints; cpIdx_i++) {
      const charType = charTypes[cpIdx_i] // Access with cpIdx
      if (charType & (TYPE_R | TYPE_AL)) {
        return 1
      }
      if ((charType & (TYPE_B | TYPE_L)) || (isFSI && charType === TYPE_PDI)) {
        return 0
      }
      if (charType & ISOLATE_INIT_TYPES) {
        // Pass cpIdx to helper
        const pdiCpIdx = indexOfMatchingPDI(cpIdx_i)
        // Compare with numCodePoints
        cpIdx_i = pdiCpIdx === -1 ? numCodePoints : pdiCpIdx
      }
    }
    return 0
  }

  // Takes an isolate start code point index
  function indexOfMatchingPDI (isolateStartCpIdx) {
    // 3.1.2 BD9
    let isolationLevel = 1
    // Iterate using code point index
    for (let cpIdx_i = isolateStartCpIdx + 1; cpIdx_i < numCodePoints; cpIdx_i++) {
      const charType = charTypes[cpIdx_i] // Access with cpIdx
      // Removed TYPE_B check as loop boundary is now numCodePoints
      // if (charType & TYPE_B) {
      //   break
      // }
      if (charType & TYPE_PDI) {
        if (--isolationLevel === 0) {
          return cpIdx_i // Return cpIdx
        }
      } else if (charType & ISOLATE_INIT_TYPES) {
        isolationLevel++
      }
    }
    return -1
  }
}
