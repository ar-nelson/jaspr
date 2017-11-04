
    $schema: “http://adam.nels.onl/schema/jaspr/module”

### `char`

`(char n s)` returns the `n`th Unicode code point in the string `s`, as a one-character string.

`char` throws an exception if it receives too few arguments, if `n` is not an integer or is out of bounds, or if `s` is not a string.

The index `n` may be negative; a negative index counts back from the end of the string.

    char:
      (closure {}
        ($if (integer? (0 $args))
             ($if (string? (1 $args))
                  ($if ($less ))
                                ($unicode-char-at (0 $args) (1 $args))
                                (throw {err: "second argument must be a string",
                                        fn: "char", args: $args}))
                           (throw {err: "first argument must be an integer",
                                   fn: "char", args: $args}))

### `code-point`

`(code-point n s)` returns the `n`th Unicode code point in the string `s`, as a number.

`code-point` throws an exception if it receives too few arguments, if `n` is not an integer or is out of bounds, or if `s` is not a string.

The index `n` may be negative; a negative index counts back from the end of the string.

    code-point: (closure {} $unicode-code-point-at (0 $args) (1 $args)))

### `unit`

`(unit n s)` returns the `n`th UTF-16 code unit in the string `s`, as a one-character string. If the code unit is part of a surrogate pair (and therefore not a valid Unicode character), `unit` returns a placeholder character from the Unicode Private Use area.

`unit` throws an exception if it receives too few arguments, if `n` is not an integer or is out of bounds, or if `s` is not a string.

The index `n` may be negative; a negative index counts back from the end of the string.

    unit: (closure {} ($native-char-at (0 $args) (1 $args)))

### `byte`

    byte: (not-implemented “byte”)

    str to-json from-json empty-string? empty-str?:empty-string?
    print! newline! print-line! println!:print-line! ⏎!:newline!

    byte unit char code-point bytes units chars code-points:chars
    to-bytes to-units to-chars to-code-points
    from-bytes from-units from-chars from-code-points lines words
    for-each-byte for-each-unit for-each-char for-each-code-point
    slice-bytes slice-units slice-chars
    normalize-NFD normalize-NFC normalize-NFKD normalize-NFKC
    upper-case lower-case title-case
    starts-with? ends-with? string-contains? str-contains?:string-contains?
    string-replace str-replace:string-replace trim
    unit-index-of last-unit-index-of char-index-of: last-char-index-of:
    unit-indexes-of unit-indices-of:unit-indexes-of
    char-indexes-of char-indices-of:char-indexes-of
    split-string split-str:split-string
