
 JaSPR: JSon PRocessing
========================

Jaspr is:

* A Lisp, with JSON (+ syntax sugar) as its underlying syntax
  * Everything is JSON, even closures. The 6 JSON types are the only data types.
* Almost purely functional
  * All variables and data structures are immutable
  * Functions can still have side effects
* Async by default
  * No fixed execution order unless explicitly ordered
  * Synchronous-looking I/O code becomes async, without callbacks
  * Semi-lazy: Everything is a promise, unused values are still computed but don't block other code
* Concurrent, using Go-style channels
  * All code automatically executes concurrently in fibers
  * Fibers pass messages using channels (think Go)
  * Channels are the only mutable state, making parallelism easy
* Unicode-friendly
  * All string operations are Unicode-aware
  * Syntax supports smart quotes and exotic paren/bracket/brace characters
* Implemented on top of JavaScript
  * Other backends are planned

```jaspr
$schema: “http://adam.nels.onl/schema/jaspr/module”
$module: example
$export: {fib, quicksort}

doc.fib: “Computes the *n*th Fibonacci number.”
fib:
  (fn 0 0
    . 1 1
    . n (+ (fib (- n 1)) (fib (- n 2))))

doc.quicksort: “
  Recursively sorts an array of numbers using the Quicksort algorithm.
”
quicksort:
  (fn []  []
    . [x] ([] x)
    . xs  (let* pivot  (-> xs len (div 2) floor)
                y      (pivot xs)
                choose (fn p x
                         (let {k: (if (< x y) 'lt
                                      (> x y) 'gt
                                      (= x y) 'eq
                                      (raise {err: “NotComparable”, x, y}))}
                              (update (λ cons x _) k p)))
                {lt eq gt} (reduce choose {lt: [], eq: [], gt: []} xs)

                (cat (quicksort lt) eq (quicksort gt))))
```

Jaspr is a personal project, and it's a long way from being usable. I took
inspiration from several existing languages in designing it:

* Clojure – Library design, non-list data structures in Lisp
* [Arc][arc] – Terse syntax for core macros/functions: `if`, `no`, etc.
* JavaScript – JSON, async with event loop
* Erlang – Immutable functional programming in a dynamically-typed language
* Go – Channels, fibers, autoload modules via Git
* [Orc][orc] – Concurrent-by-default evaluation
* Perl 6 – Pedantic Unicode support in syntax and string handling

[arc]: http://www.paulgraham.com/arc.html
[orc]: http://orc.csres.utexas.edu/

## Running Jaspr

Jaspr is still under development. If you want to try it out, after installing
dependencies with `npm install`, you can:

* Run unit tests – `npm test`
* Get a REPL with the standard library – `npm run repl`

The standard library and documentation, as a literate program, can be found in `jaspr/jaspr.jaspr.md`. **The standard library and documentation are currently incomplete.**

## Syntax

Jaspr's syntax is JSON, but with an extra layer of syntax that allows comments
and automatic quoting. 

**Jaspr:**

```jaspr
// C/Java style comments are allowed in Jaspr
/* Including multiline comments */
; Lisp-style comments work too!

;; The outermost level of braces can be omitted.

$schema: "http://adam.nels.onl/schema/jaspr/module"

$module: test ; Strings don't require quotes if unambiguous

$doc: ““Smart quotes” are supported, and they nest!”

$main:
  (do
    ;; Arrays can be written with () instead of []. In a () context, quoted
    ;; strings are surrounded by the quote macro (the empty string).
    (print! “The meaning of life is ” (* 6 7))

    ;; Commas are allowed in lists, but can be omitted.
    (forEach (λx print x) '[“foo”, “bar”, “baz”]))

```

**JSON:**

```json
{
  "$schema": "http://adam.nels.onl/schema/jaspr/module",
  "$module": "test",
  "$doc": "“Smart quotes” are supported, and they nest!",
  "$main": ["do",
    ["print!", ["", "The meaning of life is "], ["*", 6, 7]],
    ["forEach", ["λx", "print", "x"], ["", ["foo", "bar", "baz"]]]]
}
```

## Execution

As in Lisp, lists in Jaspr code are evaluated as function/macro calls. Strings
are treated as symbols and evaluated as variable references; strings must be
quoted to be literal. Numbers, booleans, nulls and objects evaluate as
themselves, although the values of an object are evaluated as code unless the
object is quoted.

Closures in Jaspr are objects with `$closure` keys. Closures are slightly magic;
a closure's scope can contain self-references, unlike all other Jaspr values.
To keep cyclical values from leaking into other parts of the program, the
`$closure` key cannot be converted to JSON.

Functions are closures with a `$code` key. A function is executed when it is the
first element of an evaluated list. The code it contains is evaluated in the
closure's scope, with the call's arguments accessible via the `$args` variable.

The empty string is the quote macro, and `$syntaxQuote`/`$unquote` form a
quasiquote/unquote macro. These shouldn't be used directly in Jaspr syntax,
because standard Lisp quoting syntax is available instead. Numbers and strings
can be called as indexing functions; this is the reverse of the indexing syntax
in Lisps like Arc or newLISP, which use the data structure as the callee
instead.

The arguments of a function call and the values of an object literal are always
evaluated asynchronously, with no guaranteed ordering. To force a sequence of
expressions to be executed sequentially, either create dependencies by defining
bindings with `let`, or use the `await` macro to execute expressions
sequentially.
