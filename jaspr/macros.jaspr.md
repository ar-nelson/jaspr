
    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Macros

## Macro Utilities

A few functions are especially useful for generating Jaspr code in macros.

### `quote`

Wraps its argument in the Jaspr quote macro, `""`. Typically used in macros, where including a literal quote in a syntax quote context would prevent an unquote from being evaluated.

>     (quote 42) ;= ["", 42]

    quote: (fn- x ([] "" x))

### `gensym!`

Returns a string that is guaranteed to be unique, distinct from every other string used anywhere in the program. How this is done is implementation-dependent, but the default approach is to generate a random [UUID][uuid].

    gensym!: (fn- ($gensym))

`gensym!` is typically used in macros to generate names that are guaranteed not to collide with existing names.

[uuid]: https://en.wikipedia.org/wiki/Universally_unique_identifier

## Lambda Macros

## Threading Macros

### `->`

### `->>`

### `\->`

### `\->>`

## Miscellaneous Macros

### `comment`

The `comment` macro ignores its arguments and expands to `null`.

>     (comment This is a comment.) ;= null

    macro.comment: (fn- null)

### `loop-as`

### `case=`

### `assert`

`(assert predicate err)` throws `err` as an exception if `predicate` is false. `err` is not evaluated if `predicate` is true.

    macro.assert: (fn- p e `[if (no ~p) (throw ~e)])

## Exports
