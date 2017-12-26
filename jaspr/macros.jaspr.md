[☙ Concurrency and Channels][prev] | [🗏 Table of Contents][toc] | [Number Operations ❧][next]
:---|:---:|---:

# Macros

## Macro Utilities

A few functions are especially useful for generating Jaspr code in macros.

### `quote`

Wraps its argument in the Jaspr quote macro, `""`. Typically used in macros, where including a literal quote in a syntax quote context would prevent an unquote from being evaluated.

>     (quote 42) ;= ["", 42]

    quote: (fn- x ([] "" x))

### `gensym!`

Returns a string that is guaranteed to be unique, distinct from every other string used anywhere in the program. How this is done is implementation-dependent, but the default approach is to generate a random [UUID][uuid].

    gensym!: (fn- (p.gensym!))

`gensym!` is typically used in macros to generate names that are guaranteed not to collide with existing names.

>     (= (gensym!) (gensym!)) ;= false

[uuid]: https://en.wikipedia.org/wiki/Universally_unique_identifier

## Lambda Macros

These remove one level of parens. For example, `(\ foo _)` becomes `(fn _ (foo _))`. The named lambdas `\x`, `\y`, and `\z` allow nesting with different variable names. `\xy` is a two-argument lambda.

    macro.\: (fn* body `[fn- _ ~body])
    macro.\x: (fn* body `[fn- x ~body])
    macro.\y: (fn* body `[fn- y ~body])
    macro.\z: (fn* body `[fn- z ~body])
    macro.\xy: (fn* body `[fn- x y ~body])

## Threading Macros

### `->`

>     (-> 4 (p.add 1) (p.multiply 3)) ;= 15
>     (-> 4 (p.subtract 1) (p.multiply 3)) ;= 9

>     (-> 1 [] []) ;= [[1]]

    macro.->:
    (fn* args
      (assertArgs args "expected one or more arguments"
        (if (= 1 (len args))
            (0 args)
            (define {arg: (0 args) f: (1 args) rest: (tl (tl args))}
              `[-> ~(if (and f (array? f))
                        `[~(hd f) ~arg ~@(tl f)]
                        `[~f ~arg])
                    ~@rest]))))

### `->>`

>     (->> 4 (p.add 1) (p.multiply 3)) ;= 15
>     (->> 4 (p.subtract 1) (p.multiply 3)) ;= -9

>     (->> 1 [] []) ;= [[1]]

    macro.->>:
    (fn* args
      (assertArgs args "expected one or more arguments"
        (if (= 1 (len args))
            (0 args)
            (define {arg: (0 args) f: (1 args) rest: (tl (tl args))}
              `[->> ~(if (and f (array? f)) `[~@f ~arg] `[~f ~arg])
                    ~@rest]))))

### `\->`

    macro.\->: (fn* args `[\ -> _ ~@args])

### `\->>`

    macro.\->>: (fn* args `[\ ->> _ ~@args])

## Miscellaneous Macros

### `comment`

The `comment` macro ignores its arguments and expands to `null`.

>     (comment This is a comment.) ;= null

    macro.comment: (closure {} null)

### `loopAs`

`loopAs` is the idiomatic way to use an inline recursive function as a loop. It takes a function name and an object; the function name and the object's keys are included in the scope, the object is used as the initial argument.

>     (loopAs factorial {n: 5}
>       (if (<= n 1) 1 (mul n (factorial {n: (dec n)})))) ;= 120

    macro.loopAs:
    (fn- name args body
      (assertArgs (string? name) "name (1st arg) is not a literal string"
                  (object? args) "start value (2nd arg) is not an object"
        `[define ~({} name `[closure {}
             (define ~(p.objectMake (fn- k `[~(quote k) (0 $args)]) (keys args))
                     ~body)])
           (~name ~args)]))

### `doTimes`

`(doTimes n body)` executes `body` `n` times.

    macro.doTimes:
    (fn- n body
      `[define {.n.: ~n}
         (if (and (integer? .n.) (>= .n. 0))
             (loopAs next {.n.} (if .n. (do ~body (next {.n.: (dec .n.)}))))
             (raise {
               err: 'BadArgs, why: "not a nonnegative integer", fn: ~(myName),
               args: ~(quote ([] n body))
             }))])

### `unless`

`(unless pred expr)` is equivalent to `(if pred null expr)`.

>     (unless false 42) ;= 42
>     (unless true 42) ;= null

---

     macro.unless: (fn- pred expr `[if ~pred null ~expr])

### `any=?`

`(any=? x y0 y1 ... yn)` is equivalent to `(or (= x y0) (= x y1) ... (= x yn))` (although it does not evaluate `x` more than once).

>     (any=? 20 0 10 20 30) ;= true
>     (any=? 30 0 10 20 30) ;= true
>     (any=? 40 0 10 20 30) ;= false

---

    macro.any=?:
    (fn* args
      (assertArgs args "expected at least one argument"
        (define {x: (gensym!)}
          `[define ~({} x (hd args))
             ~(loopAs next {ys: (tl args)}
                (if (= 1 (len ys))
                    `[= ~x ~(hd ys)]
                    `[or (= ~x ~(hd ys)) ~(next {ys: (tl ys)})]))])))

### `case=`

`(case= value case0 expr0 case1 expr1 ... casen exprn default)` tests each of `case0`...`casen` for equality to `value` using `=`, then evaluates and returns the corresponding `expr` to the first `case` that is equal to `value`.

>     (case= 1 0 'zero 1 'one 2 'two 'other) ;= "one"

If no `case` is equal to `value`, `case=` evaluates and returns `default`.

>     (case= 42 0 'zero 1 'one 2 'two 'other) ;= "other"

If `default` is not present, it is `null`.

>     (case= 42 0 'zero) ;= null

---

    macro.case=:
    (fn* args
      (assertArgs args "expected at least 1 argument"
        (define {v: (gensym!)}
          `[define ~({} v (hd args))
             ~(loopAs cases {exprs: (tl args)}
                (if (no exprs) null
                    (= 1 (len exprs)) (hd exprs)
                      `[if (= ~v ~(0 exprs))
                           ~(1 exprs)
                           ~(cases {exprs: (tl (tl exprs))})]))])))

### `assert`

`(assert predicate err)` raises `err` as a signal if `predicate` is false. `err` is not evaluated if `predicate` is true.

    macro.assert: (fn- p e `[if (no ~p) (raise ~e)])

## Exports

    $export: {
      quote, gensym!, \, \x, \y, \z, \xy, ->, ->>, \->, \->>, comment, loopAs,
      unless, case=, assert,

      λ: \, λx: \x, λy: \y, λz: \z, λxy: \xy, →: ->, ↠: ->>, λ→: \->, λ↠: \->>,
      ⍝: comment
    }

[☙ Concurrency and Channels][prev] | [🗏 Table of Contents][toc] | [Number Operations ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: concurrency.jaspr.md
[next]: numbers.jaspr.md
