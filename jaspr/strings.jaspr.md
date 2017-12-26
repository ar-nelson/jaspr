[☙ Object Operations][prev] | [🗏 Table of Contents][toc] | [Pattern Matching ❧][next]
:---|:---:|---:

# String Operations

## `str`

`str` doubles as a value-to-string function and a string concatenation function.

`(str x)` returns a string representation of `x`. If `x` is a string, `str` returns `x`.

>     (str “”) ;= “”
>     (str “The rain in Spain stays mainly on the plain.”)
>       ;= “The rain in Spain stays mainly on the plain.”

If `x` is a magic object, `str` returns `(magic)`.

>     (str (fn- x x)) ;= “(magic)”

If `x` is any other Jaspr value, `str` returns a valid Jaspr representation of `x`.

>     (str null) ;= “null”
>     (str true) ;= “true”
>     (str false) ;= “false”
>     (str 1) ;= “1”
>     (str -5) ;= “-5”
>     (str 3.1419) ;= “3.1419”
>     (str '[]) ;= “[]”
>     (str '[1 2 3]) ;= “[1, 2, 3]”

This is not necessarily a JSON representation of `x`; strings will be unquoted when possible, and, when quoted, will use smart quotes.

>     (str '[foo bar baz])    ;= “[foo, bar, baz]”
>     (str '[“()” “[]” “{}”]) ;= “[“()”, “[]”, “{}”]”
>     (str '{foo: bar})       ;= “{foo: bar}”
>     [str '{“()”: “[]”}]     ;= “{“()”: “[]”}”

`(str x₀ x₁ … xₙ)` returns the concatenation of the string representations of `x₀`…`xₙ`.

>     (str)             ;= “”
>     (str “foo” “bar”) ;= “foobar”
>     (str “foo” “bar” “baz” “quux”) ;= “foobarbazquux”
>     (str true false 91 '[1 2])     ;= “truefalse91[1, 2]”

---

    str:
    (fn* args
      (case= (len args)
        0 “”
        1 (p.toString (0 args))
        2 (p.stringConcat (p.toString (0 args)) (p.toString (1 args)))
        (define {half: (floor (div (len args) 2))}
          (p.stringConcat (apply str (take half args))
                          (apply str (drop half args))))))

## `toJSON`

    ; TODO: Implement toJSON

## `fromJSON`

    ; TODO: Implement fromJSON

## `emptyString?`

`(emptyString? s)` returns `true` if `s` is the empty string (`“”`), `false` otherwise.

>     (emptyString? “”)    ;= true
>     (emptyString? “foo”) ;= false
>     (emptyString? “ ”)   ;= false
>     (emptyString? null)  ;= false

---

    emptyString?: (fn- x (= x “”))

## `substring?`

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
      (assertArgs (string? sub) “not a string”
                  (string? super) “not a string”
        (no (p.is? (p.stringNativeIndexOf sub super 0) -1))))

## `startWith?`

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
      (assertArgs (string? prefix) “not a string”
                  (string? s) “not a string”
        (p.is? (p.stringNativeLastIndexOf prefix s 0) 0)))

## `endsWith?`

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
      (assertArgs (string? suffix) “not a string”
                  (string? s) “not a string”
        (define { sLen: (p.stringNativeLength s)
                  preLen: (sub sLen (p.stringNativeLength suffix)) }
          (and (>= preLen 0)
               (p.is? (p.stringNativeIndexOf suffix s preLen) preLen)))))

## `replace`

>     (replace “keyboard” “leopard”
>       “Software keyboards or on-screen keyboards often take the form of computer programs that display an image of a keyboard on the screen.”
>     ) ;= “Software leopards or on-screen leopards often take the form of computer programs that display an image of a leopard on the screen.”

---

    replace:
    (fn- old new s
      (assertArgs (string? old) “not a string”
                  (string? new) “not a string”
                  (string? s) “not a string”
        (loopAs next {out: "", start: 0, i: (unitIndexOf old s)}
          (if (< i 0) (str out (sliceUnits start s))
                      (define {j: (add i (units old))}
                        (next {out: (str out (sliceUnits start i s) new),
                               start: j, i: (unitIndexOf old j s)}))))))

## `splitString`

>     (splitString “ ” “foo bar baz”) ;= [“foo”, “bar”, “baz”]
>     (splitString “ba” “foo bar baz”) ;= [“foo ”, “r ”, “z”]
>     (splitString “q” “foo bar baz”) ;= [“foo bar baz”]

---

    splitString:
    (fn- delim s
      (assertArgs (string? delim) “delimiter is not a string”
                  delim “delimiter cannot be empty”
                  (string? s) “not a string”
        (loopAs next {parts: [], start: 0, i: (unitIndexOf delim s)}
          (if (< i 0) (snoc parts (sliceUnits start s))
                      (define {j: (add i (units delim))}
                        (next {parts: (snoc parts (sliceUnits start i s)),
                               start: j, i: (unitIndexOf delim j s)}))))))

### `trim`

>     (trim “
>              so much whitespace
>     
>     ”) ;= “so much whitespace”

---

    trim:
    (fn- s (sliceChars (loopAs next {i: 1, c: (char 0 s)}
                         (if (any=? c “ ” “\t” “\n” “\r”)
                             (next {i: (inc i), c: (char i s)})
                             (dec i)))
                       (loopAs next {i: -2, c: (char -1 s)}
                         (if (any=? c “ ” “\t” “\n” “\r”)
                               (next {i: (dec i), c: (char i s)})
                             (emptyString? c)
                               (chars s)
                             (add 2 i (chars s))))
                       s))

### `lines`

>     (lines “
>        foo
>        bar
>        baz”) ;= [“foo”, “bar”, “baz”]

---

    lines: (\->> (splitString “\n”)
                 (map trim)
                 (reject emptyString?))

### `words`

## String Elements

Jaspr has extensive Unicode support. Strings in Jaspr are sequences of 32-bit Unicode characters (_chars_), with no surrogate pairs or other encoding issues. However, because this representation is slow on most platforms, Jaspr also provides a platform-specific _units_ representation for performance, which may split surrogate pairs or map incorrectly to Unicode in other ways.

Because these different string representations exist, there is no single _length_ or _slice_/_substring_ function for Jaspr strings. All functionality dealing with character counting or indexing is split among four element types: _chars_, _code points_, _bytes_, and _units_. For most purposes, _chars_ is the preferred representation: use `chars` to get the length of a string and `sliceChars` to extract a substring.

### Chars

_Chars_ are the individual 32-bit Unicode code points of a string, as one-character strings.

#### `char`

`(char n s)` returns the `n`th Unicode character in the string `s`, as a one-character string.

>     (char 0 “foo”) ;= “f”
>     (char 2 “bar”) ;= “r”
>     (char 2 “✅🐎🔋⊓”) ;= “🔋”

If `n` is negative, `char` indexes backward from the end of `s`.

>     (char -1 “fhqwhgads”) ;= “s”
>     (char -3 “✅🐎🔋⊓”) ;= “🐎”

If `n` is not a valid index into `s`, `char` returns an empty string.

>     (char 3 “foo”) ;= “”
>     (char -5 “✅🐎🔋⊓”) ;= “”

`char` raises a `BadArgs` error if `n` is not an integer or `s` is not a string.

---

    char: (fn- n s (assertArgs (integer? n) “not an integer”
                               (string? s) “not a string”
                               (p.stringUnicodeCharAt n s)))

#### `chars`

`(chars s)` returns the length of the string `s` in Unicode code points.

>     (chars “”) ;= 0
>     (chars “foo”) ;= 3
>     (chars “✅🐎🔋⊓”) ;= 4

`chars` raises a `BadArgs` error if `s` is not a string.

---

    chars: (fn- s (assertArgs (string? s) “not a string”
                              (p.stringUnicodeLength s)))

#### `toChars`

`(toChars s)` converts the string `s` into an array of one-character strings, each of which contains one 32-bit Unicode code point.

>     (toChars “”) ;= []
>     (toChars “foo”) ;= [“f”, “o”, “o”]
>     (toChars “✅🐎🔋⊓”) ;= [“✅”, “🐎”, “🔋”, “⊓”]

`toChars` raises a `BadArgs` error if `s` is not a string.

---

    toChars: (fn- s (makeArray (\ p.stringUnicodeCharAt _ s) (chars s)))

#### `fromChars`

`(fromChars cs)` concatenates the array `cs` of one-character strings into a single string. It is the inverse operation of `toChars`.

>     (fromChars []) ;= “”
>     (fromChars '[“f”, “o”, “o”]) ;= “foo”
>     (fromChars '[“✅”, “🐎”, “🔋”, “⊓”]) ;= “✅🐎🔋⊓”

`fromChars` raises a `BadArgs` error if `cs` is not an array. Its return value is undefined if the elements of `cs` are not one-character strings.

---

    fromChars: (fn- cs (apply str cs))

#### `sliceChars`

`(sliceChars start end s)` returns a substring of the string `s`, from `start` (inclusive) to `end` (exclusive), indexed by 32-bit Unicode code points.

>     (sliceChars 1 4 “foobar”) ;= “oob”
>     (sliceChars 1 1 “foo”) ;= “”
>     (sliceChars 1 3 “✅🐎🔋⊓”) ;= “🐎🔋”

If `end` goes over the end of `s`, the slice goes to the end of `s`.

>     (sliceChars 3 100 “foobar”) ;= “bar”

If `start` is greater than `end`, `sliceChars` returns an empty string.

>     (sliceChars 3 1 “foobar”) ;= “”

If either `start` or `end` is negative, they behave the same as a negative index: they count backward from the length of `s`.

>     (sliceChars 2 -1 “foobar”) ;= “oba”
>     (sliceChars -4 -1 “foobar”) ;= “oba”
>     (sliceChars -100 2 “foobar”) ;= “fo”

`(sliceChars start s)` is the same as `(sliceChars start (chars s) s)`.

>     (sliceChars 3 “foobar”) ;= “bar”
>     (sliceChars -1 “foobar”) ;= “r”

`sliceChars` raises a `BadArgs` error if `start` or `end` is not an integer, or if `s` is not a string.

---

    sliceChars:
    (fn* args
      (case= (len args)
        2 (define {start: (0 args) s: (1 args)}
            (assertArgs (integer? start) “start is not an integer”
                        (string? s) “not a string”
                        (p.stringUnicodeSlice start (chars s) s)))
        3 (define {start: (0 args) end: (1 args) s: (2 args)}
            (assertArgs (integer? start) “start is not an integer”
                        (integer? end) “end is not an integer”
                        (string? s) “not an array”
                        (p.stringUnicodeSlice start end s)))
        (assertArgs false “expected 2 or 3 arguments”)))

#### `charIndexOf`

    charIndexOf:
    (fn needle haystack (charIndexOf needle 0 haystack)
      . needle startAt haystack
          (let inUnits (unitIndexOf needle startAt haystack)
            (if (< inUnits 0) inUnits (chars (sliceUnits 0 inUnits haystack)))))

#### `lastCharIndexOf`

    lastCharIndexOf:
    (fn needle haystack (lastCharIndexOf needle (units haystack) haystack)
      . needle startAt haystack
          (let inUnits (lastUnitIndexOf needle startAt haystack)
            (if (< inUnits 0) inUnits (chars (sliceUnits 0 inUnits haystack)))))

#### `charIndexesOf`

    charIndexesOf:
    (fn- needle haystack
      (map (\ chars (sliceUnits 0 _ haystack)) (unitIndexesOf needle haystack)))

### Code Points

_Code points_ are the individual 32-bit Unicode code points of a string, as integers.

#### `codePoint`

    codePoint: (fn- n s (assertArgs (integer? n) “not an integer”
                                    (string? s) “not a string”
                                    (p.stringUnicodeCodePointAt n s)))

#### `codePoints`

    codePoints: chars

#### `toCodePoints`

    toCodePoints:
    (fn- s (makeArray (\ p.stringUnicodeCodePointAt _ s) (codePoints s)))

#### `fromCodePoints`

    ; TODO: Define fromCodePoints

### Bytes

_Bytes_ are the bytes of the UTF-8 representation of a string, as integers between 0 and 255, inclusive.

#### `byte`

    ; TODO: Define byte

#### `bytes`

    ; TODO: Define bytes

#### `toBytes`

    ; TODO: Define toBytes

#### `fromBytes`

    ; TODO: Define fromBytes

### Units

_Units_ are a platform-specific internal representation of a string, as one-character strings that may or may not be valid Unicode characters. On most platforms, including JavaScript and the JVM, units are 16-bit UCS-2 code units that may contain unpaired surrogates.

Operations on units are generally more performant than operations on chars, code points, or bytes.

#### `unit`

`(unit n s)` returns the `n`th platform-dependent code unit in the string `s`, as a one-unit string that is not necessarily a valid Unicode character.

>     (units (unit 0 “foo”)) ;= 1

If `n` is negative, `unit` indexes backward from the end of `s`. If `n` is not a valid index into `s`, `unit` returns an empty string.

`unit` raises a `BadArgs` error if `n` is not an integer or `s` is not a string.

---

    unit: (fn- n s (assertArgs (integer? n) “not an integer”
                               (string? s) “not a string”
                               (p.stringNativeCharAt n s)))

#### `units`

`(units s)` returns the length of the string `s` in platform-dependent code units.

>     (> (units “foo”) 0) ;= true

`units` raises a `BadArgs` error if `s` is not a string.

---

    units: (fn- s (assertArgs (string? s) “not a string”
                              (p.stringNativeLength s)))

#### `toUnits`

`(toUnits s)` converts the string `s` into an array of one-character strings, each of which contains one platform-dependent code unit (which is not necessarily a valid Unicode character).

`toUnits` raises a `BadArgs` error if `s` is not a string.

---

    toUnits: (fn- s (makeArray (\ p.stringNativeCharAt _ s) (units s)))

#### `fromUnits`

`(fromUnits cs)` concatenates the array `cs` of one-unit strings into a single string. A _unit_ is a platform-dependent element of a string that is not necessarily a valid Unicode character. `fromUnits` is the inverse operation of `toUnits`.

>     (fromUnits (toUnits “foo”)) ;= “foo”
>     (fromUnits (toUnits “✅🐎🔋⊓”)) ;= “✅🐎🔋⊓”

`fromUnits` raises a `BadArgs` error if `xs` is not an array. Its return value is undefined if any element of `xs` is not a one-unit string.

---

    fromUnits: (fn- xs (assertArgs (array? xs) “not an array”
                                   (p.stringNativeFromChars xs)))

#### `sliceUnits`

`(sliceUnits start end s)` returns a substring of the string `s`, from `start` (inclusive) to `end` (exclusive), indexed by platform-dependent code units. This substring may contain invalid Unicode characters, such as unpaired surrogates.

>     (sliceUnits 1 1 “foo”) ;= “”
>     (sliceUnits 0 (units “foo”) “foo”) ;= “foo”

If `end` goes over the end of `s`, the slice goes to the end of `s`.

>     (sliceUnits 0 (inc (units “foo”)) “foo”) ;= “foo”

If `start` is greater than `end`, `sliceUnits` returns an empty string.

>     (sliceUnits 2 1 “foo”) ;= “”

If either `start` or `end` is negative, they behave the same as a negative index: they count backward from the length of `s`.

>     (sliceUnits (neg (units “foo”)) (units “foo”) “foo”) ;= “foo”

`(sliceUnits start s)` is the same as `(sliceUnits start (units s) s)`.

>     (= (sliceUnits 1 “foo”) (sliceUnits 1 (units “foo”) “foo”)) ;= true

`sliceUnits` raises a `BadArgs` error if `start` or `end` is not an integer, or if `s` is not a string.

---

    sliceUnits:
    (fn* args
      (case= (len args)
        2 (define {start: (0 args) s: (1 args)}
            (assertArgs (integer? start) “start is not an integer”
                        (string? s) “not a string”
                        (p.stringNativeSlice start (units s) s)))
        3 (define {start: (0 args) end: (1 args) s: (2 args)}
            (assertArgs (integer? start) “start is not an integer”
                        (integer? end) “end is not an integer”
                        (string? s) “not an array”
                        (p.stringNativeSlice start end s)))
        (assertArgs false “expected 2 or 3 arguments”)))

#### `unitIndexOf`

>     (unitIndexOf "bar" "foobarbaz") ;= 3

>     (unitIndexOf "bar" 0 "foobarbaz") ;= 3
>     (unitIndexOf "bar" 3 "foobarbaz") ;= 3
>     (unitIndexOf "bar" 4 "foobarbaz") ;= -1

---

    unitIndexOf:
    (fn* args
      (case= (len args)
        3 (define {needle: (0 args) startAt: (1 args) haystack: (2 args)}
            (assertArgs (string? needle) “not a string”
                        (integer? startAt) “not an integer”
                        (string? haystack) “not a string”
              (p.stringNativeIndexOf needle haystack startAt)))
        2 (unitIndexOf (0 args) 0 (1 args))
        (assertArgs false “expected 2 or 3 arguments”)))

#### `lastUnitIndexOf`

---

    lastUnitIndexOf:
    (fn* args
      (case= (len args)
        3 (define {needle: (0 args) startAt: (1 args) haystack: (2 args)}
            (assertArgs (string? needle) “not a string”
                        (integer? startAt) “not an integer”
                        (string? haystack) “not a string”
              (p.stringNativeLastIndexOf needle haystack startAt)))
        2 (lastUnitIndexOf (0 args) (units (1 args)) (1 args))
        (assertArgs false “expected 2 or 3 arguments”)))

#### `unitIndexesOf`

---

    unitIndexesOf:
    (fn* args
      (case= (len args)
        3 (define {needle: (0 args) startAt: (1 args) haystack: (2 args)}
            (loopAs next {accum: [], i: (unitIndexOf needle startAt haystack)}
              (if (< i 0) accum (next {
                accum: (snoc accum i)
                i: (unitIndexOf needle (inc i) haystack)
              }))))
        2 (unitIndexesOf (0 args) 0 (1 args))
        (assertArgs false “expected 2 or 3 arguments”)))

## Unicode Normalization

### `normalizeNFD`

>     (normalizeNFD "Ç") ;= "Ç"
>     (normalizeNFD "가") ;= "가"

---

    normalizeNFD: (\ assertArgs (string? _) "not a string" (p.stringNFD _))

### `normalizeNFC`

>     (normalizeNFC "Ç") ;= "Ç"
>     (normalizeNFC "가") ;= "가"

---

    normalizeNFC: (\ assertArgs (string? _) "not a string" (p.stringNFC _))

### `normalizeNFKD`

>     (normalizeNFKD "ℍ") ;= "H"
>     (normalizeNFKD "①") ;= "1"
>     (normalizeNFKD "ｶ") ;= "カ"
>     (normalizeNFKD "i⁹") ;= "i9"
>     (normalizeNFKD "¼") ;= "1⁄4"

>     (normalizeNFKD "Ç") ;= "Ç"
>     (normalizeNFKD "가") ;= "가"

---

    normalizeNFKD: (\ assertArgs (string? _) "not a string" (p.stringNFKD _))

### `normalizeNFKC`

>     (normalizeNFKC "ℍ") ;= "H"
>     (normalizeNFKC "①") ;= "1"
>     (normalizeNFKC "ｶ") ;= "カ"
>     (normalizeNFKC "i⁹") ;= "i9"
>     (normalizeNFKC "¼") ;= "1⁄4"

>     (normalizeNFKC "Ç") ;= "Ç"
>     (normalizeNFKC "가") ;= "가"

---

    normalizeNFKC: (\ assertArgs (string? _) "not a string" (p.stringNFKC _))

## Exports

     $export: {
       str toJSON fromJSON emptyString? substring? startWith? endsWith? replace
       splitString trim lines words
       char chars toChars fromChars sliceChars charIndexOf lastCharIndexOf
       charIndexesOf charIndicesOf:charIndexesOf
       codePoint codePoints toCodePoints fromCodePoints
       byte bytes toBytes fromBytes
       unit units toUnits fromUnits sliceUnits unitIndexOf lastUnitIndexOf
       unitIndexesOf unitIndicesOf:unitIndexesOf
       normalizeNFD normalizeNFC normalizeNFKD normalizeNFKC
     }

[☙ Object Operations][prev] | [🗏 Table of Contents][toc] | [Pattern Matching ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: objects.jaspr.md
[next]: pattern-matching.jaspr.md
