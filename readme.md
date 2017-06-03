
 JaSPR: JSon PRocessing
========================

## Syntax

Jaspr's syntax is JSON, but with an extra layer of syntax that allows comments
and automatic quoting. 

**Jaspr:**

    // C/Java style comments are allowed in Jaspr
    /* Including multiline comments */

    {
      module: "test"

      run: (seq

        // Arrays can be written with () instead of []. In a () context, quoted
        // strings are surrounded by the quote macro (null).
        (print-line (str "The meaning of life is " (* 6 7)))

        // Commas are allowed in lists, but can be omitted.
        (for-each (\ x print-line x) '["foo", "bar", "baz"]))
    }

**JSON:**

    {
      "module": "test",
      "run": ["seq",
        ["print-line", ["str", [null, "The meaning of life is "], ["*", 6, 7]]],
        ["for-each", ["\\", "x", ["print-line", "x"]], [null, ["foo", "bar", "baz"]]]]
    }

## Execution

As in Lisp, lists in Jaspr code are evaluated as function/macro calls. Strings
are treated as symbols and evaluated as variable references; strings must be
quoted to be literal. Numbers, booleans, nulls and objects evaluate as
themselves, although the values of an object are evaluated as code unless the
object is quoted.

Closures in Jaspr are objects with `◊scope` keys. Closure scopes are the only
mutable values in Jaspr, and the only values that can contain self-references;
as a result, the `◊scope` key is magical and cannot be directly accessed or
converted to JSON.

Functions are closures with a `fn` key, and macros are closures with a `macro`
key. A closure is executed when it is the first element of an evaluated list.
The code it contains is evaluated in the closure's scope, with the call's
arguments accessible via the `◊args` variable.

`null` is the quote macro, and `true`/`false` form a quasiquote/unquote macro.
(These shouldn't be used directly in Jaspr syntax, because standard Lisp quoting
syntax is available instead.) Numbers and strings are indexing functions, a la
Clojure.

The arguments of a function call and the values of an object literal are always
evaluated asynchronously, with no guaranteed ordering. To force a sequence of
expressions to be executed sequentially, either create dependencies by defining
bindings with `let`, or use the `seq` macro to execute expressions sequentially.

## Core Macros

* quoting: `null`, `true`, `false`, `[false]` -- uses syntax `'`, `` ` ``, `~`, `@~`
* `par`
* `seq`
* `extend-scope`
* `copy-scope`
* `let`
* `if`
* `and`
* `or`
* `fn`
* `\`, `λ`
* `macro`
* `eval`
* `partial`
* `->`

## Core Functions

* `jaspr`
  * `no`
  * `is?`
  * `isnt?`
  * `null?`
  * `boolean?`
  * `print`
* `number`
  * `number?`
  * `parse-number`
  * `-`
  * `+`
  * `*`
  * `div`
  * `mod`
  * `<`
  * `<=`
  * `>`
  * `<=`
  * `floor`
  * `ceil`
  * `round`
  * `int?`
  * `infinite?`
  * `NaN?`
  * `sin`
  * `cos`
  * `tan`
  * `asin`
  * `acos`
  * `atan`
  * `pow`
  * `log`
  * `exp`
* `string`
  * `string?`
  * `str`
  * `strlen`
  * `substr`
  * `char-at`
  * `chars`
  * `char?`
  * `lowercase?`
  * `uppercase?`
  * `letter?`
  * `digit?`
  * `alphanumeric?`
  * `replace`
  * `compare`
  * `starts-with?`
  * `ends-with?`
* `array`
  * `array?`
  * `array`
  * `hd`, `first`
  * `tl`
  * `init`
  * `last`
  * `cons`
  * `snoc`
  * `concat`
  * `slice`
  * `length`
  * `uniq`
  * `uniq?`
  * `contains?`
  * `for`
  * `seq-for`
  * `map`
  * `seq-map`
  * `flatten`
  * `flat-map`
  * `seq-flat-map`
  * `filter`
  * `seq-filter`
  * `all?`
  * `any?`
  * `fold`, `reduce`
  * `fold-left`
  * `fold-right`
  * `split`
  * `zip`
  * `zip-with`
  * `unfold`
* `object`
  * `object?`
  * `has?`
  * `has-value?`
  * `keys`
  * `values`
  * `entries`
  * `assoc`
  * `dissoc`
  * `update`
  * `union`, `merge`
  * `intersect`
  * `difference`
  * `for-entries`
  * `for-keys`
  * `for-values`
  * `map-entries`
  * `map-keys`
  * `map-values`
  * `filter-entries`
  * `filter-keys`
  * `filter-values`
  * `fold-entries`, `reduce-entries`
  * `fold-keys`
  * `fold-values`