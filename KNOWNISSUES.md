# Known Issues

This document lists known test failures and issues within the `bidi-js` library.

## BidiCharacterTest Failures (2)

Two tests from the standard `BidiCharacterTest.txt` suite are currently failing after the implementation of Unicode code point handling (Issue #9).

These failures relate to edge cases in the Unicode Bidirectional Algorithm (UAX#9), specifically concerning the interaction between explicit directional formatting characters (LRE, RLE, PDF) and subsequent neutral/numeric characters, likely involving rules L1 and/or 5.2.

Attempts to fix these specific test cases by modifying the core algorithm resulted in regressions in other tests or required brittle, special-case handling. These failures have been accepted as a reasonable tradeoff for the significant improvement in handling multibyte characters throughout the library.

### 1. Test Line 135

- **File:** `test/BidiCharacterTest.txt`, line 135
- **Direction:** LTR
- **Input Codes:** `05D0 202A 202A 202C 202C 0020 0031 0020 0032` (R LRE LRE PDF PDF WS EN WS EN)
- **Failure:**
  - **Levels:** Expected `1 x x x x 1 2 1 2`, Received `1 1 1 1 0 0 0 0 0`
  - **Order:** Expected `8 7 6 5 0`, Received `0 5 6 7 8`

### 2. Test Line 150

- **File:** `test/BidiCharacterTest.txt`, line 150
- **Direction:** RTL
- **Input Codes:** `0061 202B 202B 202C 202C 0020 0031 0020 0032` (L RLE RLE PDF PDF WS EN WS EN)
- **Failure:**
  - **Levels:** Expected `2 x x x x 2 2 2 2`, Received `2 2 2 2 1 1 2 1 2`
  - **Order:** Expected `0 5 6 7 8`, Received `8 7 6 5 0`
