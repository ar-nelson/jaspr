`{Jaspr: (JSON Lisp)}`
======================

A new programming language. Jaspr is **minimal**, **functional**, and **concurrent by default**.

```jaspr
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

What?
-----

Jaspr is a functional Lisp, in the style of Clojure. All data in Jaspr is immutable JSON, including Jaspr source code itself. Jaspr's syntax is a superset of JSON, with syntax sugar to make it resemble Lisp code:

| Jaspr | JSON |
|------:|:-----|
| `(+ 1 2)` | `["+", 1, 2]` |
| `{a: b c: d e}` | `{"a": "b", "c": "d", "e": "e"}` |
| `'[1 2 3]` | `["", [1, 2, 3]]` |
| `((“autoquote” yes) [“autoquote” no])` | `[[["", "autoquote"], "yes"], ["autoquote", "no"]]` |
| `null ; comment` | `null` |
| `null // comment` | `null` |

Strings are evaluated as symbols unless they are quoted (the empty string is the quote macro). There is no string/symbol split, because a Jaspr value must be one of the [6 JSON data types][json].

Evaluation is concurrent by default: function arguments and data structure elements have no set evaluation order, but are each evaluated in their own fibers (lightweight threads). This is similar to lazy evaluation in languages like Haskell, except that even unused subexpressions will always be evaluated eventually.

Functions in Jaspr can have side effects, but there are no mutable data structures. Jaspr supports communication between fibers via channels; these are the same kinds of channels used in Go or in Clojure's `core/async`, and they are the only mutable state in the language.

Jaspr source files are modules consisting of a single top-level JSON object, in which each key not starting with `$` is a definition.

[json]: http://json.org/

Why?
----

Jaspr is a hobby project. I created it because I love designing programming languages, and the particular set of features that it has is especially interesting to me. Some of its features (concurrent-by-default evaluation, JSON as the base data structure of a Lisp) are seemingly obvious innovations that I'm genuinely surprised I haven't seen in any non-research language.

I didn't design Jaspr to solve any particular problem, so I'm not sure if it will be useful to anyone yet. I do have some possible future applications for it, but they're more justifications than design goals:

* Building and communicating with JSON-based HTTP APIs
* Big Data processing, with automatic scaling across an arbitrary number of machines in Erlang-like fashion
* Elm-like reactive functional UIs
* Pretty much anything Clojure(script) is used for

How?
----

This project is a reference implementation of a Jaspr interpreter in Node.js and TypeScript. After cloning the repo and installing dependencies with `npm install`, you can run the test suite with

    npm test

, or start a REPL with

    npm run repl

. There is currently no way to run Jaspr code from a file.

Q&A
---

**Q: Is Jaspr production-ready?**

A: Not even close, unfortunately. But you're welcome to try it out, report issues, and make feature requests!

**Q: Is there any documentation yet?**

A: The standard library is written as a literate program, which doubles as Markdown documentation. [You can read it here.][stdlib] It's intended as exhaustive documentation, not a tutorial; my plan is to write a tutorial once Jaspr's basic functionality is finalized. It's also still a WIP; some parts may be unfinished or refer to old features that have been changed/removed.

Notably, all of the code samples in the documentation are also unit tests, so those at least should be guaranteed to work.

[stdlib]: https://github.com/ar-nelson/jaspr/blob/master/jaspr/jaspr.jaspr.md

**Q: Are those... _smart quotes_ in the code samples?**

A: Yes! Extensive, pedantic Unicode support is another feature that I added to Jaspr solely because it interested me. The only other language I know of that does this is Perl 6. Jaspr's Unicode support is described [in the documentation][unicode].

But don't worry. You can write Jaspr in plain ASCII, with ordinary double quote characters, and it will still work. All Unicode function/macro names are just aliases for their ASCII names.

[unicode]: https://github.com/ar-nelson/jaspr/blob/master/jaspr/syntax.jaspr.md#unicode

**Q: Jaspr seems extremely similar to Clojure. Why would I use it instead of Clojure?**

A: Right now, there isn't a good reason; Jaspr is too unfinished. Long-term, I'm still not sure what would motivate an experienced Clojurist to prefer Jaspr, but, if you haven't learned Clojure yet, Jaspr should be much simpler to pick up: fewer concepts to learn, more opinionated, smaller standard library without sacrificing much power. Clojure seems to have several overlapping ways to do everything, with the only benefits being backward compatibility or more fine-tuned control over performance.

There's also an obvious advantage if you're working with JSON: while most programming languages, including Clojure, have some impedance mismatches when converting to JSON because they support additional data structures, everything in Jaspr is JSON. Period.

**Q: If everything is JSON, how do functions and channels work?**

A: I had to fudge the rules a little bit for functions and channels. They, along with [dynamic variable references][dynamic], are _magic objects_, the only exceptions to the “everything is immutable, referentially-transparent JSON” rule.

Magic objects are JSON objects with two special qualities: they can be compared using address equality, and they can't be directly serialized to JSON. Other than that, all operations that work on JSON objects work on magic objects: their type is `object`, and they have keys with values.

Functions are actually still plain JSON, and it's possible to create functions that aren't magic objects, so long as they aren't recursive. Jaspr takes after ultra-minimalistic Lisps like [newLISP][newlisp] and [PicoLisp][picolisp] in that the scope is just another data structure, and closures are just data structures containing a scope and code. However, scopes may contain self-references, thus functions must be unserializable to prevent infinite loops. But they are ordinary JSON objects in every other way, and this opens up interesting metaprogramming possibilities by allowing functions and macros to directly inspect a function's scope or code.

[dynamic]: https://github.com/ar-nelson/jaspr/blob/master/jaspr/data-types.jaspr.md#dynamic-variables
[newlisp]: http://www.newlisp.org/
[picolisp]: https://picolisp.com/

**Q: Isn't concurrent-by-default evaluation terrible for performance?**

A: Not necessarily. While “every expression is evaluated in its own fiber” is a good mental model for Jaspr's semantics, in practice most Jaspr code can still be evaluated synchronously. This reference implementation does just that: the interpreter's `eval` function is a [generator][generator] that yields whenever it encounters an unresolved lazy value, allowing its caller to move on to the next evaluatable subexpression.

The interpreter is still *really* slow, though. That's an unavoidable consequence of writing an interpreter in JavaScript. I'm planning on fixing performance in two ways: by adding a JIT that generates JS source code, and by writing a JS transpiler for production use.

[generator]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Iterators_and_Generators

**Q: Where does the name come from?**

A: LISP = LISt Processing; JaSPR = JSon PRocessing.
