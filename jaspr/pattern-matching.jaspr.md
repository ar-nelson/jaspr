[☙ String Operations][prev] | [🗏 Table of Contents][toc] | [Signals and Error Handling ❧][next]
:---|:---:|---:

# Pattern Matching

The `case`, `fn`, and `let` macros interpret certain forms as patterns, and match those patterns against values.

## Patterns

`null`, boolean, and number patterns match values equal to themselves, and do not bind any names.

String patterns that are valid names (not containing `.` or any reserved character, and not starting with `$`) match anything, and bind the matched value to the string. The string `“_”` (underscore) does not bind any variables, and can be used to ignore parts of a pattern.

Array patterns of length 2 starting with `“”` (quoted forms) match only values equal to the second element of the pattern, and do not bind any names.

Array patterns whose first element is not `“”` (the quote macro) and which do not contain the string `“...”` match arrays of the same length, after matching each element of the pattern to each element of the array.

Array patterns consisting of _n_ elements, then the string `“...”`, then a string that is a valid name (the _rest name_), match any array of length _n_ or greater and bind all except the first _n_ elements of the array to the rest name, after matching the first _n_ elements of the pattern to the first _n_ elements of the array.

> **ℹ Tip:** Because unquoted strings are normalized (see [Unicode](syntax.jaspr.md#unicode)), the character `U+2026 HORIZONTAL ELLIPSIS (…)` can be used interchangeably with the sequence `...`.

Object patterns match objects containing at least the same keys as the pattern, after matching the values of the pattern to the corresponding values of the object.

All other values are not legal patterns; using an illegal pattern in a pattern-matching macro will raise a `BadPattern` error at macro expansion time.

### Pattern Code Generation Functions

The pattern-matching macros use two internal, unexported functions to generate pattern-matching code: `makePatternTest` and `makePatternBindings`.

    makePatternTest:
    (fn- pat val
      (if (or (null? pat) (boolean? pat) (number? pat))
            `[p.is? ~val ~pat]
          (string? pat)
            true
          (object? pat)
            `[and (object? ~val)
                  (hasKeys? ~@(map quote (keys pat)) ~val)
                  ~@(map (\x makePatternTest (x pat) ([] (quote x) val))
                         (keys pat))]
          (and (= (len pat) 2) (emptyString? (0 pat)))
            `[= ~val ~pat]
          (and (>= (len pat) 2) (= “...” (-2 pat)) (string? (-1 pat)))
            `[and (array? ~val)
                  (>= (len ~val) ~(sub (len pat) 2))
                  ~@(makeArray
                      (\x makePatternTest (x pat) ([] (quote x) val))
                      (sub (len pat) 2))]
          (none? (\ or (= “...” _) (emptyString? _)) pat)
            `[and (array? ~val)
                  (= (len ~val) ~(len pat))
                  ~@(makeArray
                      (\x makePatternTest (x pat) ([] (quote x) val))
                      (len pat))]
          (raise {err: “BadPattern”, pattern: pat})))

    makePatternBindings:
    (fn- pat val
      (define {
        recur: (\->> (map (\x makePatternBindings (x pat) ([] (quote x) val)))
                     (apply merge))
      } (if (or (null? pat) (boolean? pat) (number? pat) (p.is? pat “_”))
              {}
            (string? pat)
              (if (or (emptyString? pat) (substring? “.” pat))
                  (raise {err: “BadPattern”, pattern: pat})
                  ({} pat val))
            (object? pat)
              (recur (keys pat))
            (and (= (len pat) 2) (emptyString? (0 pat)))
              {}
            (and (>= (len pat) 2) (= “...” (-2 pat)) (string? (-1 pat)))
              (->> (indexes pat)
                   (drop -2)
                   recur
                   (withKey (-1 pat) `[drop ~(sub (len pat) 2) ~val]))
            (recur (indexes pat)))))

## `case`

`(case x pat₀ expr₀ pat₁ expr₁ … patₙ exprₙ)` matches each of the patterns `pat₀`…`patₙ` to `x` until one of them matches, then evaluates and returns the corresponding `expr` in a scope where unquoted strings in the pattern are bound to the corresponding elements of `x`. Only one of the `expr`s is evaluated.

>     (case 1
>       0 “no”
>       1 “yes”
>       1 “no”) ;= “yes”

>     (case 42 x x) ;= 42

>     (case '[42] [x] x) ;= 42

>     (case “bar”
>       “foo” “no”
>       “bar” “yes”
>       “baz” “no”) ;= “yes”

>     (case '[1 2 3]
>       []        “no”
>       [1 2 3 4] “no”
>       [1 x y]   `[~x ~y]) ;= [2, 3]

>     (case '[1 2 3]
>       [x … xs] `[~x ~xs]) ;= [1, [2, 3]]

>     (case []
>       [x … xs] “no”
>       []       “yes”) ;= “yes”

>     (case {a: 1, b: 2}
>       {b c} “no”
>       {a b} `[~a ~b]) ;= [1, 2]

>     (case {a: 1, b: 2}
>       {a}   “yes”
>       {a b} “no”) ;= “yes”

>     (case {a: 1, b: 2}
>       {a: 2 b}    “no”
>       {a: 1 b: 3} “no”
>       {a: 1 b}    “yes”) ;= “yes”

`case` raises a `BadArgs` error at macro expansion time if it has an even number of arguments, a `BadPattern` error at macro expansion time if one of `pat₀`…`patₙ` is not a legal pattern, or a `NoMatch` error at runtime if no pattern matches `x`.

---

    macro.case:
    (fn* exprs
      (define {
        valExpr: (hd exprs),
        useLet: (or (array? valExpr) (object? valExpr)),
        val: (if useLet (gensym!) valExpr),
        clauses: (->> (tl exprs)
                      (chunk 2)
                      (mapcat (fn- pair
                        (define {pat: (0 pair), expr: (1 pair)}
                          `[~(makePatternTest pat val)
                            (define ~(makePatternBindings pat val) ~expr)])))),
        ifExpr: `[if ~@clauses (raise {
                    err: “NoMatch”,
                    fn: ~(myName),
                    val: ~val
                  })]
      } (if useLet `[define ~({} val valExpr) ~ifExpr] ifExpr)))

## `fn`

`fn` defines a function using pattern matching. A `fn` form is made up of _clauses_ separated by the string `“.”`. Each clause is zero or more argument patterns, followed by a function body. When the function defined by `fn` is called, the array of arguments is matched against the argument patterns of each clause, in order, until one matches; if no clause matches, a `BadArgs` error is raised.

>     ((fn 42)) ;= 42

>     ((fn x (add 1 x)) 2) ;= 3

>     ((fn 1 'a
>        . 2 'b
>        . 3 'c) 2) ;= “b”

>     (define {
>       recursiveSum: (fn [] 0
>                       . [x … xs] (add x (recursiveSum xs)))
>     } (recursiveSum '[1 2 3 4])) ;= 10

---

    macro.fn:
    (fn* args
      `[fn* .args.
         (case .args.
           ~@(mapcat (fn- pat `[~(init pat) ~(last pat)])
                       (split “.” args))
           args (raise { err: “BadArgs”, why: “no pattern match for arguments”,
                         fn: (myName), args }))])

## `let`

`let` is the sequential, pattern-matching variant of `define`.

`(let pat₀ val₀ pat₁ val₁ … patₙ valₙ body)` evaluates `val₀`…`valₙ` in order, matching each pattern `pat` to the corresponding `val`, with the resulting bindings available when evaluating subsequent `val`s. It then returns the result of evaluating `body` with all bindings from all patterns in scope.

>     (let 42) ;= 42

>     (let x 91
>          x) ;= 91

>     (let [x y z] '[1 2 3]
>          y) ;= 2

>     (let x 1
>          y 2
>          {x y}) ;= {x: 1, y: 2}

>     (let [x … xs] '[1 2 3]
>          {x xs}) ;= {x: 1, xs: [2 3]}

Unlike `define`, `let` does not allow recursive definitions.

`let` raises a `BadArgs` error at macro expansion time if it has an even number of arguments, a `BadPattern` error at macro expansion time if one of `pat₀`…`patₙ` is not a legal pattern, or a `NoMatch` error at runtime if any `val` does not match its corresponding pattern.

---

    macro.let:
    (fn body body
      . pat val … rest
        `[case ~val
           ~pat (let ~@rest)
           .value. (raise { err: “NoMatch”, fn: ~(myName),
                            pattern: ~(quote pat), value: .value. })])

## `awaitLet`

`awaitLet` is a combination of `let` and `await`.

`(awaitLet pat₀ val₀ pat₁ val₁ … patₙ valₙ body)` evaluates `val₀`…`valₙ` in order, matching each pattern `pat` to the corresponding `val`, with the resulting bindings available when evaluating subsequent `val`s.

>     (awaitLet 42) ;= 42

>     (awaitLet x 91
>               x) ;= 91

>     (awaitLet [x y z] '[1 2 3]
>               y) ;= 2

>     (awaitLet x 1
>               y 2
>               {x y}) ;= {x: 1, y: 2}

>     (awaitLet [x … xs] '[1 2 3]
>               {x xs}) ;= {x: 1, xs: [2 3]}

Each `val` is only evaluated after the previous `val` has resolved, as in `await`. Once all `val`s have resolved, `awaitLet` returns the result of evaluating `body` with all bindings from all patterns in scope.

>     (define {c: (chan!)}
>       (do (await (send! 10 c) (send! 20 c) (send! 30 c))
>           (awaitLet {value: x} (recv! c)
>                     {value: y} (recv! c)
>                     {value: z} (recv! c)
>                     ([] x y z)))) ;= [10, 20, 30]

`awaitLet` raises a `BadArgs` error at macro expansion time if it has an even number of arguments, a `BadPattern` error at macro expansion time if one of `pat₀`…`patₙ` is not a legal pattern, or a `NoMatch` error at runtime if any `val` does not match its corresponding pattern.

---

    macro.awaitLet:
    (fn body body
      . pat val … rest
        `[define {.awaitLet.: ~val}
           (await .awaitLet.
                  (case .awaitLet.
                     ~pat (awaitLet ~@rest)
                     _ (raise { err: “NoMatch”, fn: ~(myName),
                                pattern: ~(quote pat), value: .awaitLet. })))])

## Exports

    $export: {case, fn, let, awaitLet, letAwait:awaitLet, 🏷:let}

[☙ String Operations][prev] | [🗏 Table of Contents][toc] | [Signals and Error Handling ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: strings.jaspr.md
[next]: signals-errors.jaspr.md
