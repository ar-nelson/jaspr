[☙ Object Operations][prev] | [🗏 Table of Contents][toc] | [Pattern Matching ❧][next]
:---|:---:|---:

    $schema: “http://adam.nels.onl/schema/jaspr/module”

# String Operations

    ; TODO: Implement string operations

## Basic String Operations

### `str`

### `toJSON`

### `fromJSON`

### `emptyString?`

### `substring?`

### `startWith?`

### `endsWith?`

### `replace`

## String Elements

### Chars

#### `char`

#### `chars`

#### `toChars`

#### `fromChars`

#### `iterChars!`

#### `sliceChars`

#### `charIndexOf`

#### `lastCharIndexOf`

#### `charIndexesOf`

### Code Points

#### `codePoint`

#### `codePoints`

#### `toCodePoints`

#### `fromCodePoints`

#### `iterCodePoints!`

### Bytes

#### `byte`

#### `bytes`

#### `toBytes`

#### `fromBytes`

#### `iterBytes!`

#### `sliceBytes`

#### `byteIndexOf`

#### `lastByteIndexOf`

#### `byteIndexesOf`

### Units

#### `unit`

#### `units`

#### `toUnits`

#### `fromUnits`

#### `iterUnits!`

#### `sliceUnits`

#### `unitIndexOf`

#### `lastUnitIndexOf`

#### `unitIndexesOf`

## Unicode Operations

### `uppercase`

### `lowercase`

### `trim`

### `lines`

### `words`

### `normalizeNFD`

### `normalizeNFC`

### `normalizeNFKD`

### `normalizeNFKC`

## Exports

     $export: {
       str toJSON fromJSON emptyString? substring? startWith? endsWith? replace
       char chars toChars fromChars iterChars! sliceChars charIndexOf
       lastCharIndexOf charIndexesOf
       codePoint codePoints toCodePoints fromCodePoints iterCodePoints!
       byte bytes toBytes fromBytes iterBytes! sliceBytes byteIndexOf
       lastByteIndexOf byteIndexesOf
       unit units toUnits fromUnits iterUnits! sliceUnits unitIndexOf
       lastUnitIndexOf unitIndexesOf
       uppercase lowercase trim lines words
       normalizeNFD normalizeNFC normalizeNFKD normalizeNFKC
     }

[☙ Object Operations][prev] | [🗏 Table of Contents][toc] | [Pattern Matching ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: objects.jaspr.md
[next]: pattern-matching.jaspr.md
