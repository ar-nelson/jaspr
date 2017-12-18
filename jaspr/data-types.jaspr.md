[☙ Syntax and Semantics][prev] | [🗏 Table of Contents][toc] | [Concurrency ❧][next]
:---|:---:|---:

# Data Types

All data in Jaspr, even functions/closures, belongs to one of the six JSON data types. All Jaspr values are immutable, and cannot contain cycles (except for closures).

## Type Predicates

The standard library defines six _type predicates_ to test the type of a value:

    null?:    (fn- x (p.is? null x))
    boolean?: (fn- x (p.is? “boolean” (typeOf x)))
    number?:  (fn- x (p.is? “number” (typeOf x)))
    string?:  (fn- x (p.is? “string” (typeOf x)))
    array?:   (fn- x (p.is? “array” (typeOf x)))
    object?:  (fn- x (p.is? “object” (typeOf x)))

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

These are based on the `typeOf` function, which returns a string describing the type of a value:

    doc.typeOf: “
      Returns a string describing the type of a value.
      The return value is one of `“null”`, `“boolean”`, `“number”`, `“string”`,
      `“array”`, or `“object”`.
    ”
    typeOf: (fn- x (p.typeOf x))

>     (typeOf null)  ;= “null”
>     (typeOf true)  ;= “boolean”
>     (typeOf 91)    ;= “number”
>     (typeOf “foo”) ;= “string”
>     (typeOf [])    ;= “array”
>     (typeOf {})    ;= “object”

## Booleans and Truthiness

The values `null`, `true`, and `false` are the only reserved keywords in Jaspr's syntax.

Technically, all values in Jaspr can be used as booleans (by `jaspr.primitive.if`, the only primitive that uses them). All values are either _truthy_ or _falsy_:

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
>     (true? '[0])    ;= true
>     (true? {})      ;= false
>     (true? {a: 0})  ;= true

The opposite is `no`, also known as `¬`, `not`, `not?`, or `false?`:

    doc.no: “Logical NOT. Converts any Jaspr value to the opposite of its boolean value.”
    no: (fn- x (if x false true))

>     (no false) ;= true
>     (no true)  ;= false
>     (no [])    ;= true

Logical operations `and?`, `or?`, and `xor?` (`∧`, `∨`, `⊕`) are also available, although the macros `and` and `or` (defined in [Special Forms](syntax.jaspr.md#special-forms)) are preferred in most cases because they can short-circuit.

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
        (if (no args) false
            (p.is? 1 (len args)) (true? (hd args))
            (and? args (apply xor? (cons (no (p.is? (true? (0 args)) (true? (1 args))))
                                         (p.arraySlice 2 (len args) args))))))

>     (xor?)             ;= false
>     (xor? true)        ;= true
>     (xor? false)       ;= false
>     (xor? true false)  ;= true
>     (xor? true true)   ;= false
>     (xor? 0 0 1 1 1 0) ;= true
>     (xor? 0 0 1 1 1 1) ;= false

Unicode/emoji names for `true` and `false` are also available.

    doc.✓: “Alias for `true`”
    ✓: true
    doc.✗: “Alias for `false`”
    ✗: false

## Numbers

Jaspr numbers are 64-bit double-precision IEEE floating-point numbers. Because of this, Jaspr has the same limitations as JavaScript in parsing JSON numbers: it cannot parse numbers that are too large to fit in a 64-bit `double`.

Jaspr defines the values `Infinity`, `-Infinity`, and `NaN` in the standard library rather than as part of the syntax.

    doc.Infinity: “The IEEE floating-point value for positive infinity.”
    Infinity: p.Infinity

    doc.-Infinity: “The IEEE floating-point value for negative infinity.”
    -Infinity: p.-Infinity

    doc.NaN: “The IEEE floating-point not-a-number (`NaN`) value.”
    NaN: p.NaN

Although there is no syntax for these values, printing them outputs the names defined here (`Infinity`, `-Infinity`, and `NaN`).

Jaspr defines all of the math operations supported by JavaScript, plus a few more; for more information, see [Number Operations](numbers.jaspr.md).

## Strings

Strings are sequences of Unicode characters. Strings may be indexed in four ways:

- By `char`s, individual Unicode characters as one-character strings.
- By `codePoint`s, individual Unicode characters as one-character strings.
- By `unit`s, 16-bit UTF-16 code units as one-character strings; individual units may be half of a surrogate pair, in which case they are represented by Unicode Private Use characters.
- By `byte`s, the individual bytes of the UTF-8 representation of the string as numbers.

Most string-processing applications should use chars. Units are the string representation used by most language platforms (JavaScript, JVM, .NET), and Jaspr provides this representation for performance and uses it internally, but it's a bad choice for Unicode text, because it doesn't handle characters outside the BMP well.

Because there are multiple ways to index strings, there are also multiple string length functions: `chars`, `units`, and `bytes`. For these and all other string functions, see [String Operations](strings.jaspr.md).

## Arrays

Arrays are contiguous sequences of values. They are indexed by nonnegative integers, starting at 0.

While the underlying representation of arrays is implementation-dependent, arrays are assumed to be more like _vectors_ than _lists_: indexing into an array and getting the length of an array should be constant-time operations. `len` retrieves the length of an array.

    len: (fn- a (assertArgs (array? a) “not an array”
                            (p.arrayLength a)))

>     (len [])       ;= 0
>     (len '[a b c]) ;= 3

Although Jaspr arrays are not linked lists, they still support the basic list operations from other Lisps: `nil?`, `cons`, `hd`, and `tl`. `nil?` tests whether an array is empty, `hd` returns the _head_ (first element) of a non-empty array, `tl` returns the _tail_ (everything but the first element) of a non-empty array, and `cons` combines a head and tail into a new array. `hd`/`tl` are also known as `first`/`rest` or `car`/`cdr`.

    nil?: (fn- a (and (array? a) (no (len a))))

    cons: (fn- head tail (assertArgs (array? tail) “tail is not an array”
                                     (p.arrayConcat `[~head] tail)))

    hd: 0 ; Yes, it's really that simple.

    tl: (fn- a (assertArgs (array? a) “not an array”
                           a          “array is empty”
                           (p.arraySlice 1 (len a) a)))

>     (nil? [])        ;= true
>     (nil? '[1])      ;= false
>     (cons 1 [])      ;= [1]
>     (cons 'a '[b c]) ;= [“a”, “b”, “c”]
>     (hd '[a b c])    ;= “a”
>     (tl '[a b c])    ;= [“b”, “c”]
>     (tl '[91])       ;= []

Jaspr's standard library contains dozens of other array functions; see [Array Operations](arrays.jaspr.md).

## Objects

Objects are maps from string keys to values. The ordering of keys is undefined. Core object operations are `keys`, `values`, and `hasKey?`, `withKey`, and `withoutKey`; other operations are defined in [Object Operations](objects.jaspr.md).

    keys: (fn- x (assertArgs (object? x) “not an object”
                             (p.objectKeys x)))

    values: (fn- x (assertArgs (object? x) “not an object”
                               (p.objectValues x)))

    hasKey?: (fn- key obj (assertArgs (object? obj) “not an object”
                                      (string? key) “key is not a string”
                                      (p.objectHas key obj)))

    withKey: (fn- key val obj (assertArgs (object? obj) “not an object”
                                          (string? key) “key is not a string”
                                          (p.objectInsert key val obj)))

    withoutKey: (fn- key obj (assertArgs (object? obj) “not an object”
                                         (string? key) “key is not a string”
                                         (p.objectDelete key obj)))

>     (keys {}) ;= []
>     (keys {a: 'b}) ;= ["a"]
>     (values {}) ;= []
>     (values {a: 'b}) ;= ["b"]
>     (hasKey? 'a {a: 'b, c: 'd}) ;= true
>     (hasKey? 'b {a: 'b, c: 'd}) ;= false
>     (withKey 'b 2 {a: 1}) ;= {a: 1, b: 2}
>     (withoutKey 'a {a: 1, b: 2}) ;= {b: 2}

## Magic Objects

Jaspr supports 3 kinds of "magic" objects that have special properties beyond what basic JSON data structures provide: _closures_, _channels_, and _dynamic variables_. All three of these data types are still JSON objects, but there are built in functions that distinguish them based on _reference equality_, not just structural equality.

For example, `(chan!)` generates a new channel, which is just the object `{$chan: true}`. However, the channel is a magic object that contains inaccessible internal state; an "identical" object created with the code `{$chan: true}` would not be a channel, and would not be equal to the original channel despite being structurally equal.

A functionally-updated copy of a magic object---created with, e.g., `withKey` or `withoutKey`---is no longer magic. Notably, this means that updating a channel or dynamic variable this way makes the updated version no longer a channel or dynamic variable.

    magic?: (fn- x (p.magic? x))

### Closures and Functions

Every Jaspr process defines a unique, randomly-generated string called a _scope key_, accessible through the name `scopeKey`.

    scopeKey: p.scopeKey

A closure is an object with this scope key. A function is a closure that also has a `$code` key. The scope key contains the closure's scope; calling a function evaluates the function's `$code` in its scope (see [Syntax and Semantics/Functions](syntax.jaspr.md#functions)).

Closures may be magic objects; they are the only values in Jaspr that can contain self-references. Because of this, many recursive algorithms in Jaspr either don't recurse into the scope key or raise errors when they encounter closures, to avoid infinite loops. Notably, evaluation and macroexpansion raise `EvalFailed` errors when they encounter unquoted closures; the `closure` special form provides a safe way to create closures without writing them directly in source code.

Non-magic closures can exist if they are created directly in Jaspr code using object literals or object-building functions. `(closure? x)` does not imply `(magic? x)`.

The predicates `closure?` and `function?` test whether a value is a closure or function.

    closure?: (fn- x (and (object? x) (hasKey? scopeKey x)))
    function?: (fn- x (and (closure? x) (hasKey? “$code” x)))

Jaspr also provides several basic function combinators:

#### `id`

The identity function. Takes 1 argument, and returns its argument unchanged.

>     (id 42) ;= 42

    id: (fn- x x)

#### `const`

`(const x)` returns a function that takes any number of arguments, ignores them, and returns `x`.

>     ((const 42) 'foo)     ;= 42
>     ((const 91) 'bar 'baz) ;= 91

    const: (fn- x (closure {} x))

#### `comp`

`(comp f₀ f₁ … fₙ)` returns the composition of the functions `f₀`…`fₙ`. Composition passes the result of each function to the previous function in the chain: `((comp f g h) x)` = `(f (g (h x)))`.

>     ((comp 1 2) '[[1 2 3], [4 5 6], [7 8 9]]) ;= 8

The last function in a composition chain may take any number of arguments, but the rest should take exactly 1 argument.

>     ((comp nil? cons) 1 []) ;= false

In many cases, the lambda + threading macros `\->` and `\->>` can express function composition more clearly, intuitively, and with better performance than `comp`. `comp` is primarily useful for certain functions, like transducers, whose composition order expresses a natural order of operations.

---

    comp: (fn* fs (if (no fs) id
                      (p.is? 1 (len fs)) (hd fs)
                      (define {f: (hd fs), g: (apply comp (tl fs))}
                           (fn* xs (f (apply g xs))))))

#### `curry`

Takes a function `f` of arity _n_, and returns a function `g` of arity _n - 1_ that returns an unary function such that `(f x₀ x₁ … xₙ)` = `((g x₀ x₁ … xₙ₋₁) xₙ)` for all `x₀`…`xₙ`.

>     (((curry withKey) 'a 42) {}) ;= {a: 42}

If `f` has side effects, calling `g` will not cause those side effects, but calling the function returned by `g` will.

`curry` is the inverse of `uncurry`.

---

    curry:
    (fn- f (fn* prefix (fn- last (apply f (p.arrayConcat prefix ([] last))))))

#### `uncurry`

Takes a _curried_ function `f` of arity _n_ that itself returns an unary function, then returns a new function `g` of arity _n + 1_ such that `((f x₀ x₁ … xₙ) xₙ₊₁)` = `(g x₀ x₁ … xₙ₊₁)` for all `x₀`…`xₙ₊₁`.

>     ((uncurry const) 'x 'y) ;= “x”

`uncurry` is the inverse of `curry`.

---

    uncurry:
    (fn- f (fn* args
      (assertArgs args “uncurried function requires at least 1 argument”
        ((apply f (p.arraySlice 0 (p.subtract (len args) 1) args)) (-1 args)))))

#### `partial`

`(partial f x₀ x₁ … xₙ)` returns a function `g` such that `(g y₀ y₁ … yₘ)` = `((f x₀ x₁ … xₙ) y₀ y₁ … yₘ)`.

>     ((partial withKey 'a 42) {}) ;= {a: 42}
>     ((partial withKey 'b) 42 {}) ;= {b: 42}

---

    partial:
    (fn* fArgs (assertArgs fArgs “no function”
                 (define {f: (hd fArgs), args: (tl fArgs)}
                   (fn* args2 (apply f (p.arrayConcat args args2))))))

### Channels

A channel is a magic object with the property `$chan: true`. Channels are the only mutable values in Jaspr, although their mutable state is inaccessible; they are used to send messages between fibers. Channels and fibers are described in [Concurrency and Channels](concurrency.jaspr.md).

The predicate `chan?` tests whether a value is a channel.

    chan?: (fn- x (p.chan? x))

### Dynamic Variables

While name bindings in Jaspr are [lexically scoped][scope], Jaspr also supports [dynamic scope][scope] via _dynamic variables_. Lexical bindings are taken from the _definition site_ of a closure, while dynamic bindings are taken from the _call site_. Dynamic variables are an advanced feature, not used often in normal code but used internally in core features like signal handling.

A dynamic variable is a magic object with a `$dynamic: true` property and a `$default` property containing the variable's default value. These are created with `dynamic!`, which takes the default value to store in the dynamic variable's `$default` property.

Jaspr has two built-in dynamic variables used in the language's core semantics: `signalHandler` and `name`.

    signalHandler: p.signalHandler
    name: p.name

[scope]: https://en.wikipedia.org/wiki/Scope_(computer_science)#Lexical_scope_vs._dynamic_scope

#### `dynamic!`

`(dynamic! default)` creates and returns a new, unique dynamic variable, with `default` as its default value.

    dynamic!: (fn- default (p.dynamicMake! default))

#### `dynamic?`

Returns a boolean value indicating whether or not its argument is a dynamic variable.

    dynamic?: (fn- dyn (p.dynamic? dyn))

#### `getDynamic`

`(getDynamic dyn)` returns the bound value of the dynamic variable `dyn` in the current scope, or the default value of `dyn` if `dyn` is not bound. `getDynamic` raises a `BadArgs` error if its argument is not a dynamic variable.

>     (getDynamic (dynamic! 42)) ;= 42

    getDynamic:
    (fn- dyn (assertArgs (dynamic? dyn) “not a dynamic variable”
                         (p.dynamicGet dyn)))

#### `letDynamic`

`(letDynamic dyn₀ val₀ dyn₁ val₁ … dynₙ valₙ body)` evaluates `body` with the dynamic variables `dyn₀`…`dynₙ` bound to the corresponding `val`s. `letDynamic` raises a `BadArgs` error if it does not have an odd number of arguments, or if any `dyn` is not a dynamic variable.

>     (define {dyn: (dynamic! null)}
>          (letDynamic dyn 91 (getDynamic dyn))) ;= 91

    macro.letDynamic:
    (fn* xs
      (if (p.< (p.arrayLength xs) 3)
          (assertArgs (p.is? 1 (p.arrayLength xs)) “wrong number of arguments”
                      (0 xs))
          `[p.dynamicLet
             ~(0 xs) // TODO: Raise when (0 xs) is not dynamic
             ~(1 xs)
             (letDynamic ~@(p.arraySlice 2 (p.arrayLength xs) xs))]))

## Indexing and Paths

A _path_ is a sequence of indexes (integers or strings) that identifies an element of a structure composed of nested arrays and/or objects.

### `get`

`(get i0 i1 ... in struct)` returns the element at the path `i0`...`in` in the nested array/object structure `struct`. It is equivalent to `(in (in-1 (... (i1 (i0 struct)))))`.

>     (get      '[[1 2] {a: 3}]) ;= [[1 2] {a: 3}]
>     (get 1    '[[1 2] {a: 3}]) ;= {a: 3}
>     (get 1 'a '[[1 2] {a: 3}]) ;= 3
>     (get 0 0  '[[1 2] {a: 3}]) ;= 1

`get` raises a `BadArgs` error if any of `i0`...`in` is neither an integer nor a string. It raises a `NoKey` error, with a `path` property but no `key` property, if the path does not exist in `struct`.

---

    notFound: `.notFound.
    get:
    (fn* args
      (assertArgs args "expected at least one argument"
        (define {found: (apply getOr (cons notFound args))}
          (if (= found notFound)
              (raise { err: 'NoKey, why: "path not found",
                       path: (init args), in: (last args), fn: (myName) })
              found))))

### `getOr`

    getOr:
    (fn* args
      (assertArgs (<= 2 (len args)) "expected at least two arguments"
        (define {default: (0 args), key: (1 args), struct: (-1 args)}
            (if (= 2 (len args)) struct
                (assertArgs (or (string? key) (integer? key))
                            "path element is not string or integer"
                (if (has? key struct)
                      (apply getOr
                             (cons default (snoc (slice 2 -1 args)
                                                 (key struct))))
                    default))))))

### `has?`

    has?:
    (fn* args
      (assertArgs (<= 2 (len args)) "expected at least two arguments"
        (define {key: (hd args), struct: (-1 args)}
          (assertArgs (or (string? key) (integer? key))
                      "path element is not string or integer"
            (if (= 2 (len args))
                (if (string? key)
                    (and (object? struct) (hasKey? key struct))
                    (and (array? struct)
                         (if (neg? key) (<= (neg key) (len struct))
                                        (< key (len struct)))))
                (and (has? key struct) 
                     (apply has? (snoc (slice 1 -1 args) (key struct)))))))))

### `put`

    put:
    (fn* args
      (assertArgs (<= 2 (len args)) "expected at least two arguments"
        (define {value: (0 args), key: (1 args), struct: (-1 args)}
          (if (= 2 (len args))
                value
              (has? key struct)
                (define { x: (apply put (cons value (snoc (slice 1 -1 args)
                                                       (key struct)))) }
                  (if (array? struct)
                      (cat (take key struct) ([] value) (drop (inc key) struct))
                      (withKey key value struct)))
              (raise { err: 'NoKey, why: "path not found",
                       path: (slice 1 -1 args), in: struct, fn: (myName) })))))

### `delete`

    ; TODO: Define delete

### `update`

    ; TODO: Define update

## Equality

Because all Jaspr values are immutable, Jaspr defines only one kind of equality: deep structural equality. The functions `eq?` and `=` test values for equality; `eq?` is binary, while `=` is variadic.

Magic objects are the only exception to structural equality; they are compared using _reference equality_ instead: if two separate calls to `fn` produce structurally equivalent closures, the closures will still not be considered equal by `eq?` or `=`.

### `eq?`

`(eq? a b)` returns `true` if `a` and `b` are structurally equal, `false` otherwise.

`a` and `b` are only structurally equal if they are of the same basic JSON type.

>     (eq? 1 “1”) ;= false

If `a` and `b` are arrays, they are structurally equal if they are of the same length and, for every index *n*, the *n*th element of `a` is structurally equal to the *n*th element of `b`.

>     (eq? [] []) ;= true
>     (eq? '[1] '[1]) ;= true
>     (eq? '[1] '[1 1]) ;= false
>     (eq? '[1 2 '[3 4]] '[1 2 '[3 4]]) ;= true

If `a` and `b` are objects and **are not magic**, they are structurally equal if they have the same keys and, for every key *k*, the value of *k* in `a` is structurally equal to the value of *k* in `b`.

>     (eq? {} {}) ;= true
>     (eq? {a: 1} {a: 1}) ;= true
>     (eq? {a: 1} {a: 1, b: 1}) ;= false
>     (eq? {a: 1, b: {c: 3, d: 4}} {b: {d: 4, c: 3}, a: 1}) ;= true
>     (eq? (fn- x x) (fn- x x)) ;= false

Otherwise, `a` and `b` are structurally equal if they are identical (reference/value equality).

>     (eq? null null) ;= true
>     (eq? true true) ;= true
>     (eq? true false) ;= false
>     (eq? 42 42) ;= true
>     (eq? 3.14 3.14) ;= true
>     (eq? 1 2) ;= false
>     (eq? “” “”) ;= true
>     (eq? “foo” “foo”) ;= true
>     (eq? “foo” “bar”) ;= false
>     (eq? id id) ;= true
>     (eq? and? or?) ;= false

`NaN` is, notably, the only value that is not equal to itself.

>     (eq? NaN NaN) ;= false

---

    eq?:
    (fn- a b
      (or (p.is? a b)
          (and (array? a) (array? b)
               (p.is? (len a) (len b))
               (define {max: (len a),
                     elEq: (fn- i (or (p.is? i max)
                                      (and (eq? (i a) (i b))
                                           (elEq (p.add i 1)))))}
                    (elEq 0)))
          (and (object? a) (object? b)
               (no (magic? a)) (no (magic? b))
               (define {aks: (keys a), bks: (keys b), max: (len aks),
                     keyEq: (fn- i (or (p.is? i max)
                                       (and (hasKey? (i aks) b)
                                            (hasKey? (i bks) a)
                                            (eq? ((i bks) a) ((i bks) b))
                                            (keyEq (p.add i 1)))))}
                    (and (p.is? (len aks) (len bks)) (keyEq 0))))))

### `=`

Variadic version of `eq?` that returns `true` if all of its arguments are structurally equal to each other, `false` otherwise.

>     (= 1 1) ;= true
>     (= 1 2) ;= false
>     (= '[1 2 3] '[1 2 3] '[1 2 3]) ;= true
>     (= '[1 2 3] '[1 2 3] '[1 2 3 4]) ;= false

`=` always returns `true` if it is passed less than 2 arguments.

>     (= false) ;= true
>     (=) ;= true

See `eq?` for a description of Jaspr's structural equality algorithm.

---

    =: (fn* xs (or (p.< (len xs) 2)
                   (and (eq? (0 xs) (1 xs)) (apply = (tl xs)))))

### `/=`

“Not equal to”.

    /=: (comp no =)

Returns `true` if any of its arguments is not structurally equal to any of the others, `false` otherwise.

>     (/= 1 1) ;= false
>     (/= 1 2) ;= true
>     (/= '[1 2 3] '[1 2 3] '[1 2 3]) ;= false
>     (/= '[1 2 3] '[1 2 3] '[1 2 3 4]) ;= true

`=` always returns `false` if it is passed less than 2 arguments.

>     (/= true) ;= false
>     (/=) ;= false

See `eq?` for a description of Jaspr's structural equality algorithm.

## Exports

    $export: {
      null?, boolean?, number?, string?, array?, object?, typeOf,
      true?, no, ¬: no, not: no, not?: no, false?: no,
      and?, or?, xor?, ∧: and?, ∨: or?, ⊕: xor?,
      ✓, ✗, ✔: ✓, ✘: ✗, ⭕: ✓, ❌: ✗,
      Infinity, -Infinity, ∞: Infinity, -∞: -Infinity, NaN,
      len, length: len, nil?, cons, ∅?: nil?,
      hd, head: hd, first: hd, car: hd, tl, tail: tl, rest: tl, cdr: tl,
      keys, values, hasKey?, withKey, withoutKey,
      magic?, scopeKey, closure?, function?, id, const, comp, curry, uncurry,
      partial, 🆔: id, ∘: comp,
      chan?, dynamic!, dynamic?, getDynamic, letDynamic, signalHandler, name,
      eq?, equal?: eq?, equals?: eq?, =, ==: =, ⩵: =, /=, !=: /=, ≠: /=
    }

[☙ Syntax and Semantics][prev] | [🗏 Table of Contents][toc] | [Concurrency ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: syntax.jaspr.md
[next]: concurrency.jaspr.md
