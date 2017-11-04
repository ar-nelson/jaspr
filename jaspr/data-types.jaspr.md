_[Prev: Syntax and Semantics ⇦](syntax.jaspr.md) • [Table of Contents](jaspr.jaspr.md) • [⇨ Next: Concurrency](concurrency.jaspr.md)_

    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Data Types

All data in Jaspr, even functions/closures, belongs to one of the six JSON data types. All Jaspr values are immutable, and cannot contain cycles (except for closures).

## Type Predicates

The standard library defines six _type predicates_ to test the type of a value:

    null?:    (fn- x ($equals null x))
    boolean?: (fn- x ($equals “boolean” (type-of x)))
    number?:  (fn- x ($equals “number” (type-of x)))
    string?:  (fn- x ($equals “string” (type-of x)))
    array?:   (fn- x ($equals “array” (type-of x)))
    object?:  (fn- x ($equals “object” (type-of x)))

    doc.null?:    “Returns `true` if its argument is `null`.”
    doc.boolean?: “Returns `true` if its argument is a boolean.”
    doc.number?:  “Returns `true` if its argument is a number.”
    doc.string?:  “Returns `true` if its argument is a string.”
    doc.array?:   “Returns `true` if its argument is an array.”
    doc.object?:  “Returns `true` if its argument is an object.”

>     (null? null)     ;= true
>     (null? true)     ;= false
>     (boolean? true)  ;= true
>     (boolean? null)  ;= false
>     (number? 1)      ;= true
>     (number? “1”)    ;= false
>     (string? “true”) ;= true
>     (string? true)   ;= false
>     (array? [])      ;= true
>     (array? “[]”)    ;= false
>     (object? {})     ;= true
>     (object? [])     ;= false

These are based on the `type-of` function, which returns a string describing the type of a value:

    doc.type-of: “
      Returns a string describing the type of a value.
      The return value is one of `“null”`, `“boolean”`, `“number”`, `“string”`,
      `“array”`, or `“object”`.
    ”
    type-of: (fn- x ($type-of x))

>     (type-of null)  ;= “null”
>     (type-of true)  ;= “boolean”
>     (type-of 91)    ;= “number”
>     (type-of “foo”) ;= “string”
>     (type-of [])    ;= “array”
>     (type-of {})    ;= “object”

## Booleans and Truthiness

The values `null`, `true`, and `false` are the only reserved keywords in Jaspr's syntax.

Technically, all values in Jaspr can be used as booleans (by `$if`, the only special form that uses them). All values are either _truthy_ or _falsy_:

- `null`, `false`, `0`, `NaN`, `“”`, `[]`, and `{}` are falsy.
- All other Jaspr values are truthy.

A value can be converted to its boolean equivalent, based on truthiness, using `true?`:

    doc.true?: “Converts any Jaspr value to a boolean.”
    true?: (fn- x (if x true false))

>     (true? false)   ;= false
>     (true? true)    ;= true
>     (true? null)    ;= false
>     (true? 0)       ;= false
>     (true? 42)      ;= true
>     (true? “”)      ;= false
>     (true? “false”) ;= true
>     (true? [])      ;= false
>     (true? [0])     ;= true
>     (true? {})      ;= false
>     (true? {a: 0})  ;= true

The opposite is `no`, also known as `¬`, `not`, `not?`, or `false?`:

    doc.no: “Logical NOT. Converts any Jaspr value to the opposite of its boolean value.”
    no: (fn- x (if x false true))

>     (no false) ;= true
>     (no true)  ;= false
>     (no [])    ;= true

Logical operations `and?`, `or?`, and `xor?` (`∧`, `∨`, `⊕`) are also available, although the macros `and` and `or` (defined in [Macros](macros.jaspr.md)) are preferred in most cases because they can short-circuit.

    doc.and?:
      “Logical AND. Returns `true` if all of its arguments are truthy.”
    and?: (fn* args (if (no args) true
                        (hd args) (apply and? (tl args))
                                  false))

>     (and?)            ;= true
>     (and? true false) ;= false
>     (and? true true)  ;= true

    doc.or?:
      “Logical OR. Returns `true` if at least one of its arguments is truthy.”
    or?: (fn* args (if (no args) false
                       (hd args) true
                                 (apply or? (tl args))))

>     (or?)             ;= false
>     (or? true false)  ;= true
>     (or? false false) ;= false
    
    doc.xor?:
      “Logical XOR. Returns `true` if an odd number of its arguments is truthy.”
    xor?:
      (fn* args
        (if ($equals 1 (len args))
            (true? (hd args))
            (and? args (apply xor? (cons (no ($equals (0 args) (1 args)))
                                         ($slice-array 2 (len args) args))))))

>     (xor?)             ;= false
>     (xor? true)        ;= true
>     (xor? false)       ;= false
>     (xor? true false)  ;= true
>     (xor? 0 0 1 1 1 0) ;= true
>     (xor? 0 0 1 1 1 1) ;= false

Unicode/emoji names for `true` and `false` are also available.

    doc.✓: "Alias for `true`"
    ✓: true
    doc.✗: "Alias for `false`"
    ✗: false

## Numbers

Jaspr numbers are 64-bit double-precision IEEE floating-point numbers. Because of this, Jaspr has the same limitations as JavaScript in parsing JSON numbers: it cannot parse numbers that are too large to fit in a 64-bit `double`.

Jaspr defines the values `Infinity`, `-Infinity`, and `NaN` in the standard library rather than as part of the syntax.

    doc.Infinity: “The IEEE floating-point value for positive infinity.”
    Infinity: ($infinity)

    doc.-Infinity: “The IEEE floating-point value for negative infinity.”
    -Infinity: ($negate ($infinity))

    doc.NaN: “The IEEE floating-point not-a-number (NaN) value.”
    NaN: ($NaN)

Although there is no syntax for these values, printing them outputs the names defined here (`Infinity`, `-Infinity`, and `NaN`).

Jaspr defines all of the math operations supported by JavaScript, plus a few more; for more information, see [Number Operations](numbers.jaspr.md).

## Strings

Strings are sequences of Unicode characters. Strings may be indexed in four ways:

- By `char`s, individual Unicode characters as one-character strings.
- By `code-point`s, individual Unicode characters as one-character strings.
- By `unit`s, 16-bit UTF-16 code units as one-character strings; individual units may be half of a surrogate pair, in which case they are represented by Unicode Private Use characters.
- By `byte`s, the individual bytes of the UTF-8 representation of the string as numbers.

Most string-processing applications should use chars. Units are the string representation used by most language platforms (JavaScript, JVM, .NET), and Jaspr provides this representation for performance and uses it internally, but it's a bad choice for Unicode text, because it doesn't handle characters outside the BMP well.

Because there are multiple ways to index strings, there are also multiple string length functions: `chars`, `units`, and `bytes`. For these and all other string functions, see [String Operations](strings.jaspr.md).

## Arrays

Arrays are contiguous sequences of values. They are indexed by nonnegative integers, starting at 0.

While the underlying representation of arrays is implementation-dependent, arrays are assumed to be more like _vectors_ than _lists_: indexing into an array and getting the length of an array should be constant-time operations. `len` retrieves the length of an array.

    doc.len: “
      Returns the length of its argument if it is an array; throws an exception
      otherwise.
    ”
    len: (fn- a (if (array? a)
                    ($array-length a)
                    (throw {err: “not an array”, fn: “len”, args: `[~a]})))

>     (len [])       ;= 0
>     (len '[a b c]) ;= 3

Although Jaspr arrays are not linked lists, they still support the basic list operations from other Lisps: `nil?`, `cons`, `hd`, and `tl`. `nil?` tests whether an array is empty, `hd` returns the _head_ (first element) of a non-empty array, `tl` returns the _tail_ (everything but the first element) of a non-empty array, and `cons` combines a head and tail into a new array. `hd`/`tl` are also known as `first`/`rest` or `car`/`cdr`.

    doc.nil?: “Returns `true` if its argument is the empty array.”
    nil?: (fn- a ($equals [] a))

    doc.cons: “
      `(cons head tail)` constructs a new array by appending the value `head`
      to the front of the array `tail`. It throws an exception if `tail` is not
      an array.
    ”
    cons: (fn- head tail (if (array? head)
                             ($array-concat `[~head] tail)
                             (throw {err: “tail is not an array”, fn: “cons”,
                                     args: `[~head ~tail]})))

    doc.hd: “
      Returns the _head_ (first element) of an array. Throws an exception if its
      argument is empty or not an array.
    ”
    hd: 0 ; Yes, it's really that simple.

    doc.tl: “
      Returns the _tail_ (all but the first element) of an array. Throws an
      exception if its argument is empty or not an array.
    ”
    tl: (fn- a (if (no (array? a))
                     (throw {err: “not an array”, fn: “tl”, args: `[~a]})
                   (no a)
                     (throw {err: “array is empty”, fn: “tl”, args: `[~a]})
                   ($array-slice 1 (len a) a)))
    
>     (nil? [])        ;= true
>     (nil? [1])       ;= false
>     (cons 1 [])      ;= [1]
>     (cons 'a '[b c]) ;= [“a”, “b”, “c”]
>     (hd '[a b c])    ;= “a”
>     (tl '[a b c])    ;= [“b”, “c”]
>     (tl '[91])       ;= []

Jaspr's standard library contains dozens of other array functions; see [Array Operations](arrays.jaspr.md).

## Objects

Objects are maps from string keys to values. The ordering of keys is undefined. Core object operations are `keys`, `values`, and `has-key?`, `with-key`, and `without-key`; other operations are defined in [Object Operations](objects.jaspr.md).

    keys:
      (fn- x (if (object? x)
                 ($object-keys x)
                 (throw {err: “not an object”, fn: “keys”, args: `[~x]})))

    values:
      (fn- x (if (object? x)
                 ($object-values x)
                 (throw {err: “not an object”, fn: “values”, args: `[~x]})))

    has-key?:
      (fn- key obj
        (if (no (object? obj))
              (throw {err: “not an object”, fn: “has-key?”, args: ([] key obj)})
            (no (string? key))
              (throw {err: “key is not a string”, fn: “has-key?”,
                      args: ([] key obj)})
            ($object-has key obj)))

    with-key:
      (fn- key val obj
        (if (no (object? obj))
              (throw {err: “not an object”, fn: “with-key”,
                      args: ([] key val obj)})
            (no (string? key))
              (throw {err: “key is not a string”, fn: “with-key”,
                      args: ([] key val obj)})
            ($object-insert key val obj)))

    without-key:
      (fn- key obj
        (if (no (object? obj))
              (throw {err: “not an object”, fn: “without-key”,
                      args: ([] key obj)})
            (no (string? key))
              (throw {err: “key is not a string”, fn: “without-key”,
                      args: ([] key obj)})
            ($object-delete key obj)))

### Closures and Functions

A closure is an object with a `$closure` key. A function is a closure that also has a `$code` key. The `$closure` key contains the closure's scope; calling a function evaluates the function's `$code` in its scope (see [Syntax and Semantics/Functions](syntax.jaspr.md#functions)).

Closures are slightly magic; they are the only values in Jaspr that can contain self-references. Because of this, many recursive algorithms in Jaspr either don't recurse into keys named `$closure` or throw exceptions when they encounter closures, to avoid infinite loops. Notably, evaluation and macroexpansion throw exceptions when they encounter unquoted closures; the `closure` special form provides a safe way to create closures without writing them directly in source code.

The predicates `closure?` and `function?` test whether a value is a closure or function.

### Channel References

A channel reference is an object with `$chan` and `$owner` keys. `$chan` is a number that uniquely identifies a channel (see [Channels](concurrency.jaspr.md#channels)), and `$owner` is a string (usually a UUID) that uniquely identifies the current Jaspr process.

## Equality

---

## Exports

    $export: {
      null?, boolean?, number?, string?, array?, object?, type-of,
      true?, no, ¬: no, not: no, not?: no, false?: no,
      and?, or?, xor?, ∧: and?, ∨: or?, ⊕: xor?,
      ✓, ✗, ✔: ✓, ✘: ✗, ⭕: ✓, ❌: ✗,
      Infinity, -Infinity, ∞: Infinity, -∞: -Infinity, NaN,
      len, nil?, cons, ∅?: nil?,
      hd, head: hd, first: hd, car: hd, tl, tail: tl, rest: tl, cdr: tl,
      keys, values, has-key?, with-key, without-key
    }
