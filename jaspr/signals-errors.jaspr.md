_[Prev: Concurrency and Channels ⇦](concurrency.jaspr.md) • [Table of Contents](jaspr.jaspr.md) • [⇨ Next: Macros](macros.jaspr.md)_

    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Signals and Error Handling

Errors in Jaspr are handled via _signals_. Signals are similar to exceptions in most programming languages, but, in addition to unwinding the stack and aborting a computation, they also allow the possibility of _resuming_ a computation at the point where a signal was raised.

## Raising a Signal

Signals are raised by the `raise` function. Raising a signal means calling the function stored in the [dynamic variable][dynamic] `jaspr.primitive.signalHandler`. This function usually does one of four things:

1. It *catches* the signal, canceling the fiber that raised it and continuing from another point lower on the stack;
2. it *resumes* from the signal, returning a value that becomes the return value of `raise`, which allows the fiber to continue from where it left off;
3. it *re-raises* the signal with a different signal handler, potentially receiving a resume value which it then returns; or
4. it doesn't handle the signal, instead passing it to the *root signal handler*, which (usually) displays an error message and terminates the program.

Signal handlers are usually created using the built-in functions `catch`, `resume`, `catchWith`, or `resumeWith`, all of which are careful to make sure that `signalHandler` is called in a context where it is not its own `signalHandler`, so as to avoid infinite loops if the handler itself raises a signal.

[dynamic]: data-types.jaspr.md#dynamic-variables

## Error Objects

The primary use of signals in Jaspr is to raise and handle _errors_. A Jaspr error is an object with an `err` key, whose value is a string _error type_. It usually has a `why` key as well, which contains either a string explaining the error or another error that caused this error.

### Well-known Error Types

- `NoBinding`: Attempting to look up a name failed. Has `name` key.
- `NoKey`: Attempted to look up a nonexistent key in an array or object. Has `key` and `in` keys.
- `NoMatch`: Value didn't match any patterns in a `case` or `let*`. Has `value` and `patterns` keys.
- `NoPrimitive`: `$`-name is not a valid primitive special form. Has `callee` and `args` keys.
- `BadName`: Attempted to bind a name that contains special characters or is otherwise invalid.
- `BadArgs`: Arguments to a callable were wrong. This can cover a lot of cases; it usually includes `fn` and `args` keys for disambiguation.
- `BadPattern`: Cannot parse a pattern. Has `pattern` key.
- `NotCallable`: Object is not callable. Has `callee` and `args` keys.
- `NotJSON`: Tried to convert a magic object to JSON. Has a `value` key.
- `ChanClosed`: Channel was closed while a `recv!` was waiting. Has a `chan` key.
- `ParseFailed`: Failed to parse Jaspr or JSON source. Has `filename`, `line`, `column` keys.
- `ReadFailed`: Filesystem error.
- `WriteFailed`: Filesystem error.

## Handler Macros

### `catchWith`

`(catchWith handler body)` evaluates `body` with `handler` as its signal handler function. If any signal is raised in `body`, the fiber evaluating `body` will be canceled, the signal will be passed to `handler`, and the return value of `handler` will become the return value of the `catchWith` expression.

>     (catchWith (const 'fail) 'pass) ;= “pass”
>     (catchWith (const 'fail) (await (raise 'err) 'pass)) ;= “fail”
>     (catchWith id (await (raise 'err) 'pass)) ;= “err”

If `handler` raises a signal, that signal is handled by `catchWith`'s parent signal handler.

>     (catchWith [] (catchWith (fn- x (raise 'outer))
>                              (raise 'inner))) ;= [“outer”]

`catchWith` only resolves once its return value has _deeply_ resolved, to guarantee that uncatchable signals aren't raised after `catchWith` has already returned. However, if `catchWith` spawns fibers that aren't incorporated into its return value---for example, with `do`---and those fibers are still running when `catchWith` resolves, they will be canceled.

>     (let {ch: (chan!)} {
>       returned: (catchWith (fn- x (do (send! x ch) false))
>                            (do (await (sleep 100) (raise 42)) true)),
>       raised: (recv! ch)
>     }) ;= {returned: true, raised: 42}

The pattern-matching `catch` macro is better suited than `catchWith` to most use cases.

---

    macro.catchWith:
    (fn- handler body
      `[let {.ch.: (chan!) .last.: (getDynamic p.signalHandler) .hfn.: ~handler}
            (choice (recv! .ch.)
                    (letDynamic p.signalHandler
                                (fn- x (letDynamic p.signalHandler .last.
                                                   (send! (.hfn. x) .ch.)))
                                (await (send! ~body .ch.) (never))))])

### `resumeWith`

`(resumeWith handler body)` evaluates `body` with `handler` as its signal handler function. If any signal is raised in `body`, the `raise` call will return the result of calling `handler` with the signal.

>     (resumeWith (const 'resume) 'pass) ;= “pass”
>     (resumeWith (const 'resume) (raise 'fail)) ;= “resume”
>     (resumeWith id (raise 'err)) ;= “err”

If `handler` raises a signal, that signal is handled by `resumeWith`'s parent signal handler.

>     (resumeWith []
>       (resumeWith (fn- x (raise 'outer))
>         {return: (raise 'inner)})) ;= {return: [“outer”]}

The pattern-matching `resume` macro is better suited than `resumeWith` to most use cases.

---

    macro.resumeWith:
    (fn- handler body
      `[let {.last.: (getDynamic p.signalHandler) .hfn.: ~handler}
            (letDynamic p.signalHandler
                        (fn- x (letDynamic p.signalHandler .last. (.hfn. x)))
                        ~body)])

## Exports

    $export: {catchWith, resumeWith}
