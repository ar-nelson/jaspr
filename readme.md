
 JaSPR: JSon PRocessing
========================

Jaspr is:

* A Lisp, with JSON (+ syntax sugar) as its underlying syntax
  * Everything is JSON, even closures. The 6 JSON types are the only data types.
* Almost purely functional
  * All variables and data structures are immutable
  * Functions can still have side effects
  * Similar to Erlang
* Async by default
  * Has an event loop
  * I/O is automatically non-blocking, without callbacks
  * Code has no execution order unless explicitly ordered
  * Semi-lazy: Everything is a promise, unused values are still computed but possibly out of order
* Concurrent, using an Erlang-like process model
  * All code already executes concurrently, but processes provide error handling and isolation
  * Processes pass messages using channels (think Go)
  * Mutable state is process-local, making parallelism easy
* Implemented on top of JavaScript
  * Other backends are planned

```jaspr
{
  jaspr: "0.0.91"
  module: fibonacci
  export: [fib]
  defs: {
    fib: (defn {
            doc: "Returns the nth Fibonacci number"
          } 0 0
          | 1 1
          | n (* (fib (- n 1)) (fib (- n 2))))
  }
}
```

Jaspr is a personal project, and it's a long way from being usable. I took
inspiration from several existing languages in designing it:

* Clojure – Library design, non-list data structures in Lisp
* [Arc][arc] – Terse syntax for core macros/functions: `if`, `no`, etc.
* JavaScript – JSON, async with event loop
* Erlang – Immutable functional programming, processes with message passing
* Go – Channels, autoload modules via Git
* [Orc][orc] – Concurrent-by-default evaluation

[arc]: http://www.paulgraham.com/arc.html
[orc]: http://orc.csres.utexas.edu/

## Running Jaspr

Jaspr is still under development. If you want to try it out, after installing
dependencies with `npm install`, you can:

* Run unit tests – `npm test`
* Get a REPL with the standard library – `node index.js`

The standard library can be found in `lib/prelude.jaspr`.

## Syntax

Jaspr's syntax is JSON, but with an extra layer of syntax that allows comments
and automatic quoting. 

**Jaspr:**

```jaspr
// C/Java style comments are allowed in Jaspr
/* Including multiline comments */

{
  jaspr: "0.0.91"
  module: "test"
  run: (seq

    // Arrays can be written with () instead of []. In a () context, quoted
    // strings are surrounded by the quote macro (null).
    (print (str "The meaning of life is " (* 6 7)))

    // Commas are allowed in lists, but can be omitted.
    (for-each (λx print x) '["foo", "bar", "baz"]))
}
```

**JSON:**

```json
{
  "jaspr": "0.0.91",
  "module": "test",
  "run": ["seq",
    ["print", ["str", [null, "The meaning of life is "], ["*", 6, 7]]],
    ["for-each", ["λx", "print", "x"], [null, ["foo", "bar", "baz"]]]]
}
```

## Execution

As in Lisp, lists in Jaspr code are evaluated as function/macro calls. Strings
are treated as symbols and evaluated as variable references; strings must be
quoted to be literal. Numbers, booleans, nulls and objects evaluate as
themselves, although the values of an object are evaluated as code unless the
object is quoted.

Closures in Jaspr are objects with `⚙scope` keys. Closures are slightly magic;
a closure's scope can contain self-references, unlike all other Jaspr values.
To keep cyclical values from leaking into other parts of the program, the
`⚙scope` key cannot be directly accessed or converted to JSON.

Functions are closures with a `fn` key. A function is executed when it is the
first element of an evaluated list. The code it contains is evaluated in the
closure's scope, with the call's arguments accessible via the `◊args` variable.

`null` is the quote macro, and `true`/`false` form a quasiquote/unquote macro.
These shouldn't be used directly in Jaspr syntax, because standard Lisp quoting
syntax is available instead. Numbers and strings are indexing functions, a la
Clojure.

The arguments of a function call and the values of an object literal are always
evaluated asynchronously, with no guaranteed ordering. To force a sequence of
expressions to be executed sequentially, either create dependencies by defining
bindings with `let`, or use the `seq` macro to execute expressions sequentially.
