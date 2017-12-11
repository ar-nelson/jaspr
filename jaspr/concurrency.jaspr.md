[☙ Data Types][prev] | [🗏 Table of Contents][toc] | [Macros ❧][next]
:---|:---:|---:

# Concurrency and Channels

## Fibers

Fibers are the basic unit of concurrency in Jaspr. Jaspr code does not deal with fibers directly; they are automatically managed by the language.

A fiber is an execution context with a scope and a parent fiber, and it runs concurrently with other fibers. All of the fibers in a Jaspr program form a tree; the path from a given fiber back to the root is similar to a call stack. A fiber is _resolved_ when it returns a result. 

A new fiber is created whenever a Jaspr form is evaluated or a function is called. For example, evaluating `(+ foo bar)` first creates 1 fiber to evaluate the whole expression, then spawns 3 child fibers to evaluate each of `+`, `foo`, and `bar`. Once the `+` fiber has resolved, the parent fiber now evaluates the body of the function that `+` evaluated to.

### Laziness

Data structures (arrays and objects) in Jaspr are lazy, although not to the extent of truly lazy languages like Haskell. When an array or object is constructed, all of its elements will be computed eventually in their own fibers, but not necessarily all at once. Parts of the structure may be used before other parts have resolved.

For example, consider the following expression:

>     (hd ([] (p.add 1 1) (await (sleep 1000)
>                                (inspect! “foo”)
>                                42))) ;= 2

`hd` returns the first element of the array, `(+ 1 1)`, which evaluates to 2. The second element, which will take 1 second to compute and cause a side effect, is not relevant to the result.

- In a strict language, the entire expression would block for 1 second before the result is available.
- In a truly lazy (call-by-need) language, like Haskell, the expression would not block, and the side effect of printing `“foo”` would never occur, because that expression's value is never used.
- In Jaspr, the expression does not block, but, once the result is available, the fiber computing the second element of the array _is still running_, and the program will still print `“foo”` after 1 second has passed.

## Concurrency Utility Functions

### `never`

A function call that never returns. **Be careful:** using this can deadlock a program!

    never: (fn- (p.chanSend! null (p.chanMake!)))

### `sleep`

`(sleep ms)` returns `null` after `ms` milliseconds have passed.

    sleep: (fn- ms (p.sleep ms))

### `onCancel`

TODO: Implement `onCancel`.

## Expression Chaining Forms

### `do`

`(do expr₀ expr₁ … exprₙ)` evaluates `expr₀`…`exprₙ` concurrently, each in its own fiber. It returns the result of the last expression (`exprₙ`) without waiting on the others to resolve.

>     (do 1 2) ;= 2
>     (do (never) 42) ;= 42

---

    do: (fn* exprs (if exprs (-1 exprs) null))

### `await`

`(await expr₀ expr₁ … exprₙ)` evaluates `expr₀`…`exprₙ` in series. Each expression is evaluated only after the previous expression has resolved. It returns the value of the last expression in the chain.

>     (await 1 2) ;= 2

`await` only waits for the top level of each value to resolve; e.g., if one of the expressions returns an array, `await` may continue to the next expression even though the elements of the array have not fully resolved.

---

    macro.await:
    (fn* exprs
      (if (no exprs) null
          (p.< (len exprs) 2) (hd exprs)
          `[p.then ~(hd exprs) (await ~@(tl exprs))]))

### `awaitAll`

`(awaitAll expr₀ expr₁ … exprₙ)` evaluates `expr₀`…`exprₙ` in parallel. Once all of these expressions have resolved, it returns the value of the last expression in the argument list.

>     (awaitAll 1 2) ;= 2

`awaitAll` only waits for the top level of each value to resolve; e.g., if one of the expressions returns an array, `awaitAll` may return even though the elements of the array have not fully resolved.

---

    macro.awaitAll:
    (fn* exprs
      (if (no exprs) null
          (p.is? 1 (len exprs)) (hd exprs)
          `[let {.a.: ~(hd exprs), .b.: (awaitAll ~@(tl exprs))}
                (p.then .a. .b.)]))

### `choice`

`(choice expr₀ expr₁ … exprₙ)` evaluates `expr₀`…`exprₙ` in parallel and creates a _choice junction_ of the resulting fibers. A choice junction resolves to the value of the first fiber in the junction that resolves. Once the junction resolves, all of the unresolved fibers in the junction are _canceled_. A canceled fiber stops executing and aborts any pending `send!` or `recv!` operations; canceling a fiber cancels all of its children as well.

>     (choice 'fast (await (sleep 100) 'slow)) ;= “fast”
>     (choice (await (sleep 100) 'slow) 'fast) ;= “fast”
>     (choice 42 (never)) ;= 42

Choice junctions are the only way to cancel fibers. A typical use case is to create timeouts. For example, `(choice (sleep 100) (recv! c))` will receive on `c` with a 100ms timeout, stopping the `recv!` operation once the timeout is up. `(choice (sleep 100) (send! x c))` will attempt to send `x` on `c` with a 100ms timeout, but, if nothing receives it, the `send!` will be canceled and a future `(recv! c)` will not receive `x`.

>     (let {ch: (chan!)}
>       (await (choice (send! 'canceled ch) (sleep 100))
>              (do (send! 'ok ch) (recv! ch)))) ;= “ok”

Canceling a branch of a choice junction also cancels all branches of any choice junctions nested inside that branch.

>     (let {ch: (chan!)}
>       (await (choice (choice (send! 'canceled1 ch) (send! 'canceled2 ch))
>                      (sleep 100))
>              (do (send! 'ok ch) (recv! ch)))) ;= “ok”

---

    macro.choice: (fn* exprs `[p.junction ~@exprs])

## Channels

Channels are how Jaspr handles both mutable state and messaging between fibers. They are based on channels from Go, and function similarly: all channels can both send and receive messages, and sending and receiving both block until the sent message is received.

Channels are the only mutable values in Go. They are [magic objects](data-types.jaspr.md#magic-objects) with the property `$chan: true`. Channels are not referentially transparent; all channels are structurally just `{$chan: true}`, but two channels with the same structure are not necessarily equal. Copying a channel with object operations like `withKey` or `withoutKey` will produce a new object that is no longer a channel.

Values must be fully resolved before they can be sent on a channel. This prevents deadlocks that could result from a partially-resolved data structure being sent from a fiber that is then canceled (see [`choice`](#choice)), leaving parts of the value permanently unresolved. Closures are a special case: waiting for every member of a closure's scope to resolve could take a long time, so Jaspr keeps track of which scope entries were declared at the top level (which would not be inside any choice junction), and does not wait for those to resolve when sending a closure on a channel.

### `chan!`

`(chan!)` creates a new channel. A channel is a magic object with the key `$chan: true`.

>     ('$chan (chan!)) ;= true

Every call to `chan!` creates a unique object, even though all channels are structurally identical. Creating an updated copy of a channel (e.g., by using `put` or `update`) will result in a non-magic object that is not a channel.

>     (= (chan!) (chan!)) ;= false

---

    chan!: (fn- (p.chanMake!))

### `send!`

`(send! msg chan)` sends `msg` on the channel `chan`, then blocks until either `msg` is received or `chan` is closed. It returns `true` if `msg` was successfully received, `false` if `chan` was closed.

>     (let {c: (chan!)} (do (recv! c) (send! 42 c))) ;= true
>     (let {c: (chan!)} (await (close! c) (send! 42 c))) ;= false

Unlike other Jaspr functions, `send!` is strict, not lazy. If `msg` or any element of `msg` is unresolved, `send!` blocks until `msg` has finished resolving. While `msg` is unresolved, the send has technically not yet occurred, so `recv!` calls will not yet be able to receive `msg`.

>     (let {c: (chan!)}
>       (do (send! ([] 1 (await (sleep 200) 2)) c)
>           (send! 42 c)
>           (await (recv! c)
>                  (recv! c)))) ;= [1, 2]

`send!` raises a `BadArgs` error if `chan` is not a channel.

---

    send!: (fn- msg chan (assertArgs (chan? chan) “not a channel”
                                     (p.chanSend! msg chan)))

### `recv!`

`(recv! chan)` blocks until a message is received on the channel `chan`, then returns that message.

>     (let {c: (chan!)} (do (send! "foo" c) (recv! c))) ;= "foo"

`recv!` raises a `BadArgs` error if `chan` is not a channel, or a `ChanClosed` error if `chan` is closed before or during the `recv!` call.

---

    recv!: (fn- chan (assertArgs (chan? chan) “not a channel”
                                 (p.chanRecv! chan)))

### `close!`

Closes a channel. Returns `true` if the channel was not yet closed, or `false` if the channel was already closed (and the `close!` call did nothing).

>     (let {c: (chan!)} (close! c)) ;= true
>     (let {c: (chan!)} (await (close! c) (close! c))) ;= false

Attempting to send on a closed channel does nothing and returns immediately. Attempting to receive on a closed channel raises a `ChanClosed` error.

`close!` raises a `BadArgs` error if its argument is not a channel.

---

    close!: (fn- chan (assertArgs (chan? chan) “not a channel”
                                  (p.chanClose! chan)))

### `closed?`

Returns a boolean indicating whether its argument, a channel, is closed.

>     (let {c: (chan!)} (closed? c)) ;= false
>     (let {c: (chan!)} (await (close! c) (closed? c))) ;= true

`closed?` raises a `BadArgs` error if its argument is not a channel.

---

    closed?: (fn- chan (assertArgs (chan? chan) “not a channel”
                                   (p.chanClosed? chan)))

## Advanced Channel Operations

### `combine!`

`(combine! chans)` returns a new channel. It continually receives on every channel in the array `chans` in parallel, and sends all received messages on the new channel. Messages from the same source channel will remain ordered relative to each other, but the ordering of messages from different source channels is undefined. The returned channel is closed once every channel in `chans` has closed.

`combine!` raises a `BadArgs` error if `chans` is not an array of channels.

    ; TODO: Define combine!

### `distribute!`

`(distribute! source sinks)` continually receives on the channel `source` and sends each message on every channel in the array `sinks` in parallel. It blocks until `source` closes, then returns `null`.

`distribute!` raises a `BadArgs` error if `source` is not a channel or `sinks` is not an array of channels.

    ; TODO: Define distribute!

### `drain!`

`(drain! source sink)` continually receives on the channel `source` and sends each message on the channel `sink`. It blocks until `source` closes, then returns `null`.

`drain!` raises a `BadArgs` error if either `source` or `sink` is not a channel.

    ; TODO: Define drain!

### `roundRobin!`

`(roundRobin! n input)` creates and returns an array of `n` output channels, then receives on the channel `input` and sends each message received from `input` on one of the output channels. It cycles through the output channels with each message, restarting from the beginning when the end is reached. Over time, each output channel will be sent an equal portion of the messages received from `input`. When `input` is closed, all output channels will be closed as well.

>     ;(map collect! (roundRobin! 3 (arrayChan '[1 2 3 4 5 6 7 8 9])))
>     ;  ;= [[1, 4, 7], [2, 5, 8], [3, 6, 9]]

`roundRobin!` raises a `BadArgs` error if `n` is not a positive integer or `input` is not a channel.

    ; TODO: Define roundRobin!

### `sendAll!`

`(sendAll! msgs chan)` sends all of the elements of the array `msgs` on the channel `chan`, in order, then returns a boolean representing whether the channel was closed.

`sendAll!` raises a `BadArgs` error if `msgs` is not an array or `chan` is not a channel.

    sendAll!:
    (fn- msgs chan
      (seq (forEachSeq (fn- msg (send! msg chan)) msgs)
           (closed? chan)))

## Mutable State

### Refs

    ; TODO: Test and document refs

#### `ref!`

    refServer!:
    (fn- chan value
      (let {msg: (recv! chan)}
        (if (hasKey? 'set msg) (refServer! chan ('set msg))
            (hasKey? 'get msg) (do (send! value ('get msg))
                                   (refServer! chan value))
            (refServer! chan value))))
    ref!:
    (fn- value
      (let {chan: (chan!)}
        (do (refServer! chan value)
            {ref: chan})))

#### `ref?`

    ref?: (fn- it (and (object? it) (hasKey? 'ref it) (chan? ('ref it))))

#### `get!`

    get!:
    (fn- ref
      (assertArgs (ref? ref) “not a ref”
        (let {chan: (chan!)}
          (do (send! {get: chan} ('chan ref))
              (recv! chan)))))

#### `set!`

    set!:
    (fn- value ref
      (assertArgs (ref? ref) “not a ref”
        (send! {set: value} ('chan ref))))

### Queues

    ; TODO: Test and document queues

#### `queue!`

    queueServer!:
    (fn- i o (let {msg: (recv! i)}
               (do (send! msg o) (queueServer! i o))))

    queue!:
    (fn- (let {enqueue: (chan!), dequeue: (chan!)}
           (do (queueServer! enqueue dequeue)
               {enqueue dequeue})))

#### `queue?`

    queue?:
    (fn- it (and (object? it)
                 (hasKey? 'enqueue it)
                 (chan? ('enqueue it))
                 (hasKey? 'dequeue it)
                 (chan? ('dequeue it))))

#### `enqueue!`

    enqueue!:
    (fn- value queue
      (assertArgs (queue? queue) “not a queue”
        (send! value ('enqueue queue))))

#### `dequeue!`

    dequeue!:
    (fn- queue (assertArgs (queue? queue) “not a queue”
                 (recv! ('dequeue queue))))

## Exports

    $export: {
      never sleep do await awaitAll inParallel:awaitAll inSeries:await choice
      chan! send! recv! close! closed?
      
      combine! distribute! drain! roundRobin! sendAll!

      ref! ref? get! set! queue! queue? enqueue! dequeue!

      ⛔:never 💤:sleep ∥:do ∦:await ⋕:awaitAll ⏛:choice 📩:send! 📨:recv!
    }

[☙ Data Types][prev] | [🗏 Table of Contents][toc] | [Macros ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: data-types.jaspr.md
[next]: macros.jaspr.md
