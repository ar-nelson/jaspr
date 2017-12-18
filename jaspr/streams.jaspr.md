[☙ Signals and Errors][prev] | [🗏 Table of Contents][toc] | [Comparisons and Sorting ❧][next]
:---|:---:|---:

# Streams and Pipelines

A stream is a one-way channel that produces a sequence of values, then closes. Unlike arrays, streams are inherently sequential and can only be iterated over once.

Streams are useful when chaining sequence operations together, both for performance reasons (no intermediate arrays) and to guarantee sequential execution.

## Stream Producers

### `emptyStream!`

`(emptyStream!)` returns a new, closed channel.

>     (closed? (emptyStream!)) ;= true

    emptyStream!:
    (fn- (let* stream (chan!) (await (close! stream) stream)))

### `stream!`

`(stream! xs)` returns a new channel and sends the elements of the array `xs` on that channel, in order.

>     (recv! (stream! '[1 2 3])) ;= {value: 1, done: false}

>     (let {stream: (stream! '[1 2 3])}
>       (await (recv! stream)
>              (recv! stream))) ;= {value: 2, done: false}

>     (let {stream: (stream! '[1 2 3])}
>       (await (recv! stream)
>              (recv! stream)
>              (recv! stream))) ;= {value: 3, done: false}

After the last element of `xs` has been received, the returned channel is closed.

>     (let {stream: (stream! '[foo bar])}
>       (await (recv! stream)
>              (recv! stream)
>              (recv! stream))) ;= {value: null, done: true}

`stream!` raises a `BadArgs` error if `xs` is not an array.

---

    stream!: (fn- xs (assertArgs (array? xs) "not an array"
                       (apply streamOf! xs)))

### `streamOf!`

`(streamOf! x0 x1 ... xn)` returns a new channel and sends the values `x0`...`xn` on that channel, in order.

>     (recv! (streamOf! 1 2 3)) ;= {value: 1, done: false}

>     (let {stream: (streamOf! 1 2 3)}
>       (await (recv! stream)
>              (recv! stream))) ;= {value: 2, done: false}

>     (let {stream: (streamOf! 1 2 3)}
>       (await (recv! stream)
>              (recv! stream)
>              (recv! stream))) ;= {value: 3, done: false}

After the last element of `xs` has been received, the returned channel is closed.

>     (let {stream: (streamOf! 'foo 'bar)}
>       (await (recv! stream)
>              (recv! stream)
>              (recv! stream))) ;= {value: null, done: true}

---

    streamOf!:
    (fn* xs
      (let* stream (chan!)
            max (len xs)
            _ (loopAs next {i: 0}
                (if (< i max) (await (send! (i xs) stream) (next {i: (inc i)}))
                              (close! stream)))
            stream))

### `streamChars!`

    streamChars!:
    (fn- str
      (assertArgs (string? str) "not a string"
        (let* stream (chan!)
              max (chars str)
              _ (loopAs next {i: 0}
                  (if (< i max) (await (send! (char i str) stream)
                                       (next {i: (inc i)}))
                                (close! stream)))
              stream)))

### `streamCodePoints!`

    streamCodePoints!:
    (fn- str
      (assertArgs (string? str) "not a string"
        (let* stream (chan!)
              max (codePoints str)
              _ (loopAs next {i: 0}
                  (if (< i max) (await (send! (codePoint i str) stream)
                                       (next {i: (inc i)}))
                                (close! stream)))
              stream)))

### `streamBytes!`

    streamBytes!:
    (fn- str
      (assertArgs (string? str) "not a string"
        (let* stream (chan!)
              max (bytes str)
              _ (loopAs next {i: 0}
                  (if (< i max) (await (send! (byte i str) stream)
                                       (next {i: (inc i)}))
                                (close! stream)))
              stream)))

### `streamUnits!`

    streamUnits!:
    (fn- str
      (assertArgs (string? str) "not a string"
        (let* stream (chan!)
              max (units str)
              _ (loopAs next {i: 0}
                  (if (< i max) (await (send! (unit i str) stream)
                                       (next {i: (inc i)}))
                                (close! stream)))
              stream)))

### `forever!`

`(forever! x)` returns a new channel. It sends `x` on that channel repeatedly, in an infinite loop, until the channel is closed.

>     (let {foos: (forever! 'foo)}
>       ([] ('value (recv! foos))
>           ('value (recv! foos))
>           ('value (recv! foos)))) ;= ["foo", "foo", "foo"]

---

    forever!:
    (fn- x (let { out: (chan!)
                  loop: (fn (if (send! x out) (loop))) }
             (do (loop) out)))

### `iterate!`

### `upto!`

### `chain!`

    chain!: (comp chainEach! stream! [])

## Stream Converters

### `buffer!`

### `chainEach!`

`chainEach!` transforms a stream of streams into a single stream.

`(chainEach! chan)` returns a new channel. It continually receives on the channel `chan`, and, assuming the received values are themselves channels, continually receives on each received channel until the received channel closes, then sends those messages on the new channel. Once both `chan` and all channels received from `chan` have closed, it closes the new channel.

>     (->> (streamOf! (streamOf! 1 2 3) (streamOf! 4 5))
>          chainEach!
>          collect!) ;= [1, 2, 3, 4, 5]

`chainEach!` raises a `BadArgs` error if `chan` is not a channel, or if any message received on `chan` is not itself a channel.

---

    chainEach!:
    (fn in (let* out (chan!)
                 _ (await (forEach! (\ drain! _ out) in)
                          (close! out))
                 out))

### `chainMap!`

`(chainMap! f chan)` returns a new channel. It continually receives on the channel `chan`, and, assuming the received messages are themselves channels, continually receives on each received channel until the received channel closes, then, for each received message `x`, sends `(f m)` on the new channel. Once both `chan` and all channels received from `chan` have closed, it closes the new channel.

>     (->> (streamOf! 10 20 30)
>          (chainMap! (\ streamOf! _ (inc _)))
>          collect!) ;= [10, 11, 20, 21, 30, 31]

`chainMap!` raises a `BadArgs` error if `chan` is not a channel, or if `f` returns a non-channel value for any message received on `chan`.

---

    chainMap!: (comp chainEach! map!)

### `chunk!`

### `cycle!`

`(cycle! chan)` returns a new channel. It continually receives on the channel `chan` and sends each message on the returned channel; once `chan` closes, the returned channel starts again from the beginning of the messages received from `chan`.

>     (->> (streamOf! 1 2 3) cycle! (take! 7)) ;= [1, 2, 3, 1, 2, 3, 1]

`cycle!` raises a `BadArgs` error if `chan` is not a channel.

---

     cycle!: (fn in (let* [init, saved] (fork! 2 in)
                      (->> (collect! saved) forever! flatten! (chain! init))))

### `drop!`

`(drop! n chan)` receives and ignores `n` messages on `chan`, then returns `chan`.

>     (let* c (streamOf! 1 2 3)
>           d (drop! 2 c)
>           (recv! d)) ;= {value: 3, done: false}

`drop!` raises a `BadArgs` error if `n` is not a nonnegative integer or `chan` is not a channel.

--

    drop!: (fn n stream
             (await (forEach recv! (makeArray (const stream) n))
                    stream))

### `filter!`

`(filter! f chan)` returns a new channel. It receives every message on `chan`, and, for each message `m` received, sends `m` on the new channel if and only if `(f m)` is truthy. Once `chan` is closed, `filter!` closes the new channel.

>     (collect! (filter! (const true) (streamOf! 1 2 3))) ;= [1, 2, 3]
>     (collect! (filter! (const false) (streamOf! 1 2 3))) ;= []
>     (collect! (filter! odd? (streamOf! 1 2 3))) ;= [1, 3]

`filter!` raises a `BadArgs` error if `chan` is not a channel.

---

    filter!:
    (fn f in (let* out (chan!)
                   _ (await (forEach! (\ if (f _) (send! _ out)) in)
                            (close! out))
                   out))

### `flatten!`

`(flatten! chan)` transforms a stream of arrays into a stream of the arrays' elements.

>     (->> (streamOf! '[1 2] '[3 4 5]) flatten! collect!) ;= [1, 2, 3, 4, 5]

`flatten!` raises a `BadArgs` error if `chan` is not a channel, or if any message received on `chan` is not an array.

---

    flatten!:
    (fn in (let* out (chan!)
                 _ (await (forEach! (\ sendAll! _ out) in)
                          (close! out))
                 out))

### `flatMap!`

    flatMap!: (comp flatten! map!)

### `fork!`

`(fork! n chan)` return an array of `n` channels. It receives every message on `chan`, then sends those messages on each channel in the returned array. Each returned channel is closed after every message from `chan` has been received on it.

---

    fork!:
    (fn n in
      (assertArgs (and (integer? n) (pos? n)) "not a positive integer"
                  (chan? in) "not a channel"
        (let* outs (makeArray (\ chan!) n)
              _ (loopAs next {last: outs}
                  (let* {value done} (recv! in)
                    (if done (forEach (\xy await x (close! y)) last outs)
                             (let* sends (map (\ send! value _) outs)
                               (await (awaitOne sends)
                                      (next {last: sends}))))))
              outs)))

### `map!`

`(map! f chan)` returns a new channel. It receives every message on `chan`, and, for each message `m` received, sends `(f m)` on the new channel. Once `chan` has closed and the last mapped message has been received, it closes the new channel.

`map!` and `map` can be used interchangeably (with `stream!` and `collect!` to convert arrays to/from channels). `map!` processes each element in series, while `map` processes them in parallel.

---

    map!:
    (fn f
        (emptyStream!)
      . f ... ins
        (let* out (chan!)
              _ (await (apply forEach! (cons (comp (\ send! _ out) f) ins))
                       (close! out))
              out))

### `peek!`

    peek!: (fn f stream (map! (\ await (f _) _) stream))

### `reject!`

    reject!: (fn f stream (filter! (comp no f) stream))

### `roundRobin!`

`(roundRobin! n input)` creates and returns an array of `n` output channels, then receives on the channel `input` and sends each message received from `input` on one of the output channels. It cycles through the output channels with each message, restarting from the beginning when the end is reached. Over time, each output channel will be sent an equal portion of the messages received from `input`. When `input` is closed, all output channels will be closed as well.

>     (->> (streamOf! 1 2 3 4 5 6 7 8 9)
>          (roundRobin! 3)
>          (map collect!)) ;= [[1, 4, 7], [2, 5, 8], [3, 6, 9]]

`roundRobin!` raises a `BadArgs` error if `n` is not a positive integer or `input` is not a channel.

---

    roundRobin!:
    (fn n in
      (assertArgs (and (integer? n) (pos? n)) "not a positive integer"
                  (chan? in) "not a channel"
        (let* out (makeArray (\ chan!) n)
              _ (await (->> out forever! flatten! (forEach! send! in))
                       (forEach close! out))
              out)))

### `zip!`

    zip!: (partial map! [])

## Stream Consumers

### `all?!`

`(all?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them is falsy or `chan` is closed. If the result of applying `f` to any message is falsy, `all?!` returns `false`; if `chan` is closed, `all?!` returns `true`.

>     (all?! id (emptyStream!)) ;= true
>     (all?! number? (streamOf! 1 2 3)) ;= true
>     (all?! number? (streamOf! 1 null 3)) ;= false

`all?!` raises a `BadArgs` error if `chan` is not a channel.

---

    all?!:
    (fn f chan
      (awaitLet {value done} (recv! chan)
                (or done (and (f value) (all?! f chan)))))

### `any?!`

`(any?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them truthy or `chan` is closed. If the result of applying `f` to any message is truthy, `any?!` returns `true`; if `chan` is closed, `any?!` returns `false`.

>     (any?! id (emptyStream!)) ;= false
>     (any?! number? (streamOf! true false 1)) ;= true
>     (any?! number? (streamOf! true false null)) ;= false

`any?!` raises a `BadArgs` error if `chan` is not a channel.

---

    any?!:
    (fn f chan
      (awaitLet {value done} (recv! chan)
                (and (no done) (or (f value) (any?! f chan)))))

### `collect!`

`(collect! chan)` receives messages on `chan` until it closes, accumulating the messages, in order, into an array. When `chan` closes, it returns the array.

>     (collect! (streamOf! 1 2 3)) ;= [1, 2, 3]

`collect!` raises a `BadArgs` error if `chan` is not a channel.

---

    collect!: (\ reduce! snoc [] _)

### `collectEntries!`

`(collectEntries! chan)` receives messages on `chan` until it closes, accumulating the messages (which should be `[key, value]` pairs) into an object. When `chan` closes, it returns the object.

>     (collectEntries! (streamOf! '[foo 1] '[bar 2])) ;= {foo: 1, bar: 2}

`collectEntries!` raises a `BadArgs` error if `chan` is not a channel, of if any message received on `chan` is not a 2-element array where the first element is a string.

---

    collectEntries!:
    (\ catch (reduce! (fn obj [k v] (withKey k v obj)) {} _)
        {err: 'BadArgs, fn} (raise {
          err: 'BadArgs, args: ([] _), fn: (myName),
          why: (if (= fn `reduce!)
                   "not a channel"
                   "stream element was not a [key, value] pair")
        }))

### `collectString!`

`(collectString! chan)` receives messages on `chan` until it closes, accumulating the string representations of the messages, in order. When `chan` closes, it returns the concatenated strings.

>     (collectString! (streamOf! "the meaning of life is " 42 "."))
>       ;= "the meaning of life is 42."

`collectString!` raises a `BadArgs` error if `chan` is not a channel.

---

    collectString!: (\ reduce! str "" _)

### `count!`

`(count! f chan)` receives messages from `chan` until `chan` is closed, and calls the predicate `f` on each of them. Once `chan` is closed, it returns the number of received messages for which `f` returned a truthy value.

>     (count! number? (streamOf! 1 'foo 2 'bar 3)) ;= 3

`count!` raises a `BadArgs` error if `chan` is not a channel.

---

    count!: (fn f chan (reduce! (\xy if (f y) (inc x) x) 0 chan))

### `forEach!`

`(forEach! f stream)` receives repeatedly on the channel `stream`, and calls `f` with each received value before receiving the next one. When `stream` is closed, `forEach!` stops iterating and returns `null`. `f` is called only for its side effects. The elements of `stream` are iterated over in order, and `forEach!` waits for each call to `f` to resolve before starting the next one.

>     (let* c (chan!)
>           _ (forEach! (\x send! x c) (streamOf! 1 2 3))
>           (await (recv! c) (recv! c) (recv! c))) ;= {value: 3, done: false}

`(forEach! f s₀ s₁ … sₙ)` receives on the channels `s₀`…`sₙ` at the same time, passing `n` + 1 arguments to `f`. Iteration stops once any of the streams is closed.

>     (let* c1 (chan!) c2 (chan!) c3 (chan!)
>       ([] (forEach! (\xy send! y x) (streamOf! c1 c2 c3) (stream! '[a b c]))
>           ('value (recv! c1))
>           ('value (recv! c2))
>           ('value (recv! c3)))) ;= [null, "a", "b", "c"]

`forEach!` does not resolve until every call to `f` has resolved. This behavior is similar to `await`.

>     (let* chan (chan!)
>       (do (await (forEach! (\ await (sleep 100) (send! _ chan)) (streamOf! 1 2))
>                  (send! 3 chan))
>           (await (recv! chan)
>                  (recv! chan)
>                  (recv! chan)))) ;= {value: 3, done: false}

`forEach!` and `forEach` can be used interchangeably (with `stream!` and `collect!` to convert arrays to/from channels). `forEach!` processes each element in series, while `forEach` processes them in parallel.

`forEach!` raises a `BadArgs` error if any `s` is not a channel.

---

    forEach!:
    (fn f
        null
      . f stream
        (loopAs next {}
          (awaitLet {value done} (recv! stream)
            (if (no done) (await (f value) (next {})))))
      . f ... streams
        (loopAs next {}
          (let* recvs (map recv! streams)
            (if (none? 'done recvs)
                (await (apply f (map 'value recvs)) (next {}))))))

### `forEachWhile!`

### `none?!`

`(none?! f chan)` receives messages on `chan` until the result of applying the predicate `f` to one of them truthy or `chan` is closed. If the result of applying `f` to a message is truthy, it returns `false` and closes `chan`; otherwise, it returns `true`.

### `reduce!`

    reduce!:
    (fn f init stream
      (assertArgs (chan? stream) "not a channel"
        (loopAs next {accum: init}
          (awaitLet {value done} (recv! stream)
            (if done accum (await accum (next {accum: (f accum value)})))))))

### `take!`

`(take! n chan)` receives `n` messages on the channel `chan`, then returns the received messages as an array.

If `chan` is closed before `n` messages have been received, `take!` may return less than `n` messages.

`take!` raises a `BadArgs` error if `n` is not a positive integer or if `chan` is not a channel.

---

    take!:
    (fn n chan
      (assertArgs (and (integer? n) (>= n 0)) "not a nonnegative integer"
                  (chan? chan) "not a channel"
        (loopAs next {out: [], n}
          (if n (awaitLet {value done} (recv! chan)
                  (if done out (next {out: (snoc out value), n: (dec n)})))
                out))))

## Exports

    $export: {

    }

[☙ Signals and Errors][prev] | [🗏 Table of Contents][toc] | [Comparisons and Sorting ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: signals-errors.jaspr.md
[next]: sorting.jaspr.md
