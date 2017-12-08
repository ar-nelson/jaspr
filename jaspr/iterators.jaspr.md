
> This file is incomplete, and is currently unused.

## Channel Operations

Jaspr defines higher-order functions over channels that correspond almost one-to-one with the higher-order functions over arrays defined in [Array Operations](arrays.jaspr.md). In general, for each array operation `x`, the corresponding channel operation is named `x!`.

### `all?!`

`(all?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them is falsy or `chan` is closed. If the result of applying `f` to a message is falsy, it returns `false` and closes `chan`; otherwise, it returns `true`.

### `any?!`

`(any?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them truthy or `chan` is closed. If the result of applying `f` to a message is truthy, it returns `true` and closes `chan`; otherwise, it returns `false`.

### `arrayChan`

`(arrayChan array)` returns a new channel. It sends the elements of `array` on the channel, in order, then closes the channel.

### `collect!`

`(collect! chan)` receives messages on `chan` until it closes, accumulating the messages into an array. When `chan` closes, it returns the array.

>     ;(collect! (arrayChan '[1 2 3])) ;= [1, 2, 3]

### `count!`

`(count! f chan)` receives messages from `chan` until `chan` is closed, and calls the predicate `f` on each of them. Once `chan` is closed, it returns the number of received messages for which `f` returned a truthy value.

### `cycle!`

`(cycle! chan)` returns a new channel. It continually receives on the channel `chan` and sends each message on the returned channel; once `chan` closes, the returned channel starts again from the beginning of the messages received from `chan`.

### `filter!`

### `flatten!`

`(flatten! chan)` returns a new channel. It continually receives on the channel `chan`, and, assuming the received are themselves channels, continually receives on each received channel until the received channel closes, then sends those messages on the new channel. Once both `chan` and all channels received from `chan` have closed, it closes the new channel.

`flatten!` throws an exception if `chan` is not a channel. It throws an exception and closes `chan` if any message received on `chan` is not a channel.

### `flatMap!`

`(flatMap! f chan)` returns a new channel. It continually receives on the channel `chan`, and, assuming the received messages are themselves channels, continually receives on each received channel until the received channel closes, then, for each received message `x`, sends `(f m)` on the new channel. Once both `chan` and all channels received from `chan` have closed, it closes the new channel.

`flatMap!` throws an exception if `chan` is not a channel. It throws an exception and closes `chan` if any message received on `chan` is not a channel.

### `map!`

`(map! f chan)` returns a new channel. It receives every message on `chan`, and, for each message `m` received, sends `(f m)` on the new channel. Once `chan` has closed and the last mapped message has been received, it closes the new channel.

### `none?!`

`(none?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them truthy or `chan` is closed. If the result of applying `f` to a message is truthy, it returns `false` and closes `chan`; otherwise, it returns `true`.

### `pipe!`

### `recvEach!`

`(recvEach! f chan)` 

### `recvUntil!`

`(recvUntil! f chan)` receives messages on `chan` and discards them until one of them satisfies the predicate `f`. It returns the first message that satisfies `f`.

`recvUntil!` throws an exception if `f` is not callable, if `chan` is not a channel, or if `chan` is closed before `recvUntil!` returns.

### `take!`

`(take! n chan)` receives `n` messages on the channel `chan`, then returns the received messages as an array. 

    take!:
    (fn- msgs chan
      (seq (forEachSeq (fn- msg (send! msg chan)) msgs)
           (closed? chan)))

`take!` throws an exception if `n` is not a positive integer, if `chan` is not a channel, or if `chan` is closed before all `n` messages have been received.
