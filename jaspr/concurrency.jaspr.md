
    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Concurrency and Channels

## Fibers

Fibers are the basic unit of concurrency in Jaspr. A fiber is an execution context with a scope and a parent fiber, and it runs concurrently with other fibers. All of the fibers in a Jaspr program form a tree; the path from a given fiber back to the root is similar to a call stack. A fiber is _resolved_ when it returns a result. Jaspr code does not deal with fibers directly; they are automatically managed by the language.

A new fiber is created whenever a Jaspr form is evaluated or a function is called. For example, evaluating `(+ foo bar)` first creates 1 fiber to evaluate the whole expression, then spawns 3 child fibers to evaluate each of `+`, `foo`, and `bar`. Once the `+` fiber has resolved, the parent fiber now evaluates the body of the function that `+` evaluated to.

### Laziness

Data structures (arrays and objects) in Jaspr are lazy, although not to the extent of truly lazy languages like Haskell. When an array or object is constructed, all of its elements will be computed eventually in their own fibers, but not necessarily all at once. Parts of the structure may be used before other parts have resolved.

For example, consider the following expression:

>     (hd ([] (+ 1 1) (seq (sleep 1000)
>                          (print! "foo")
>                          42))) ;= 2

`hd` returns the first element of the array, `(+ 1 1)`, which evaluates to 2. The second element, which will take 1 second to compute and cause a side effect, is not relevant to the result.

- In a strict language, the entire expression would block for 1 second before the result is available.
- In a truly lazy (call-by-need) language, like Haskell, the expression would not block, and the side effect of printing `"foo"` would never occur, because that expression's value is never used.
- In Jaspr, the expression does not block, but, once the result is available, the fiber computing the second element of the array _is still running_, and the program will still print `"foo"` after 1 second has passed.

## Expression Chaining Forms

### `par`

`(par expr0 expr1 ... exprn)` evaluates `expr0`...`exprn` in parallel. Once all of these expressions have resolved, it returns the value of the last expression in the argument list.

`par` only waits for the top level of each value to resolve; e.g., if one of the expressions returns an array, `par` may return even though the elements of the array have not fully resolved.

### `seq`

`(seq expr0 expr1 ... exprn)` evaluates `expr0`...`exprn` in series. Each expression is evaluated only after the previous expression has resolved. It returns the value of the last expression in the chain.

`seq` only waits for the top level of each value to resolve; e.g., if one of the expressions returns an array, `seq` may continue to the next expression even though the elements of the array have not fully resolved.

### `choice`

`(choice expr0 expr1 ... exprn)` creates a _choice junction_ of the fibers that evaluate `expr0`...`exprn`. A choice junction resolves to the value of the first fiber in the junction that resolves. Once the junction resolves, all of the unresolved fibers in the junction are _canceled_. A canceled fiber stops executing and stops any pending `send!` or `recv!` operations; canceling a fiber cancels all of its children as well.

Choice junctions are the only way to cancel fibers. A typical use for them is to create timeouts. For example, `(choice (sleep 100) (recv! c))` will receive on `c` with a 100ms timeout, stopping the `recv!` operation once the timeout is up. `(choice (sleep 100) (send! x c))` will attempt to send `x` on `c` with a 100ms timeout, but, if nothing receives it, the `send!` will be canceled and a future `(recv! c)` will not receive `x`.

    macro.choice: (fn* exprs `($junction ~@exprs))

## Channels

Channels are how Jaspr handles both messaging between fibers and mutable state. They are based on channels from Go, and function similarly: a channel can send and receive messages; sending and receiving both block until the sent message is received.

Channels are the only mutable values in Go, although, like closures, they are still technically just objects. A channel object is also called a _channel reference_: it is an object `{$chan, $owner}`, where `$chan` is a number that uniquely identifies the channel and `$owner` is a string (usually a UUID) that uniquely identifies the Jaspr process that created the channel. The actual mutable state of the channel is hidden; built-in channel functions like `send!` and `recv!` use the number as a reference to the channel's internal state.

The `$owner` key is used to distinguish valid channels created by the current process from channels created by another process that were (mistakenly?) sent in JSON data. `chan?` will only identify channels whose `$owner` equals the value bound to the reserved name `$process-id` as actual channels; `send!` and `recv!` will throw an exception if they receive channels with the wrong `$owner`.

A value must be fully resolved before it can be sent on a channel. This prevents deadlocks that could result from a partially-resolved data structure being sent from a fiber that is then canceled (see [`choice`](#choice)), leaving parts of the value permanently unresolved. Closures are a special case: waiting for every member of a closure's scope to resolve could take a long time, so Jaspr keeps track of which scope entries were declared at the top level (which would not be inside any choice junction), and does not wait for those to resolve when sending a closure on a channel.

### `chan!`

`(chan!)` creates a new channel. It takes an optional argument, the name of the channel: `(chan! "foo")` returns a channel named `"foo"`. Channel names are not unique identifiers; they are just an extra property `$name` on the channel object for debugging purposes.

    chan!:
      (fn* args
        (if args (with-key "$name" ($to-string (0 args)) ($chan-make))
                 ($chan-make)))

### `send!`

`(send! msg chan)` sends `msg` on the channel `chan`, then blocks until either `msg` is received or `chan` is closed. It returns `true` if `msg` was successfully received, `false` if `chan` was closed.

Unlike other Jaspr functions, `send!` is strict, not lazy. If `msg` or any element of `msg` is unresolved, `send!` blocks until `msg` has finished resolving. While `msg` is unresolved, the send has technically not yet occurred, so `recv!` calls will not yet be able to receive `msg`.

`send!` throws an exception if `chan` is not a channel.

    send!:
      (fn- msg chan
        (if (chan? chan)
            ($chan-send msg chan)
            (throw {err: "not a channel", fn: "send!", args: ([] msg chan)})))

### `recv!`

`(recv! chan)` blocks until a message is received on the channel `chan`, then returns that message.

`recv!` throws an exception is `chan` is not a channel, or if `chan` is closed. Closing a channel while a `recv!` is waiting will cause the `recv!` call to throw an exception.

    recv!:
      (fn- chan
        (if (chan? chan)
            ($chan-recv chan)
            (throw {err: "not a channel", fn: "recv!", args: `[~chan]})))

### `close!`

Closes a channel. Returns `true` if the channel was not yet closed, or `false` if the channel was already closed (and the `close!` call did nothing). Throws an exception if its argument is not a channel.

    close!:
      (fn- chan
        (if (chan? chan)
            ($chan-close chan)
            (throw {err: "not a channel", fn: "close!", args: `[~chan]})))

### `closed?`

Returns a boolean indicating whether its argument, a channel, is closed. Throws an exception if its argument is not a channel.

    closed?:
      (fn- chan
        (if (chan? chan)
            ($chan-is-closed chan)
            (throw {err: "not a channel", fn: "closed?", args: `[~chan]})))

## Channel Operations

Jaspr defines higher-order functions over channels that correspond almost one-to-one with the higher-order functions over arrays defined in [Array Operations](arrays.jaspr.md). In general, for each array operation `x`, the corresponding channel operation is named `x!`.

### `all?!`

`(all?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them is falsy or `chan` is closed. If the result of applying `f` to a message is falsy, it returns `false` and closes `chan`; otherwise, it returns `true`.

### `any?!`

`(any?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them truthy or `chan` is closed. If the result of applying `f` to a message is truthy, it returns `true` and closes `chan`; otherwise, it returns `false`.

### `array-chan`

`(array-chan array)` returns a new channel. It sends the elements of `array` on the channel, in order, then closes the channel.

### `collect!`

`(collect! chan)` receives messages on `chan` until it closes, accumulating the messages into an array. When `chan` closes, it returns the array.

>     (collect! (array-chan '[1 2 3])) ;= [1, 2, 3]

### `combine!`

`(combine! chans)` returns a new channel. It continually receives on every channel in the array `chans` in parallel, and sends all received messages on the new channel. Messages from the same source channel will remain ordered relative to each other, but the ordering of messages from different source channels is undefined. The returned channel is closed once every channel in `chans` has closed.

`combine!` throws an exception if `chans` is not an array of channels.

### `count!`

`(count! f chan)` receives messages from `chan` until `chan` is closed, and calls the predicate `f` on each of them. Once `chan` is closed, it returns the number of received messages for which `f` returned a truthy value.

### `cycle!`

`(cycle! chan)` returns a new channel. It continually receives on the channel `chan` and sends each message on the returned channel; once `chan` closes, the returned channel starts again from the beginning of the messages received from `chan`.

### `distribute!`

`(distribute! source sinks)` continually receives on the channel `source` and sends each message on every channel in the array `sinks` in parallel. It blocks until `source` closes, then returns `null`.

`distribute!` throws an exception if `source` is not a channel or `sinks` is not an array of channels.

### `drain!`

`(drain! source sink)` continually receives on the channel `source` and sends each message on the channel `sink`. It blocks until `source` closes, then returns `null`.

`drain!` throws an exception if either `source` or `sink` is not a channel.

### `filter!`

### `flatten!`

`(flatten! chan)` returns a new channel. It continually receives on the channel `chan`, and, assuming the received are themselves channels, continually receives on each received channel until the received channel closes, then sends those messages on the new channel. Once both `chan` and all channels received from `chan` have closed, it closes the new channel.

`flatten!` throws an exception if `chan` is not a channel. It throws an exception and closes `chan` if any message received on `chan` is not a channel.

### `flat-map!`

`(flat-map! f chan)` returns a new channel. It continually receives on the channel `chan`, and, assuming the received messages are themselves channels, continually receives on each received channel until the received channel closes, then, for each received message `x`, sends `(f m)` on the new channel. Once both `chan` and all channels received from `chan` have closed, it closes the new channel.

`flat-map!` throws an exception if `chan` is not a channel. It throws an exception and closes `chan` if any message received on `chan` is not a channel.

### `map!`

`(map! f chan)` returns a new channel. It receives every message on `chan`, and, for each message `m` received, sends `(f m)` on the new channel. Once `chan` has closed and the last mapped message has been received, it closes the new channel.

### `none?!`

`(none?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them truthy or `chan` is closed. If the result of applying `f` to a message is truthy, it returns `false` and closes `chan`; otherwise, it returns `true`.

### `pipe!`

### `recv-each!`

`(recv-each! f chan)` 

### `recv-until!`

`(recv-until! f chan)` receives messages on `chan` and discards them until one of them satisfies the predicate `f`. It returns the first message that satisfies `f`.

`recv-until!` throws an exception if `f` is not callable, if `chan` is not a channel, or if `chan` is closed before `recv-until!` returns.

### `round-robin!`

`(round-robin! n input)` creates and returns an array of `n` output channels, then receives on the channel `input` and sends each message received from `input` on one of the output channels. It cycles through the output channels with each message, restarting from the beginning when the end is reached. Over time, each output channel will be sent an equal portion of the messages received from `input`. When `input` is closed, all output channels will be closed as well.

>     (map collect! (round-robin! 3 (array-chan '[1 2 3 4 5 6 7 8 9])))
>       ;= [[1, 4, 7], [2, 5, 8], [3, 6, 9]]

`round-robin!` throws an exception if `n` is not a positive integer or `input` is not a channel.

### `send-all!`

`(send-all! msgs chan)` sends all of the elements of the array `msgs` on the channel `chan`, in order, then returns a boolean representing whether the channel was closed.

`send-all!` throws an exception if `msgs` is not an array or `chan` is not a channel.

    send-all!:
      (fn- msgs chan
        (seq (for-each-seq (fn- msg (send! msg chan)) msgs)
             (closed? chan)))

### `take!`

`(take! n chan)` receives `n` messages on the channel `chan`, then returns the received messages as an array. 

    take!:

      (fn- msgs chan
        (seq (for-each-seq (fn- msg (send! msg chan)) msgs)
             (closed? chan)))

`take!` throws an exception if `n` is not a positive integer, if `chan` is not a channel, or if `chan` is closed before all `n` messages have been received.

## Exports

    $export: {
      par seq choice
      chan! send! recv! close! closed? 📩:send! 📨:recv!

      all?! any?! array-chan collect! combine! count! cycle! distribute! drain!
      filter! flatten! flat-map! map! none?! pipe! recv-each! recv-until!
      round-robin! send-all! take!
    }
