[☙ Pattern Matching][prev] | [🗏 Table of Contents][toc] | [Streams and Pipelines ❧][next]
:---|:---:|---:

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
- `ParseFailed`: Failed to parse Jaspr or JSON source. Has `filename`, `line`, `column` keys.
- `ReadFailed`: Filesystem error.
- `WriteFailed`: Filesystem error.

## Handler Macros

### `catch`

`(catch body pat₀ handler₀ pat₁ handler₁ … patₙ handlerₙ)` evaluates `body` with a signal handler. When a signal is thrown in `body`,

1. The fiber evaluating `body` is canceled.
2. The signal is matched against each pattern `pat₀`…`patₙ`.
3. If any `pat` matches, the corresponding `handler` is evaluated, and its return value becomes the return value of the `catch` form.
4. If no `pat` matches, the signal is re-raised.
5. If a parent signal handler resumes the re-raised signal, the resumed value becomes the return value of the `catch` form, and `body` is still canceled.

>     (catch 'pass
>       _ 'fail) ;= "pass"

>     (catch (await (raise 'err) 'pass)
>       _ 'fail) ;= "fail"

>     (catch (await (raise 'err) 'pass)
>       e e) ;= "err"

>     (catch (await (raise {err: 'bar, msg: "error message"}) 'pass)
>       {err: 'foo, msg} ([] 1 msg)
>       {err: 'bar, msg} ([] 2 msg)
>       {err: 'baz, msg} ([] 3 msg)) ;= [2, "error message"]

If a `handler` raises a signal, that signal is handled by `catch`'s parent signal handler.

>     (catch (catch (raise 'inner)
>              _ (raise 'outer))
>       err ([] err)) ;= [“outer”]

`catch` only resolves once its return value has _deeply_ resolved, to guarantee that uncatchable signals aren't raised after `catch` has already returned. However, if `catch` spawns fibers that aren't incorporated into its return value---for example, with `do`---and those fibers are still running when `catch` resolves, they will be canceled.

>     (let {ch: (chan!), _: (await (sleep 200) (send! 'outer ch))} {
>       returned: (catch (do (await (sleep 100) (raise 'inner)) true)
>                   x (do (send! x ch) false)),
>       raised: ('value (recv! ch))
>     }) ;= {returned: true, raised: “outer”}

`catch` raises a `BadArgs` error at macro expansion time if it has an even number of arguments, or a `BadPattern` error at macro expansion time if one of the `pat` patterns is not a valid pattern.

---

    macro.catch:
    (fn body … patterns
      `[catchWith (fn .err. (case .err. ~@patterns
                                        _ (raise .err.)))
                  ~body])

### `resume`

`(resume body pat₀ handler₀ pat₁ handler₁ … patₙ handlerₙ)` evaluates `body` with a signal handler. When a signal is thrown in `body`,

1. The signal is matched against each pattern `pat₀`…`patₙ`.
2. If any `pat` matches, the corresponding `handler` is evaluated, and the signal is resumed with its return value.
3. If no `pat` matches, the signal is re-raised.
4. If a parent signal handler resumes the re-raised signal, the original signal is resumed with its resume value.

>     (resume 'pass
>       _ 'fail) ;= "pass"

>     (resume (raise 'fail)
>       _ 'resume) ;= "resume"

>     (resume (raise 'err)
>       e e) ;= "err"

>     (resume (cons null (raise {err: 'bar, msg: "error message"}))
>       {err: 'foo, msg} ([] 1 msg)
>       {err: 'bar, msg} ([] 2 msg)
>       {err: 'baz, msg} ([] 3 msg)) ;= [null, 2, "error message"]

If a `handler` raises a signal, that signal is handled by `resume`'s parent signal handler.

>     (resume (resume (raise 'inner)
>               _ (raise 'outer))
>       err ([] err)) ;= [“outer”]

`resume` raises a `BadArgs` error at macro expansion time if it has an even number of arguments, or a `BadPattern` error at macro expansion time if one of the `pat` patterns is not a valid pattern.

---

    macro.resume:
    (fn body … patterns
      `[resumeWith (fn .err. (case .err. ~@patterns
                                         _ (raise .err.)))
                   ~body])

### `catchWith`

`(catchWith handler body)` evaluates `body` with `handler` as its signal handler function. If any signal is raised in `body`, the fiber evaluating `body` will be canceled, the signal will be passed to `handler`, and the return value of `handler` will become the return value of the `catchWith` expression.

>     (catchWith (const 'fail) 'pass) ;= “pass”
>     (catchWith (const 'fail) (await (raise 'err) 'pass)) ;= “fail”
>     (catchWith id (await (raise 'err) 'pass)) ;= “err”

If `handler` raises a signal, that signal is handled by `catchWith`'s parent signal handler.

>     (catchWith [] (catchWith (fn- x (raise 'outer))
>                              (raise 'inner))) ;= [“outer”]

`catchWith` only resolves once its return value has _deeply_ resolved, to guarantee that uncatchable signals aren't raised after `catchWith` has already returned. However, if `catchWith` spawns fibers that aren't incorporated into its return value---for example, with `do`---and those fibers are still running when `catchWith` resolves, they will be canceled.

>     (let {ch: (chan!), _: (await (sleep 200) (send! 'outer ch))} {
>       returned: (catchWith (fn- x (do (send! x ch) false))
>                            (do (await (sleep 100) (raise 'inner)) true)),
>       raised: ('value (recv! ch))
>     }) ;= {returned: true, raised: “outer”}

The pattern-matching `catch` macro is better suited than `catchWith` to most use cases.

---

    macro.catchWith:
    (fn- handler body
      `[let {.ch.: (chan!) .last.: (getDynamic p.signalHandler) .hfn.: ~handler}
            (choice ('value (recv! .ch.))
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

    $export: {
      catch resume catchWith resumeWith
      🚨:resume 🚧:catch
    }

[☙ Pattern Matching][prev] | [🗏 Table of Contents][toc] | [Streams and Pipelines ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: pattern-matching.jaspr.md
[next]: streams.jaspr.md
