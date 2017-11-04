_[Table of Contents](jaspr.jaspr.md) • [⇨ Next: Data Types](data-types.jaspr.md)_

    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Syntax and Semantics

Jaspr is, broadly speaking, a Lisp-like language: function calls are written `(function-name arg₀ arg₁ … argₙ)`, everything is an expression, and the language is [homoiconic][homoiconic] and can rewrite its own syntax via macros.

Jaspr is also based on [JSON][json]. All Jaspr files are JSON documents, and are made up of only the six JSON data types: **null**, **booleans**, **numbers**, **strings**, **arrays**, and **objects**. Jaspr's syntax is an extension of JSON that makes Jaspr files look more like Lisp programs than JSON documents.

[homoiconic]: https://en.wikipedia.org/wiki/Homoiconicity
[json]: http://json.org/

## Extensions to JSON

All JSON is valid Jaspr, but Jaspr adds several syntax extensions to JSON to make it usable as a programming language.

### Comments

Jaspr supports line comments starting with `//` or `;` and block comments surrounded by `/*`…`*/`. Block comments can nest.

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

The prefix operator `` ` `` (backtick/backquote) wraps a form in an array whose first element is the string `$syntax-quote`. The operators `~` and `~@` do the same for `$unquote` and `$unquote-splicing`, respectively. These form a _quasiquotation_ macro modeled on Clojure's [syntax quote][syntax-quote].

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

An array whose first element is a string is expanded as a _macro application_ if the array's first element is a name bound in the current scope's `macro` context. The name must be bound to a function, or an exception will be thrown. The function is called with the tail of the array, unevaluated, as its arguments; its return value becomes the result of the macro application.

Given the macro binding

    macro.add-1: (fn- x (+ 1 x))

, the application of `add-1` to a number will expand to the successor of that number.

>     (macroexpand '(add-1 2)) ;= 3

Macro expansion is recursive; after macro application has occurred, the result will be expanded again.

    macro.make-add-1: (fn- '(add-1 3))

>     (macroexpand '(make-add-1)) ;= 4

### Recursive Expansion

If an array can not be expanded as a macro application, it expands to the macro expansion of its elements. The elements are expanded concurrently, in no particular order.

>     (macroexpand '[1 2 3]) ;= [1, 2, 3]
>     (macroexpand '[(add-1 1) ["foo" (add-1 2)]]) ;= [2, ["foo", 3]]

Non-closure objects also expand to the macro expansion of their values. The values are expanded concurrently, in no particular order.

>     (macroexpand '{a: 1, b: 2}) ;= {a: 1, b: 2}
>     (macroexpand '{a: (add-1 1), b: (add-1 2)}) ;= {a: 2, b: 3}

Attempting to expand a closure throws an exception.

### Closures and Pre-expansion

The `$closure` [special form](#special-forms) evaluates to a closure, and its first argument is new bindings to include in the closure's scope. These new bindings may include macro definitions which cannot be known until evaluation time. However, most uses of `$closure` do not define macros, and this allows Jaspr to perform an optimization called _pre-expansion_: if a closure does not define any new macros, its code (the second argument of `$closure`) is expanded as though it were still part of the outer scope.

In most cases, this looks exactly like expanding any other array, except that part of the expansion order is consistent (the first argument must be fully expanded before the second).

In the suboptimal case where a closure defines new bindings in the `macro` context, its code is left unexpanded. Later, when the `$closure` form is evaluated, the fully-evaluated macro bindings will be available and its code will be macroexpanded before being evaluated.

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

Attempting to look up an unbound name will throw an exception.

### Calls

A non-empty array is a call. The first element is the _callee_, and the rest are the _arguments_. In most cases (except for a few special forms), all of the elements of the array are evaluated. Evaluation of elements is _concurrent_ (with no particular ordering) and _asynchronous_—the call can start evaluating as soon as the callee has finished evaluating, even if the arguments have not.

#### Functions

If the callee evaluates to a _function_ (a closure with a `$code` key), the contents of the function's `$code` key are evaluated in the scope contained in the function's `$closure` key, with the arguments bound to the special name `$args`.

>     ('{$closure: {}, $code: 91})              ;= 91
>     ('{$closure: {value: {x: 42}}, $code: x}) ;= 42
>     ('{$closure: {}, $code: $args} 1 2 3)     ;= '[1 2 3]

#### Constructors

If the callee evaluates to the empty array `[]` or the empty object `{}`, it is an array or object _constructor_. `[]` constructs an array from its arguments, while `{}` expects an even number of arguments, alternating between keys and values, and constructs an object from the key/value pairs.

>     ([] 1 2 3)     ;= [1 2 3]
>     [[[]]]         ;= []
>     ({} 'a 1 'b 2) ;= {a: 1, b: 2}
>     ({})           ;= {}

`{}` throws an exception if it receives an odd number of arguments or if any of the key arguments are not strings.

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

An exception is thrown if:
- The number of arguments is not exactly one
- The first argument is not an array or object
- The index does not exist in the array/object
- The index is a non-integer number

#### Other Call Types

The empty string `""` is the quote special form (see [Quoting](#quoting)); it returns its first argument unevaluated, and throws an exception if it does not have exactly one argument.

>     ["", "foo"] ;= "foo"

If the callee (before evaluation) is a string that starts with `$`, the call is a special form, and its semantics depend on which form it is; see [Special Forms](#special-forms).

If the callee evaluates to anything else (`null`, `true`, `false`, an array, or a non-closure object), an exception is thrown.

### Object Literals

A non-closure object evaluates to an object with the same keys, and with its values evaluated.

>     {a: ([] 1 2), b: (1 '[foo bar])} ;= {a: [1, 2], b: "bar"}

## Reserved Names

All reserved names in Jaspr start with the `$` character. It is not possible to define new names starting with this character, and attempting to evaluate a name starting with `$` as anything other than the callee of a special form (except for the special variables `$args` and `$self`) will throw an exception.

Jaspr defines dozens of special forms and built-in functions prefixed with `$`, for performing various primitive operations. **These special forms should never be used directly in production Jaspr code.** They are intentionally undocumented, and may change from version to version.

## Special Forms

Jaspr's core syntax is made up of several _special forms_ with unique evaluation behavior. Most of these are macros that translate to reserved names starting with `$`, but the nonprefixed forms should **always** be used outside of this standard library.

### `closure`

`(closure bindings code)` constructs a function that closes over the current scope. `bindings` is an object containing bindings to add to the function's scope (this is how `let` is implemented), and `code` is the function's code, which is not evaluated.

`closure` is a low-level special form; the forms `let`, `fn`, and `fn*` cover most practical uses of it, and should be used instead of `closure` in most situations.

    macro.closure: ($closure {} `[$closure ~(0 $args) ~(1 $args) {}] {})

### `let`

`(let {name₀: x₀, name₁: x₁, … nameₙ: xₙ} body)` evaluates `body` in a scope in which the names `name₀`…`nameₙ` are bound to the values `x₀`…`xₙ`. It is equivalent to creating a new function with the bindings, then immediately calling the function.

    macro.let: (closure {} `[(closure ~(0 $args) ~(1 $args))])

>     (let {x: 1} x) ;= 1
>     (let {x: (let {y: 2} y)} x) ;= 2
>     (let {a: 1, b: 2} ([] a b)) ;= [1, 2]

Bindings are evaluated recursively: the value of each binding is evaluated in a scope containing all of the bindings.

>     (let {a: b, b: c, c: 3} a) ;= 3

Context prefixes are allowed, but the only supported contexts are `value`, `macro`, and `check`.

>     (let {macro.app: (closure {} ([] (0 $args) (1 $args)))}
>          (app 1 '[a b])) ;= "b"

### `fn*`

`(fn* args body)` creates a function that takes a variable number of arguments; `body` is the body of the function, and `args` is the name that the array of arguments is bound to.

>     ((fn* xs (1 xs)) '[a b c]) ;= "b"

    macro.fn*: (closure {} `[closure {} (let ~({} (0 $args) '$args) ~(1 $args))])

### `if`

A multi-clause conditional expression. `(if predicate then-case else-case)` evaluates and returns `then-case` if `predicate` is truthy, or `else` if `predicate` is falsy. Only one of the branches is evaluated.

>     (if true "t" "f")  ;= "t"
>     (if false "t" "f") ;= "f"

If `else` is missing, it defaults to `null`.

>     (if false "t") ;= null

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
      (fn* argv (let {argc: ($array-length argv)}
        ([] '$if (0 argv) (1 argv)
            ($if ($less argc 4)
                 ($if ($equals argc 3) (2 argv) null)
                 `[if ~@($array-slice 2 argc argv)]))))

### `fn-`

Like `fn`, but does not support pattern matching on its argument names (read the name as "`fn` minus"). This macro is used internally by the standard library, for defining functions before pattern matching is available. **There is almost never a reason for code outside the standard library to use `fn-` instead of `fn`**.

`(fn- arg₀ arg₁ … argₙ body)` creates a function that takes a fixed number of arguments, where `body` is the body of the function and `arg₀`…`argₙ` are the names that the function's arguments are bound to.

>     ((fn- 42)) ;= 42
>     ((fn- x ([] x)) 42) ;= [42]
>     ((fn- index array (index array)) 1 '[a b c]) ;= "b"

---

    macro.fn-:
      (fn* fn-args
        (let {
          end: ($subtract ($array-length fn-args) 1),
          loop: ; Recursive function that constructs the `let` scope containing
                ; the argument bindings
            (fn* args
              (let {i: (0 args), scope: (1 args)}
                   (if ($equals i end)
                       scope
                       (loop ($add i 1)
                             ($object-insert (i fn-args) `[~i $args] scope)))))
        } `[closure {} (let ~(loop 0 {}) ~(-1 fn-args))]))

### `macroexpand`

Macro expands its argument in the current scope.

    macro.macroexpand: (fn- code `($macroexpand ~code))

>     (let {macro.to-42: (fn- 42)} (macroexpand '(to-42 x))) ;= 42

### `eval`

Evaluates its argument in the current scope. Note that `eval` performs evaluation _without_ macro expansion.

    macro.eval: (fn- code `($eval ~code))

>     (let {to-42: (fn- 42)} (eval '(to-42 null))) ;= 42

### `apply`

`(apply callee args)` calls the value `callee` with the arguments array `args`. Throws an exception if `callee` is not callable or `args` is not an array.

>     (apply [] '[1 2 3]) ;= [1, 2, 3]

    apply: (fn- callee args ($apply callee args))

### `throw`

`(throw ex)` calls the current exception handler function with `ex` as its only argument, and returns the result of this call.

    throw: (fn- ex ($throw ex))

### `catch`

`(catch handler body)` evaluates `body` with `handler` as its exception handler function. All `throw` calls in the context of `body` will call `handler`.

>     (catch (fn- err ([] err))
>            (throw 42)) ;= [42]

Unlike lexical (`let`) bindings, the exception handler binding used by `throw` and `catch` is not captured by closures and remains the same when entering a function call (this is called [_dynamic scope_][dynamic-scope]).

>     (let {
>       f: (catch (fn- _ "This is f's lexical scope")
>                 (fn- (throw null)))
>       g: (catch (fn- _ "This is g's lexical scope")
>                 (fn- (f)))
>     } (g)) ;= "This is g's lexical scope"

Exception handlers form a stack. `handler` is never its own exception handler; when a `throw` calls `handler`, the exception handler becomes the `catch` form's exception handler (the _parent_ exception handler) until `handler` returns or throws again. Repeated throws will climb the stack of exception handlers until the top-level handler is reached, which crashes the program.

>     (catch (fn- _ "From the parent exception handler")
>            (catch (fn- x (throw x)) ; Rethrow the exception.
>                   (throw null))) ;= "From the parent exception handler"

[dynamic-scope]: https://en.wikipedia.org/wiki/Scope_(computer_science)#Lexical_scope_vs._dynamic_scope

---

    macro.catch: (fn- handler body `[$let-exception-handler ~handler ~body])

### `context-get`

Looks up a name in the current scope, in a context other than the default (`value`). For example, `context-get macro "foo"` returns the macro `foo`. The second argument (the name) is evaluated, but the first argument (the context) is not.

>     (let {macro.to-42: (fn- 42)} ((context-get macro "to-42") null)) ;= 42

    macro.context-get: (closure {} ($context-get (0 $args) (1 $args)))

### Other Special Forms

`chan!`, `send!`, `recv!`, `close!`, and `closed?` are part of the core language; these deal with channels and message passing, and are defined in [Concurrency and Channels](concurrency.jaspr.md).

`fn`, `case`, and `let*` are also core parts of Jaspr syntax; these are defined in [Pattern Matching](pattern-matching.jaspr.md).

## Naming Conventions

All names in Jaspr should be `lower-case-with-hyphens`. This is true even for acronyms: `from-json`, not `from-JSON`. Capital letters in names are reserved for future extensions to the language, such as a type system; capital letters are only used in a few places in the standard library for compatibility purposes (e.g., `Infinity` and `NaN`).

Try to balance terseness and readability. Names need not be excessively verbose for clarity; common abbreviations, such as `len` for length or `str` for string, are acceptable, but be consistent in the usage of these abbreviations.

Functions that return boolean values should have names ending in `?` (except for symbolic names like `<` and a few special cases like `no`).

Functions that have side effects or whose output is not 100% determined by their input should have names ending in `!`. This includes functions like `current-time-ms!`, which does not have side effects but is not purely functional either. If a function calls a function ending in `!`, then its name should almost always end in `!`, unless the side effects are contained in such a way that the function's effects appear pure (for example, using `try+` to create a process for error handling purposes).

If a function name has multiple suffixes, `?` should appear before `!`.

Most symbolic names should have an alphanumeric alternative (e.g., `eq?` for `=`). If a name contains non-ASCII Unicode characters, it _must_ have an ASCII alternative (e.g., `->` for `→`). The ASCII name should be the main definition, and the Unicode name(s) should be export aliases.

Names generally should not shadow names defined in the standard library, _especially_ the special form names in the above section.

If a macro uses a string as a marker to separate parts of an array (for example, the `.` separator in `fn`), the marker should start with `.`. This prevents it from being confused with an actual name, because no legal Jaspr name can start with `.` or `$`, and reserved names can only start with `$`.

---

## Exports

    $export: {
      closure let fn* if fn- macroexpand eval apply throw catch context-get

      💥: throw
    }
