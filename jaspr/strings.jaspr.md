[☙ Object Operations][prev] | [🗏 Table of Contents][toc] | [Pattern Matching ❧][next]
:---|:---:|---:

    $schema: “http://adam.nels.onl/schema/jaspr/module”

# String Operations

    ; TODO: Implement string operations

## Basic String Operations

### `str`

`str` doubles as a value-to-string function and a string concatenation function.

`(str x)` returns a string representation of `x`. If `x` is a string, `str` returns `x`.

>     (str "") ;= ""
>     (str "The rain in Spain stays mainly on the plain.")
>       ;= "The rain in Spain stays mainly on the plain."

If `x` is a magic object, `str` returns `(magic)`.

>     (str (fn- x x)) ;= "(magic)"

If `x` is any other Jaspr value, `str` returns a valid Jaspr representation of `x`.

>     (str null) ;= "null"
>     (str true) ;= "true"
>     (str false) ;= "false"
>     (str 1) ;= "1"
>     (str -5) ;= "-5"
>     (str 3.1419) ;= "3.1419"
>     (str '[]) ;= "[]"
>     (str '[1 2 3]) ;= "[1, 2, 3]"

This is not necessarily a JSON representation of `x`; strings will be unquoted when possible, and, when quoted, will use smart quotes.

>     (str '[foo bar baz])    ;= "[foo, bar, baz]"
>     (str '["()" "[]" "{}"]) ;= "[“()”, “[]”, “{}”]"
>     (str '{foo: bar})       ;= "{foo: bar}"
>     [str '{"()": "[]"}]     ;= "{“()”: “[]”}"

`(str x₀ x₁ … xₙ)` returns the concatenation of the string representations of `x₀`…`xₙ`.

>     (str)             ;= ""
>     (str "foo" "bar") ;= "foobar"
>     (str "foo" "bar" "baz" "quux") ;= "foobarbazquux"
>     (str true false 91 '[1 2])     ;= "truefalse91[1, 2]"

---

    str:
    (fn* args
      (case= (len args)
        0 ""
        1 (p.toString (0 args))
        2 (p.stringConcat (p.toString (0 args)) (p.toString (1 args)))
        (let {half: (floor (div (len args) 2))}
          (p.stringConcat (apply str (take half args))
                          (apply str (drop half args))))))

### `toJSON`

    ; TODO: Implement toJSON

### `fromJSON`

    ; TODO: Implement fromJSON

### `emptyString?`

`(emptyString? s)` returns `true` if `s` is the empty string (`“”`), `false` otherwise.

>     (emptyString? “”)    ;= true
>     (emptyString? “foo”) ;= false
>     (emptyString? “ ”)   ;= false
>     (emptyString? null)  ;= false

---

    emptyString?: (fn- x (= x “”))

### `substring?`

`(substring? sub super)` returns `true` if the string `sub` is contained in `super`, `false` otherwise.

>     (substring? “foo” “foo”)  ;= true
>     (substring? “bar” “foo”)  ;= false
>     (substring? “o” “foobar”) ;= true
>     (substring? “foobar” “o”) ;= false
>     (substring? “” “foo”)     ;= true

`substring?` raises a `BadArgs` error if either of its arguments is not a string.

---

    substring?:
    (fn- sub super
      (assertArgs (string? sub) "not a string"
                  (string? super) "not a string"
        (no (p.is? (p.stringNativeIndexOf sub super 0) -1))))

### `startWith?`

`(startsWith? prefix s)` returns `true` if the string `prefix` is the beginning of the string `s`, `false` otherwise.

>     (startsWith? “foo” “foo”)  ;= true
>     (startsWith? “bar” “foo”)  ;= false
>     (startsWith? “fo” “foobar”) ;= true
>     (startsWith? “oo” “foobar”) ;= false
>     (startsWith? “ar” “foobar”) ;= false
>     (startsWith? “foobar” “fo”) ;= false
>     (startsWith? “” “foo”)     ;= true

`startsWith?` raises a `BadArgs` error if either of its arguments is not a string.

---

    startsWith?:
    (fn- prefix s
      (assertArgs (string? prefix) "not a string"
                  (string? s) "not a string"
        (p.is? (p.stringNativeLastIndexOf prefix s 0) 0)))

### `endsWith?`

`(endsWith? suffix s)` returns `true` if the string `suffix` is the end of the string `s`, `false` otherwise.

>     (endsWith? “foo” “foo”)   ;= true
>     (endsWith? “bar” “foo”)   ;= false
>     (endsWith? “ar” “foobar”) ;= true
>     (endsWith? “ba” “foobar”) ;= false
>     (endsWith? “fo” “foobar”) ;= false
>     (endsWith? “foobar” “ar”) ;= false
>     (endsWith? “” “foo”)      ;= true

`endsWith?` raises a `BadArgs` error if either of its arguments is not a string.

---

    endsWith?:
    (fn- suffix s
      (assertArgs (string? suffix) "not a string"
                  (string? s) "not a string"
        (let { sLen: (p.stringNativeLength s)
               preLen: (sub sLen (p.stringNativeLength suffix)) }
          (and (>= preLen 0)
               (p.is? (p.stringNativeIndexOf suffix s preLen) preLen)))))

### `replace`

### `splitString`

## String Elements

### Chars

#### `char`

    char: (fn- n s (assertArgs (integer? n) "not an integer"
                               (string? s) "not a string"
                               (p.stingUnicodeCharAt n s)))

#### `chars`

    chars: (fn- s (assertArgs (string? s) "not a string"
                              (p.stringUnicodeLength s)))

#### `toChars`

    toChars: (fn- s (makeArray (\ p.stringUnicodeCharAt _ s) (chars s)))

#### `fromChars`

#### `iterChars!`

#### `sliceChars`

#### `charIndexOf`

#### `lastCharIndexOf`

#### `charIndexesOf`

### Code Points

#### `codePoint`

    codePoint: (fn- n s (assertArgs (integer? n) "not an integer"
                                    (string? s) "not a string"
                                    (p.stringUnicodeCodePointAt n s)))

#### `codePoints`

    codePoints: chars

#### `toCodePoints`

    toCodePoints:
    (fn- s (makeArray (\ p.stringUnicodeCodePointAt _ s) (codePoints s)))

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

    unit: (fn- n s (assertArgs (integer? n) "not an integer"
                               (string? s) "not a string"
                               (p.stringNativeCharAt n s)))

#### `units`

    units: (fn- s (assertArgs (string? s) "not a string"
                              (p.stringNativeLength s)))

#### `toUnits`

    toUnits: (fn- s (makeArray (\ p.stringNativeCharAt _ s) (units s)))

#### `fromUnits`

    fromUnits: (fn- xs (assertArgs (array? xs) "not an array"
                                   (p.stringFromNativeChars xs)))

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
