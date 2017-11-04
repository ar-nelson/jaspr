
    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Pattern Matching

The `case`, `fn`, and `let*` macros interpret certain forms as patterns, and match those patterns against values.

## Patterns

`null`, boolean, and number patterns match values equal to themselves, and do not bind any names.

String patterns that are valid names (not containing `.` or any reserved character, and not starting with `$`) match anything, and bind the matched value to the string.

Array patterns of length 2 starting with `“”` (quoted forms) match only values equal to the second element of the pattern, and do not bind any names.

Array patterns whose first element is not `“”` (the quote macro) and which do not contain the string `“...”` match arrays of the same length, after matching each element of the pattern to each element of the array.

Array patterns consisting of _n_ elements, then the string `“...”`, then a string that is a valid name (the _rest name_), match any array of length _n_ or greater and bind all except the first _n_ elements of the array to the rest name, after matching the first _n_ elements of the pattern to the first _n_ elements of the array.

> **ℹ Tip:** Because unquoted strings are normalized (see [Unicode](syntax.jaspr.md#unicode)), the character `U+2026 HORIZONTAL ELLIPSIS (…)` can be used interchangeably with the sequence `...`.

Object patterns match objects containing at least the same keys as the pattern, after matching the values of the pattern to the corresponding values of the object.

All other values are not legal patterns; using an illegal pattern in a pattern-matching macro will throw an exception at macro expansion time.

### Pattern Code Generation Functions

The pattern-matching macros use two internal, unexported functions to generate pattern-matching code: `make-pattern-test` and `make-pattern-bindings`.

    make-pattern-test:
      (fn- pat val
        (if (or (null? pat) (boolean? pat) (number? pat))
              `[$equals ~val ~pat]
            (string? pat)
              true
            (object? pat)
              `[and (object? ~val)
                    ~@(map (\x make-pattern-test (x pat) ([] (quote x) val))
                           (keys pat))]
            (and (= 2 (len pat)) (= “” (0 pat)))
              `[$equals ~val ~(0 pat)]
            (and (> 1 (len pat)) (= “...” (-2 pat)) (string? (-1 pat)))
              `[and (array? ~val)
                    (>= (len ~val) ~(- (len pat) 2))
                    ~@(make-array
                        (\x make-pattern-test (x pat) ([] (quote x) val))
                        (- (len pat) 2)]
            (none? (\ or (= “...” _) (= “” _)) pat)
              `[and (array? ~val)
                    ~@(make-array
                        (\x make-pattern-test (x pat) ([] (quote x) val))
                        (len pat))]
            (throw {err: “not a legal pattern”, pattern: pat}))))

    make-pattern-bindings:
      (fn- pat val
        (let {
          recur:
            (\->> (map (\x make-pattern-bindings (x pat) ([] (quote x) val)))
                  (apply merge))
        } (if (or (null? pat) (boolean? pat) (number? pat))
                {}
              (string? pat)
                (if (or (empty-str? pat) (str-contains? “.” pat))
                    (throw {err: “not a legal pattern”, pattern: pat})
                    ({} pat val))
              (object? pat)
                (recur (keys pat))
              (and (= 2 (len pat)) (= “” (0 pat)))
                {}
              (and (> 1 (len pat)) (= “...” (-2 pat)) (string? (-1 pat)))
                (->> (indexes pat)
                     (drop-right 2)
                     recur
                     (with-key (-1 pat) `[drop ~(- (len pat) 2) ~val]))
              (recur (indexes pat)))))

## `case`

`(case x pat₀ expr₀ pat₁ expr₁ … patₙ exprₙ)` matches each of the patterns `pat₀`…`patₙ` to `x` until one of them matches, then evaluates and returns the corresponding `expr` in a scope where unquoted strings in the pattern are bound to the corresponding elements of `x`. Only one of the `expr`s is evaluated.

>     (case 1
>       0 “no”
>       1 “yes”
>       1 “no”) ;= “yes”
>
>     (case 42 x x) ;= 42
>
>     (case '[1 2 3]
>       []        “no”
>       [1 2 3 4] “no”
>       [1 x y]   `[~x ~y]) ;= [2, 3]
>
>     (case '[1 2 3]
>       [x … xs] `[~x ~xs]) ;= [1, [2, 3]]
>
>     (case []
>       [x … xs] “no”
>       []       “yes”) ;= “yes”
>
>     (case {a: 1, b: 2}
>       {b c} “no”
>       {a b} `[~a ~b]) ;= [1, 2]
>
>     (case {a: 1, b: 2}
>       {a}   “yes”
>       {a b} “no”) ;= “yes”

`case` throws an exception at macro expansion time if it has an even number of arguments or if one of `pat₀`…`patₙ` is not a legal pattern; it throws an exception at runtime if no pattern matches `x`.

---

    macro.case:
      (fn* exprs
        (let {
          val-expr: (hd exprs),
          use-let: (or (array? val-expr) (object? val-expr)),
          val: (if use-let (gensym!) val-expr),
          clauses: (->> (tl exprs)
                        (chunk 2)
                        (flat-map (fn- pair
                          (let {pat: (0 pair), expr: (1 pair)}
                            `[~(make-pattern-test pat val)
                              (let ~(make-pattern-bindings pat val) ~expr)])))),
          if-expr: `[if ~@clauses (throw {
                      err: “no pattern matched value”,
                      fn: “case”,
                      val: ~val
                    })]
        } (if use-let `[let ~({} val val-expr) ~if-expr] if-expr)))

## `fn`

`fn` defines a function using pattern matching. A `fn` form is made up of _clauses_ separated by the string `“.”`. Each clause is zero or more argument patterns, followed by a function body. When the function defined by `fn` is called, the array of arguments is matched against the argument patterns of each clause, in order, until one matches; if no clause matches, an exception is thrown.

>     ((fn x (+ 1 x)) 2) ;= 3
>
>     ((fn 1 'a
>        . 2 'b
>        . 3 'c) 2) ;= “b”
>
>     (let {
>       recursive-sum: (fn [] 0
>                        . [x … xs] (+ x (recursive-sum xs)))
>     } (recursive-sum '[1 2 3 4])) ;= 10

---

    macro.fn:
      (fn* args
        `[closure {} (case $args
           ~@(flat-map (fn- pat `[~(quote (init pat)) ~(last pat)])
                       (split “.” args))
           args (throw {err: “no pattern match for arguments”, args}))])

## `let*`

`let*` is the sequential, pattern-matching variant of `let`.

`(let* pat₀ val₀ pat₁ val₁ … patₙ valₙ body)` evaluates `val₀`…`valₙ` in order, matching each pattern `pat` to the corresponding `val`, with the resulting bindings available when evaluating subsequent `val`s. It then returns the result of evaluating `body` with all bindings from all patterns in scope.

>     (let* 42) ;= 42
>
>     (let* x 91
>           x) ;= 91
>
>     (let* [x y z] '[1 2 3]
>           y) ;= 2
>
>     (let* x 1
>           y 2
>           {x y}) ;= {x: 1, y: 2}
>
>     (let* [x … xs] '[1 2 3]
>           {x xs}) ;= {x: 1, xs: [2 3]}

Unlike `let`, `let*` does not allow recursive definitions.

`let*` throws an exception at macro expansion time if it has an even number of arguments or if one of `pat₀`…`patₙ` is not a legal pattern; it throws an exception at runtime if any `val` does not match its corresponding pattern.

---

    macro.let*:
      (fn body body
        . pat val … rest
            `[case ~val ~pat (let* ~@rest)
                        _ (throw {
                            err: “value did not match pattern”,
                            fn: “let*”,
                            pattern: ~(quote pat),
                            value: ~(quote val)
                          })])
