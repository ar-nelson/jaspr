☙ Table of Contents | [🗏 Table of Contents][toc] | [Data Types ❧][next]
:---|:---:|---:

    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Syntax and Semantics

Jaspr is, broadly speaking, a Lisp-like language: function calls are written `(functionName arg₀ arg₁ … argₙ)`, everything is an expression, and the language is [homoiconic][homoiconic] and can rewrite its own syntax via macros.

Jaspr is also based on [JSON][json]. All Jaspr files are JSON documents, and are made up of only the six JSON data types: **null**, **booleans**, **numbers**, **strings**, **arrays**, and **objects**. Jaspr's syntax is an extension of JSON that makes Jaspr files look more like Lisp programs than JSON documents.

[homoiconic]: https://en.wikipedia.org/wiki/Homoiconicity
[json]: http://json.org/

## Extensions to JSON

All JSON is valid Jaspr, but Jaspr adds several syntax extensions to JSON to make it usable as a programming language.

### Comments

Jaspr supports line comments starting with `//`, `;`, or `💭`, and block comments surrounded by `/*`…`*/`. Block comments can nest.

### Unquoted Strings

If a string does not contain any special characters (whitespace, parentheses, brackets, braces, quotes, commas, colons, semicolons), it can be written without quotes: `[foo, bar]` = `["foo", "bar"]`.

If the comment tokens `//` or `/*` occur anywhere in an unquoted string except the beginning, they will be part of the string, and will not start a comment.

### Commas

Commas can be omitted in arrays and objects: `[foo bar]` and `{a: 1 b: 2}` are both legal. However, `[foo bar, baz]` is not legal; a form must contain either *all* of its commas or *none* of them.

Trailing commas are allowed, as in Javascript, so `[foo, bar, baz,]` is legal.

### Object Punning

An object key `x` without a value will become `x: x`. This mimics JavaScript's [ES2015 enhanced object literal syntax][es2015]: `{a: b, c, d}` = `{a: b, c: c, d: d}`.

[es2015]: https://babeljs.io/learn-es2015/#ecmascript-2015-features-enhanced-object-literals

### Quoting

The prefix operator `'` (single quote/apostrophe) wraps a form in an array whose first element is the empty string: `'[1 2 3]` = `["" [1 2 3]]`. The empty string is Jaspr's quote macro, which prevents a form from being evaluated; this is the same as the `quote` special form found in most Lisps.

### Syntax Quoting

The prefix operator `` ` `` (backtick/backquote) wraps a form in an array whose first element is the string `$syntaxQuote`. The operators `~` and `~@` do the same for `$unquote` and `$unquoteSplicing`, respectively. These form a _quasiquotation_ macro modeled on Clojure's [syntax quote][syntax-quote].

[syntax-quote]: https://clojure.org/reference/reader#syntax-quote

### Parentheses

Parentheses may be used instead of square brackets in arrays: `(1 2)` = `[1 2]`. This makes Jaspr code look like Lisp code, but it also marks a distinction between code and data that includes a difference in parsing behavior.

Inside parenthesized arrays, quoted strings are also quoted in the Lisp sense, but unquoted strings are not:

- `(print "foo")` = `(print 'foo)` = `[print 'foo]` = `[print ["", "foo"]]`,
- but `(print "foo")` ≠ `(print foo)`

In this context, unquoted strings function like symbols in Lisp, while quoted strings are actual strings.

Square brackets switch the parsing behavior back to normal. Objects inherit the parsing behavior of the innermost surrounding array. The quoted/unquoted distinction does not apply to object keys.

- `([foo "bar"])` = `[["foo", "bar"]]`
- `[(foo "bar")]` = `[["foo", ["", "bar"]]]`
- `{"a": "b", c: d}` = `{"a": "b", "c": "d"}`
- `({"a": "b", c: d})` = `[{"a": ["", "b"], "c": "d"}]`
- `([{"a": "b", c: d}])` = `[[{"a": "b", "c": "d"}]]`

### Top-level Object

If the top-level form in a Jaspr file is an object, the outermost braces can be omitted.

### Unicode

Jaspr has extensive (perhaps excessive) Unicode support in its syntax:

- All Unicode whitespace characters are treated as whitespace by the parser.
- Unquoted strings are NFKC normalized.
- The small and fullwidth forms of all reserved characters are interchangeable with the ASCII forms.
- All kinds of international smart quotes are supported as string quotes. Smart quotes can nest when they are unambiguous.
   - `“`…`”`, `”`…`”`, `”`…`“`, `„`…`“`, `„`…`”`
   - `‘`…`’`, `’`…`’`, `’`…`‘`, `‚`…`‘`, `‚`…`’`
   - `«`…`»`, `»`…`«`, `»`…`»`
   - `‹`…`›`, `›`…`‹`
   - `｢`…`｣`, `「`…`」`, `『`…`』`
   - `《`…`》`, `〈`…`〉`
   - `〝`…`〞`, `〟`…`〝`, `〟`…`〞`
- Various Unicode grouping characters can be used as parentheses, brackets, or braces. These aren't just individual character equivalences; the opening and closing characters still need to match.
   - Parens: `()`, `⦅⦆`, `⸨⸩`, `﴾﴿`, `（）`, `﹙﹚`, `【】`, `｟｠`
   - Brackets: `[]`, `⟦⟧`, `⦋⦌`, `⦍⦎`, `⦏⦐`, `⁅⁆`, `［］`, `〚〛`, `〖〗`, `⟨⟩`, `⟪⟫`, `〈〉`, `⦑⦒`, `⧼⧽`
   - Braces: `{}`, `⦃⦄`, `⟬⟭`, `⦗⦘`, `｛｝`, `﹛﹜`, `〔〕`, `﹝﹞`, `〘〙`
- Other reserved punctuation characters have Unicode equivalents, too:
   - Commas: `﹐` `，` `՝` `،` `、` `﹑` `､`
   - Colons: `﹕` `：`
   - Semicolons: `﹔` `；` `؛`
   - Syntax quote: `⸢`…`⸣` for syntax quote and `⸤`…`⸥` for unquote can be used instead of `` ` ``/`~`; the Unicode versions are opening/closing pairs instead of prefix operators.

## Macro Expansion

The first step in execution of Jaspr code is macro expansion: transforming Jaspr code by calling functions (_macros_) that take unevaluated Jaspr forms as arguments and return new Jaspr forms that replace the original macro call. Macro expansion continues recursively until a fixed point is reached.

### Unexpanded Values

Strings, numbers, booleans, `null`, the empty array, the empty object, and quoted forms all expand to themselves.

>     (macroexpand null)       ;= null
>     (macroexpand true)       ;= true
>     (macroexpand false)      ;= false
>     (macroexpand 1)          ;= 1
>     (macroexpand "foo")      ;= "foo"
>     (macroexpand [])         ;= []
>     (macroexpand {})         ;= {}
>     (macroexpand '["", foo]) ;= ["", "foo"]

### Macro Application

An array whose first element is a string is expanded as a _macro application_ if the array's first element is a name bound in the current scope's `macro` context. The name must be bound to a function, or an error will be raised. The function is called with the tail of the array, unevaluated, as its arguments; its return value becomes the result of the macro application.

Given the macro binding

    macro.add1: (fn- x (p.add 1 x))

, the application of `add1` to a number will expand to the successor of that number.

>     (macroexpand '(add1 2)) ;= 3

Macro expansion is recursive; after macro application has occurred, the result will be expanded again.

    macro.makeAdd1: (fn- '(add1 3))

>     (macroexpand '(makeAdd1)) ;= 4

### Recursive Expansion

If an array can not be expanded as a macro application, it expands to the macro expansion of its elements. The elements are expanded concurrently, in no particular order.

>     (macroexpand '[1 2 3]) ;= [1, 2, 3]
>     (macroexpand '[(add1 1) ["foo" (add1 2)]]) ;= [2, ["foo", 3]]

Non-closure objects also expand to the macro expansion of their values. The values are expanded concurrently, in no particular order.

>     (macroexpand '{a: 1, b: 2}) ;= {a: 1, b: 2}
>     (macroexpand '{a: (add1 1), b: (add1 2)}) ;= {a: 2, b: 3}

Attempting to expand a closure raises an `EvalFailed` error.

### Closures and Pre-expansion

The `closure` [special form](#special-forms) evaluates to a closure, and its first argument is new bindings to include in the closure's scope. These new bindings may include macro definitions which cannot be known until evaluation time. However, most uses of `closure` do not define macros, and this allows Jaspr to perform an optimization called _pre-expansion_: if a closure does not define any new macros, its code (the second argument of `closure`) is expanded as though it were still part of the outer scope.

In most cases, this looks exactly like expanding any other array, except that part of the expansion order is consistent (the first argument must be fully expanded before the second).

In the suboptimal case where a closure defines new bindings in the `macro` context, its code is left unexpanded. Later, when the `closure` form is evaluated, the fully-evaluated macro bindings will be available and its code will be macroexpanded before being evaluated.

## Evaluation

After macro expansion, code is evaluated. While macro expansion occurs only once, the same code may be evaluated more than once in different scopes.

### Literals

Numbers, booleans, `null`, the empty string, the empty array, and the empty object all evaluate to themselves.

>     null  ;= null
>     true  ;= true
>     false ;= false
>     1     ;= 1
>     ""    ;= ""
>     ()    ;= []
>     {}    ;= {}

### Names

Non-empty strings are evaluated as _names_ and looked up in the current scope. Given the value binding

    example: 42

, the string `"example"` will evaluate to its bound value, `42`.

>     "example" ;= 42

Attempting to look up an unbound name will raise a `NoBinding` error.

### Calls

A non-empty array is a call. The first element is the _callee_, and the rest are the _arguments_. In most cases (except for a few special forms), all of the elements of the array are evaluated. Evaluation of elements is _concurrent_ (with no particular ordering) and _asynchronous_—the call can start evaluating as soon as the callee has finished evaluating, even if the arguments have not.

#### Functions

If the callee evaluates to a _function_ (a closure with a `$code` key), the contents of the function's `$code` key are evaluated in the scope contained in the function's scope key, with the arguments bound to the special name `$args`.

Because the scope key is unique to each Jaspr process, literal closures cannot be written directly in source code. The special form `closure` defined in this file can create closures; it takes a scope and the closure's code.

>     ((closure {} 91))          ;= 91
>     ((closure {x: 42} x))      ;= 42
>     ((closure {} $args) 1 2 3) ;= [1 2 3]

#### Constructors

If the callee evaluates to the empty array `[]` or the empty object `{}`, it is an array or object _constructor_. `[]` constructs an array from its arguments, while `{}` expects an even number of arguments, alternating between keys and values, and constructs an object from the key/value pairs.

>     ([] 1 2 3)     ;= [1 2 3]
>     [[[]]]         ;= []
>     ({} 'a 1 'b 2) ;= {a: 1, b: 2}
>     ({})           ;= {}

`{}` raises a `BadArgs` error if it receives an odd number of arguments or if any of the key arguments are not strings.

#### Indexing

If the callee evaluates to a number or a string, it is evaluated as an _index_ into the first argument. This is a syntactic shortcut borrowed from Clojure, which borrowed it from Arc. Arrays are 0-indexed.

>     (0 '[a b c])      ;= "a"
>     (1 '[a b c])      ;= "b"
>     (2 '[a b c])      ;= "c"
>     ('a {a: 1, b: 2}) ;= 1
>     ('b {a: 1, b: 2}) ;= 2

Negative indexes are supported; these count backward from the end of an array.

>     (-1 '[a b c]) ;= "c"
>     (-3 '[a b c]) ;= "a"

A `BadArgs` error is raised if:
- The number of arguments is not exactly one
- The first argument is not an array or object
- The index does not exist in the array/object
- The index is a non-integer number

#### Other Call Types

The empty string `""` is the quote special form (see [Quoting](#quoting)); it returns its first argument unevaluated, and raises a `BadArgs` error if it does not have exactly one argument.

>     ["", "foo"] ;= "foo"

If the callee (before evaluation) is a string that starts with `$`, the call is a special form, and its semantics depend on which form it is; see [Special Forms](#special-forms).

If the callee evaluates to anything else (`null`, `true`, `false`, an array, or a non-closure object), a `NotCallable` error is raised.

### Object Literals

A non-closure object evaluates to an object with the same keys, and with its values evaluated.

>     {a: ([] 1 2), b: (1 '[foo bar])} ;= {a: [1, 2], b: "bar"}

## Reserved Names

All reserved names in Jaspr start with the `$` character. It is not possible to define new names starting with this character, and attempting to evaluate a name starting with `$` as anything other than the callee of a special form (except for the special name `$args`) will raise a `NoBinding` error.

Each Jaspr implementation provides its own primitive special forms that start with `$`, which are used to implement the `jaspr.primitive` module. **These special forms should never be used directly in production Jaspr code.**  Except for `$syntaxQuote`, `$unquote`, and `$unquoteSplicing`, they are intentionally undocumented, and may change between Jaspr implementations and versions. Calling a name starting with `$` that is not available in the current Jaspr implementation will raise a `NoPrimitive` error.

## Special Forms

Jaspr's core syntax is made up of several _special forms_ with unique evaluation behavior. Most of these are enhanced versions of the primitive operations provided by the `jaspr.primitive` module, imported here as `p`:

    $import: {p: jaspr.primitive}

### `closure`

`(closure bindings code)` constructs a function that closes over the current scope. `bindings` is an object containing bindings to add to the function's scope (this is how `let` is implemented), and `code` is the function's code, which is not evaluated.

`closure` is a low-level special form; the forms `let`, `fn`, and `fn*` cover most practical uses of it, and should be used instead of `closure` in most situations.

    macro.closure: (p.closure {} `[p.closure ~(0 $args) ~(1 $args) {}] {})

### `raise`

Raises a signal, by calling the function stored in the dynamic variable `jaspr.primitive.signalHandler`. The signal handler may return a value to resume from the `raise` call; this value will become the return value of `raise`.

    raise: (closure {} ((p.dynamicGet p.signalHandler) (0 $args)))

### `myName`

Macro that becomes the fully-qualified name that it is currently being evaluated in. The value of `myName` is set by closure scopes (`let` bindings) and top-level bindings.

>     ((closure {foo: (myName)} foo)) ;= “foo”

    macro.myName: (closure {} ([] “” (p.dynamicGet p.name)))

### `assertArgs`

`(assertArgs assertion₀ msg₀ assertion₁ msg₁ … assertionₙ msgₙ body)` is a convenience macro used throughout the standard library to raise a `BadArgs` error if the arguments of a function do not meet certain requirements. Each `assertion` is evaluated, and, if any `assertion` evaluates to a falsy value, a `BadArgs` error is raised with the corresponding `msg` as the value of its `why` property. If all `assertion`s evaluate to truthy values, `body` is evaluated and returned.

    macro.assertArgs:
    (closure {}
      (p.if (p.< (p.arrayLength $args) 3)
            (0 $args)
            `[p.if ~(0 $args)
                   (assertArgs ~@(p.arraySlice 2 (p.arrayLength $args) $args))
                   (raise {
                     err: 'BadArgs, why: ~(1 $args), fn: (myName),
                     args: ~argsName
                   })]))

`assertArgs` uses a special gensym'd variable name, `argsName`, to access the containing function's arguments in order to include an `args` key in the errors it raises. All of the standard library's function-definition macros (`fn*`, `fn-`, and `fn`) set this variable.

    argsName: `.args.

Using `assertArgs` in a function defined directly via `closure` may raise a `NoBinding` error.

### `fn*`

`(fn* args body)` creates a function that takes a variable number of arguments; `body` is the body of the function, and `args` is the name that the array of arguments is bound to.

>     ((fn* xs (1 xs)) 'a 'b 'c) ;= “b”

    macro.fn*:
    (closure {}
      (p.if (p.is? 2 (p.arrayLength $args)) 
        (p.if (p.is? 'string (p.typeOf (0 $args)))
          `[closure {} ((closure ~({} argsName '$args (0 $args) '$args)
                                 ~(1 $args)))]

Due to a bootstrapping problem, `fn*`'s definition uses cumbersome `if` statements for argument checks instead of the simpler `assertArgs` macro. `assertArgs` expects the name stored in the binding `argsName` to be bound to the arguments of its surrounding function, but this binding must occur in a macro (because `argsName` is a variable containing a variable name), and no macro is yet defined that binds `argsName`. `fn*` provides this binding for future macro definitions.

          (raise { err: 'BadArgs, why: “fn* argument name must be a string”,
                   fn: (myName), args: $args }))
        (raise { err: 'BadArgs, why: “fn* takes exactly 2 arguments”,
                fn: (myName), args: $args })))

### `let`

`(let {name₀: x₀, name₁: x₁, … nameₙ: xₙ} body)` evaluates `body` in a scope in which the names `name₀`…`nameₙ` are bound to the values `x₀`…`xₙ`. It is equivalent to creating a new function with the bindings, then immediately calling the function.

>     (let {x: 1} x) ;= 1
>     (let {x: (let {y: 2} y)} x) ;= 2
>     (let {a: 1, b: 2} ([] a b)) ;= [1, 2]

Bindings are evaluated recursively: the value of each binding is evaluated in a scope containing all of the bindings.

>     (let {a: b, b: c, c: 3} a) ;= 3

Context prefixes are allowed, but the only supported contexts are `value`, `macro`, and `check`.

>     (let {macro.app: (closure {} ([] (0 $args) (1 $args)))}
>          (app 1 '[a b])) ;= “b”

---

    macro.let:
    (fn* args
      (assertArgs
        (p.is? 2 (p.arrayLength args)) “let takes exactly 2 arguments”
        (p.is? 'object (p.typeOf (0 args))) “let bindings must be an object”
        `[(closure ~(0 args) ~(1 args))]))

### `if`

A multi-clause conditional expression. `(if predicate thenCase elseCase)` evaluates and returns `thenCase` if `predicate` is truthy, or `elseCase` if `predicate` is falsy. Only one of the branches is evaluated.

>     (if true “t” “f”)  ;= “t”
>     (if false “t” “f”) ;= “f”

If `else` is missing, it defaults to `null`.

>     (if false “t”) ;= null

An `if ` form may contain multiple cases: `(if pred₀ then₀ pred₁ then₁ … predₙ thenₙ else)` evaluates `pred₀`…`predₙ` in order until one evaluates to a truthy value, then evaluates the corresponding `then`.

>     (if false 0
>         false 1
>         true  2
>         true  3
>               4) ;= 2

If no `pred` evaluated to a truthy value, `else` is evaluated. If `else` is missing, it defaults to `null`.

>     (if false 0
>         false 1
>               2) ;= 2
>     (if false 0
>         false 1) ;= null

---

    macro.if:
    (fn* argv
      (let {argc: (p.arrayLength argv)}
        `[$if ~(0 argv) ~(1 argv)
              ~(p.if (p.< argc 4)
                     (p.if (p.is? argc 3) (2 argv) null)
                       `[if ~@(p.arraySlice 2 argc argv)])]))

### `and`

`(and expr₀ expr₁ … exprₙ)` evaluates `expr₀`…`exprₙ` until one `expr` evaluates to a falsy value, then returns that.

>     (and true false) ;= false
>     (and 1 2 0 3) ;= 0

If no `expr` evaluates to a falsy value, `and` evaluates to the last `expr` in its argument list.

>     (and true true) ;= true
>     (and 1 2 3) ;= 3

`and` is a short-circuiting macro: if one of its arguments evaluates to a falsy value, the rest of the arguments will not be evaluated.

---

    macro.and:
    (fn* exprs
      (let {l: (p.arrayLength exprs)}
        (if (p.is? l 1) (0 exprs)
            exprs `[let {.x.: ~(0 exprs)}
                        (if .x. (and ~@(p.arraySlice 1 l exprs)) .x.)]
                   true)))

### `or`

`(or expr₀ expr₁ … exprₙ)` evaluates `expr₀`…`exprₙ` until one `expr` evaluates to a truthy value, then returns that.

>     (or true false) ;= true
>     (or 0 false 1 []) ;= 1

If no `expr` evaluates to a truthy value, `or` evaluates to the last `expr` in its argument list.

>     (or false false) ;= false
>     (or 0 null {}) ;= {}

`or` is a short-circuiting macro: if one of its arguments evaluates to a truthy value, the rest of the arguments will not be evaluated.

---

    macro.or:
    (fn* exprs
      (let {l: (p.arrayLength exprs)}
        (if (p.is? l 1) (0 exprs)
            exprs `[let {.x.: ~(0 exprs)}
                        (if .x. .x. (or ~@(p.arraySlice 1 l exprs)))]
                   false)))

### `fn-`

Like `fn`, but does not support pattern matching on its argument names (read the name as “`fn` minus”). This macro is used internally by the standard library, for defining functions before pattern matching is available. **There is almost never a reason for code outside the standard library to use `fn-` instead of `fn`**.

`(fn- arg₀ arg₁ … argₙ body)` creates a function that takes a fixed number of arguments, where `body` is the body of the function and `arg₀`…`argₙ` are the names that the function's arguments are bound to.

>     ((fn- 42)) ;= 42
>     ((fn- x ([] x)) 42) ;= [42]
>     ((fn- index array (index array)) 1 '[a b c]) ;= “b”

The resulting function raises a `BadArgs` error if it is called with a different number of arguments than it was defined with.

---

    macro.fn-:
    (fn* fnArgs
      (let {arity: (p.subtract (p.arrayLength fnArgs) 1)}
        (assertArgs (p.<= 0 arity) “no function body”
          (let {
            loop: (fn* args
                    (let {i: (0 args), scope: (1 args)}
                      (if (p.is? i arity)
                          scope
                          (loop (p.add i 1)
                                (p.objectInsert (i fnArgs) `[~i ~argsName] scope)))))
          } `[closure {}
               (let ~({} argsName '$args)
                 (assertArgs
                   (p.is? (p.arrayLength ~argsName) ~arity)
                     ~([] “” (p.stringConcat “expected ”
                                (p.stringConcat (p.toString arity) “ argument(s)”)))
                     (let ~(loop 0 {}) ~(-1 fnArgs))))]))))

### `macroexpand`

Macro expands its argument in the current scope.

    macro.macroexpand: (fn- code `(p.macroexpand ~code))

>     (let {macro.to42: (fn- x 42)} (macroexpand '(to42 x))) ;= 42

### `eval`

Evaluates its argument in the current scope. Note that `eval` performs evaluation _without_ macro expansion.

    macro.eval: (fn- code `(p.eval ~code))

>     (let {to42: (fn- x 42)} (eval '(to42 null))) ;= 42

### `apply`

`(apply callee args)` calls the value `callee` with the arguments array `args`. Raises a `NotCallable` error if `callee` is not callable, or a `BadArgs` error if `args` is not an array.

>     (apply {} '[a 1 b 2]) ;= {a: 1, b: 2}

    apply:
    (fn- callee args
      (assertArgs (p.is? 'array (p.typeOf args)) "not an array"
        (p.apply callee args)))

### `contextGet`

Looks up a name in the current scope, in a context other than the default (`value`). For example, `(contextGet macro foo)` returns the macro `foo`.

>     (let {macro.to42: (fn- x 42)} ((contextGet macro to42) null)) ;= 42

    macro.contextGet: (closure {} `[p.contextGet ~(0 $args) ~(1 $args)])

### Other Special Forms

`do`, `await`, `awaitAll`, `choice`, `chan!`, `send!`, `recv!`, `close!`, and `closed?` are part of the core language; these deal with concurrency, channels, and message passing, and are defined in [Concurrency and Channels](concurrency.jaspr.md).

`fn`, `case`, `let*`, `catch`, and `resume` are also core parts of Jaspr syntax; these are defined in [Pattern Matching](pattern-matching.jaspr.md).

## Naming Conventions

All alphanumeric names in Jaspr should be `camelCase`. Acronyms should be all-caps (`fromJSON`, not `fromJson`) except when the acronym is the first word (`jsonObject`, not `JSONObject`). Initial capital letters in names are reserved for future extensions to the language, such as a type system; initial capitals are only used in a few places in the standard library for compatibility purposes (e.g., `Infinity` and `NaN`).

Try to balance terseness and readability. Names need not be excessively verbose for clarity; common abbreviations, such as `len` for length or `str` for string, are acceptable, but be consistent in the usage of these abbreviations.

Functions that return boolean values should have names ending in `?` (except for symbolic names like `<` and a few special cases like `no`).

Functions that have side effects or whose output is not 100% determined by their input should have names ending in `!`. This includes functions like `currentTimeMs!`, which does not have side effects but is not purely functional either. If a function calls a function ending in `!`, then its name should almost always end in `!`, unless the side effects are contained in such a way that the function's effects appear pure.

If a function name has multiple suffixes, `?` should appear before `!`.

Most symbolic names should have an alphanumeric alternative (e.g., `eq?` for `=`). If a name contains non-ASCII Unicode characters, it _must_ have an ASCII alternative (e.g., `->` for `→`). The ASCII name should be the main definition, and the Unicode name(s) should be export aliases.

Names generally should not shadow names defined in the standard library, _especially_ the special form names in the above section.

If a macro uses a string as a marker to separate parts of an array (for example, the `.` separator in `fn`), the marker should start with `.`. This prevents it from being confused with an actual name, because no legal Jaspr name can start with `.` or `$`, and reserved names can only start with `$`.

---

## Exports

    $export: {
      closure raise myName assertArgs let fn* if and or fn- macroexpand eval
      apply contextGet

      ⚑:raise 🏴:raise 🏷:let &&: and ||: or
    }

☙ Table of Contents | [🗏 Table of Contents][toc] | [Data Types ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[next]: data-types.jaspr.md
