[☙ Number Operations][prev] | [🗏 Table of Contents][toc] | [Object Operations ❧][next]
:---|:---:|---:

# Array Operations

## `len`

`(len xs)` returns the length of the array `xs`. 

>     (len '[1 2 3]) ;= 3

`len` raises a `BadArgs` error if `xs` is not an array.

## Construction Operations

### `cons`

`(cons head tail)` constructs a new array by appending the value `head` to the front of the array `tail`.

>     (cons 1 '[2 3]) ;= [1 2 3]

`cons` raises a `BadArgs` error if `tail` is not an array.

### `snoc`

A backwards `cons`. `(snoc xs x₀ x₁ … xₙ)` constructs a new array made up of the elements of `xs` with `x₀`…`xₙ` appended to the end.

>     (snoc '[1] 2) ;= [1 2]
>     (snoc '[1] 2 3) ;= [1 2 3]

`snoc` is also known as `conj`, for Clojure users. 

---

    snoc:
    (fn* args
      (assertArgs args "expected at least one argument"
                  (array? (hd args)) "not an array"
                  (p.arrayConcat (hd args) (tl args))))

### `cat`

`(cat a₀ a₁ … aₙ)` returns the concatenation of the arrays `a₀`…`aₙ`.

>     (cat)                ;= []
>     (cat '[1 2])         ;= [1, 2]
>     (cat '[1 2] '[3 4])  ;= [1, 2, 3, 4]
>     (cat '[a] '[b] '[c]) ;= ["a", "b", "c"]

    cat:
    (fn* args
      (case= (len args)
        0 []
        1 (0 args)
        2 (p.arrayConcat (0 args) (1 args))
        (p.arrayConcat (hd args) (apply cat (tl args)))))

### `range`

`(range n)` returns an array of the integers from 0 to `n`, excluding `n`.

>     (range 0) ;= []
>     (range 5) ;= [0, 1, 2, 3, 4]

`(range start end step)` returns an array of the numbers from `start` to `end`, including `start` but not `end`, counting by `step`. `step` defaults to `1` if not provided.

>     (range 1 9 2)   ;= [1, 3, 5, 7]
>     (range 1 10 2)  ;= [1, 3, 5, 7, 9]
>     (range 5 10)    ;= [5, 6, 7, 8, 9]
>     (range 0 2 0.5) ;= [0, 0.5, 1, 1.5]
>     (range 0.5 5)   ;= [0.5, 1.5, 2.5, 3.5, 4.5]

`step` can be negative if `end` is less than `start`.

>     (range 5 0 -2) ;= [5, 3, 1]
>     (range 5 0)    ;= [5, 4, 3, 2, 1]

`range` raises a `BadArgs` error if `step` is zero or `NaN`, or if the sign of `step` does not match the difference between `start` and `end`.

---

    range:
    (fn* args
      (case= (len args)
        1 (define {n: (0 args)}
            (assertArgs (integer? n) "single range argument must be integer"
              (if (pos? n) (p.arrayMake id n)
                           (p.arrayMake neg (neg n)))))
        2 (range (0 args) (1 args) (if (> (0 args) (1 args)) -1 1))
        3 (define {start: (0 args) end: (1 args) step: (2 args)
                   span: (sub end start)}
            (assertArgs (number? start) "start must be a number"
                        (number? end) "end must be a number"
                        (and step (number? step)) "step must be a nonzero number"
                        (or (= (sign span) (sign step)) (= start end))
                          "wrong sign for step"
              (p.arrayMake (\-> (mul step) (add start))
                           (ceil (div span step)))))
        (raise {
          err: 'BadArgs, why: "expected 1, 2, or 3 args",
          fn: (myName), args
        })))

### `indexes`

`(indexes xs)` returns all valid indexes of the array `xs`, that is, all integers from `0` to the length of `a`, exclusive.

>     (indexes '[]) ;= []
>     (indexes '[a b c]) ;= [0, 1, 2]

`indexes` raises a `BadArgs` error if `xs` is not an array.

    indexes: (fn- a (range (len a)))

### `flat`

`(flat xs)` returns the concatenation of the array-of-arrays `xs`.

>     (flat '[]) ;= []
>     (flat '[[1 2] [3 4]]) ;= [1, 2, 3, 4]

`flat` raises a `BadArgs` error if `xs` or any of its elements is not an array.

    flat: (fn- xs (apply cat xs))

### `transpose`

`(transpose xs)` flips a 2D array along its diagonal. That is, given an array `[r₀, r₁, …, rₙ]`, where each `r` is of length `m`, `transpose` returns an array `[c₀, c₁, …, cₘ]`, where `cᵢ` = `[(i r₀), (i r₁), …, (i rₙ)]`.

Input|Output
:---:|:----:
1 2<br>3 4<br>5 6 | 1 3 5<br>2 4 6

>     (transpose '[[1, 2], [3, 4], [5, 6]])
>       ;= [[1, 3, 5], [2, 4, 6]]
>     (transpose '[[1, 2, 3], [4, 5, 6], [7, 8, 9]])
>       ;= [[1, 4, 7], [2, 5, 8], [3, 6, 9]]
>     (transpose '[]) ;= []

If the elements of `xs` are of different lengths, `transpose` truncates longer arrays to the length of the shortest array.

>     (transpose '[[1, 2, 3, 4], [5, 6], [7, 8, 9]])
>       ;= [[1, 5, 7], [2, 6, 8]]

`transpose` raises a `BadArgs` error if `xs` is not a 2D array.

---

    transpose: (fn- xs (apply map (cons [] xs)))

### `zip`

`(zip xs₀ xs₁ … xsₙ)` constructs an array of `n + 1`-length arrays. Every `m`th element of the returned array contains the `m`th elements of each `xs₀`…`xsₙ`.

>     (zip) ;= []
>     (zip []) ;= []
>     (zip [] []) ;= []
>     (zip '[1 2] '[3 4]) ;= [[1, 3], [2, 4]]
>     (zip '[a b] '[c d] '[e f]) ;= [["a", "c", "e"], ["b", "d", "f"]]

If the arguments to `zip` are of different lengths, the returned array is the length of the shortest argument.

>     (zip '[1 2 3 4] '[a b c]) ;= [[1, "a"], [2, "b"], [3, "c"]]

`zip` raises a `BadArgs` error if any of its arguments is not an array.

---

    zip: (fn* args (transpose args))

### `reverse`

`(reverse xs)` reverses the array `xs`.

>     (reverse '[1 2 3]) ;= [3, 2, 1]

`reverse` raises a `BadArgs` error if `xs` is not an array.

---

    reverse: (fn- xs (p.arrayMake (\ (neg (inc _)) xs) (len xs)))

### `repeat`

`(repeat x n)` returns an array composed of `x` repeated `n` times.

>     (repeat "foo" 3) ;= ["foo", "foo", "foo"]
>     (repeat "bar" 0) ;= []

`repeat` raises a `BadArgs` error if `n` is not a nonnegative integer.

---

    repeat: (fn- x n (p.arrayMake (const x) n))

### `cycle`

    ; TODO: Implement cycle

## Destructuring Operations

### `hd`

Returns the _head_ (first element) of an array. `hd` raises a `BadArgs` error if its argument is not an array, or a `NoKey` error if its argument is empty.

### `tl`

Returns the _tail_ (all but the first element) of an array. `tl` raises a `BadArgs` error if its argument is empty or not an array.

### `last`

Returns the last element of an array. `last` raises a `BadArgs` error if its argument is empty or not an array.

    last: -1

### `init`

Returns all but the last element of an array.

>     (init '[1 2 3]) ;= [1, 2]

`init` raises a `BadArgs` error if its argument is empty or not an array.

---

    init:
    (fn- xs
      (assertArgs (and xs (array? xs)) "not a nonempty array"
        (p.arraySlice 0 (dec (len xs)) xs)))

### `take`

`(take n xs)` returns the first `n` elements of the array `xs`.

>     (take 2 '[1 2 3 4]) ;= [1, 2]
>     (take 0 '[1 2 3 4]) ;= []

If there are less than `n` elements in `xs`, `take` just returns `xs`.

>     (take 6 '[1 2 3]) ;= [1, 2, 3]

If `n` is negative, `take` returns the last -`n` elements of `xs` instead.

>     (take -2 '[1 2 3 4]) ;= [3, 4]
>     (take -5 '[1 2 3 4]) ;= [1, 2, 3, 4]

`take` raises a `BadArgs` error if `n` is not an integer or `xs` is not an array.

---

    take:
    (fn- n xs
      (assertArgs (integer? n) "not an integer"
                  (array? xs) "not an array"
        (if (neg? n) (p.arraySlice n (len xs) xs)
                     (p.arraySlice 0 n xs))))

### `drop`

`(drop n xs)` returns all but the first `n` elements of the array `xs`.

>     (drop 2 '[1 2 3 4]) ;= [3, 4]
>     (drop 0 '[1 2 3 4]) ;= [1, 2, 3, 4]

If there are less than `n` elements in `xs`, `drop` just returns `[]`.

>     (drop 6 '[1 2 3]) ;= []

If `n` is negative, `drop` returns all but the last -`n` elements of `xs` instead.

>     (drop -2 '[1 2 3 4]) ;= [1, 2]
>     (drop -5 '[1 2 3 4]) ;= []

`drop` raises a `BadArgs` error if `n` is not an integer or `xs` is not an array.

---

    drop:
    (fn- n xs
      (assertArgs (integer? n) "not an integer"
                  (array? xs) "not an array"
        (if (neg? n) (p.arraySlice 0 n xs)
                     (p.arraySlice n (len xs) xs))))

### `takeRight`

    takeRight: (fn- n xs (take (neg n) xs))

### `dropRight`

    dropRight: (fn- n xs (drop (neg n) xs))

### `slice`

`(slice start end xs)` returns a sublist of `xs`, from `start` (inclusive) to `end` (exclusive).

>     (slice 1 3 '[1 2 3 4 5]) ;= [2, 3]
>     (slice 1 1 '[1 2 3]) ;= []

If `end` goes over the end of `xs`, the slice goes to the end of `xs`.

>     (slice 1 100 '[1 2 3 4 5]) ;= [2, 3, 4, 5]

If `start` is greater than `end`, `slice` returns an empty array.

>     (slice 3 1 '[1 2 3 4 5]) ;= []

If either `start` or `end` is negative, they behave the same as a negative index: they count backward from the length of `xs`.

>     (slice 2 -1 '[1 2 3 4 5]) ;= [3, 4]
>     (slice -4 -1 '[1 2 3 4 5]) ;= [2, 3, 4]
>     (slice -100 2 '[1 2 3 4 5]) ;= [1, 2]

`(slice start xs)` is the same as `(slice start (len xs) xs)`.

>     (slice 3 '[1 2 3 4 5]) ;= [4 5]
>     (slice -1 '[1 2 3 4 5]) ;= [5]

`slice` raises a `BadArgs` error if `start` or `end` is not an integer, or if `xs` is not an array.

---

    slice:
    (fn* args
      (case= (len args)
        2 (define {start: (0 args) xs: (1 args)}
            (assertArgs (integer? start) "start is not an integer"
                        (array? xs) "not an array"
                        (p.arraySlice start (len xs) xs)))
        3 (define {start: (0 args) end: (1 args) xs: (2 args)}
            (assertArgs (integer? start) "start is not an integer"
                        (integer? end) "end is not an integer"
                        (array? xs) "not an array"
                        (p.arraySlice start end xs)))
        (raise {
          err: 'BadArgs why: "expected 2 or 3 arguments"
          fn: (myName) args
        })))

### `chunk`

>     (chunk 2 '[1 2 3 4 5 6]) ;= [[1, 2], [3, 4], [5, 6]]
>     (chunk 1 '[a b c]) ;= [["a"], ["b"], ["c"]]

    chunk:
    (fn- n xs
      (assertArgs (and (integer? n) (pos? n)) "not a positive integer"
                  (array? xs) "not an array"
        (p.arrayMake (\ define {m: (mul _ n)}
                               (p.arraySlice m (add m n) xs))
                     (ceil (div (len xs) n)))))

## Set Operations

### `uniq`

>     (uniq '[1 2 1 3 4 2 5 1]) ;= [1, 2, 3, 4, 5]
>     (uniq '[3 2 1]) ;= [3 2 1]
>     (uniq '[]) ;= []

    uniq:
    (fn- xs (loopAs recur {i: 0, accum: []}
      (if (< i (len xs))
          (define {x: (i xs)} (recur {
            i: (inc i),
            accum: (if (in? x accum) accum (snoc accum x))
          }))
          accum)))

### `uniq?`

>     (uniq? '[1 2 1 3 4 2 5 1]) ;= false
>     (uniq? '[3 2 1]) ;= true
>     (uniq? '[]) ;= true

    uniq?:
    (fn- xs (loopAs recur {i: 0}
      (or (>= i (len xs))
          (and (define {x: (i xs)}
                    (none? (\ = (_ xs) x) (range i)))
               (recur {i: (inc i)})))))

### `union`

    union: (fn* args (uniq (flat args)))

### `intersection`

    intersection:
    (fn* args
      (case= (len args)
        0 []
        1 (0 args)
        2 (define {a: (0 args), b: (1 args)} (filter (\ in? _ a) b))
        (apply intersection
               (cons (intersection (0 args) (1 args)) (drop 2 args)))))

### `difference`

    difference:
    (fn* args
      (case= (len args)
        0 []
        1 (0 args)
        2 (define {a: (0 args), b: (1 args)}
            (cat (reject (\ in? _ b) a)
                 (reject (\ in? _ a) b)))
        (apply difference
               (cons (difference (0 args) (1 args)) (drop 2 args)))))

### `in?`

>     (in? 1 '[1 2 3]) ;= true
>     (in? "foo" '[1 2 3]) ;= false

    in?: (fn- x xs (any? (\ = _ x) xs))

### `contains?`

>     (contains? '[1 2 3] 1) ;= true
>     (contains? '[1 2 3] "foo") ;= false

    contains?: (fn- xs x (in? x xs))

### `allIn?`

    allIn?: (fn- els container (all? (\ in? _ container) els))

### `containsAll?`

    containsAll?: (fn- container els (allIn? els container))

### `remove`

    ; TODO: Define remove

### `nil?`

Returns `true` if its argument is the empty array.

>     (nil? []) ;= true
>     (nil? '[0]) ;= false
>     (nil? null) ;= false

## Higher-Order Functions

### `all?`

`(all? f xs)` returns `true` if `f` returns a truthy value for all elements in `xs`, or a falsy value otherwise

>     (all? id '[]) ;= true
>     (all? id '[true 1 "foo"]) ;= true
>     (all? id '[true 1 "foo" false]) ;= false
>     (all? id '[null true 1 "foo"]) ;= null
>     (all? (const true) '[null true 1 "foo"]) ;= true
>     (all? number? '[1 2 3]) ;= true
>     (all? number? '[a b c]) ;= false

`all?` raises a `BadArgs` error if `xs` is not an array.

---

    all?:
    (fn- f xs
      (define {max: (len xs)}
        (loopAs recur {i: 0}
          (or (>= i max)
              (and (f (i xs)) (recur {i: (inc i)}))))))

### `any?`

`(any? f xs)` returns `false` if `f` does not return a truthy value for any element in `xs`, or a truthy value otherwise.

>     (any? id '[]) ;= false
>     (any? id '[true 1 "foo"]) ;= true
>     (any? id '[1 true "foo" false]) ;= 1
>     (any? id '[false "" 0]) ;= false
>     (any? (const 42) '[null true 1 "foo"]) ;= 42
>     (any? number? '[1 2 3]) ;= true
>     (any? number? '[a b c]) ;= false

`any?` raises a `BadArgs` error if `xs` is not an array.

---

    any?:
    (fn- f xs
      (define {max: (len xs)}
        (loopAs recur {i: 0}
          (and (< i max)
               (or (f (i xs)) (recur {i: (inc i)}))))))

### `none?`

    none?: (fn- f xs (all? (comp no f) xs))

### `makeArray`

>     (makeArray id 5) ;= [0, 1, 2, 3, 4]
>     (makeArray (const "foo") 3) ;= ["foo", "foo", "foo"]

    makeArray:
    (fn- f sz
      (assertArgs (and (integer? sz) (>= sz 0)) "not a nonnegative integer"
                  (p.arrayMake f sz)))

### `forEach`

`(forEach f xs)` calls `f` with each element in `xs`, then returns `null`. `f` is called only for its side effects, and the order of iteration is undefined and may be parallel.

>     (define {c1: (chan!), c2: (chan!), c3: (chan!)}
>       ([] (forEach (\x send! 1 x) ([] c1 c2 c3))
>           ('value (recv! c1))
>           ('value (recv! c2))
>           ('value (recv! c3)))) ;= [null, 1, 1, 1]

`(forEach f xs₀ xs₁ … xsₙ)` iterates over all of `xs₀`…`xsₙ` at the same time, passing `n` + 1 arguments to `f`. Iteration stops once the end of the shortest `xs` is reached.

>     (define {c1: (chan!), c2: (chan!), c3: (chan!)}
>       ([] (forEach send! '[a b c] ([] c1 c2 c3))
>           ('value (recv! c1))
>           ('value (recv! c2))
>           ('value (recv! c3)))) ;= [null, "a", "b", "c"]

`forEach` does not resolve until every call to `f` has resolved. This behavior is similar to `awaitAll`. `forEach` could be considered equivalent to `(await (apply awaitAll (map f xs₀ … xsₙ)) null)`, if it were possible to `apply` a macro.

>     (define {chan: (chan!)}
>       (do (await (forEach (\ await (sleep 100) (send! _ chan)) '[1 2])
>                  (send! 3 chan))
>           (await (recv! chan)
>                  (recv! chan)
>                  (recv! chan)))) ;= {value: 3, done: false}

`forEach` raises a `BadArgs` error if `xs` is not an array.

If iteration order is significant, use the stream function `forEach!` instead.

---

    forEach:
    (fn* args
      (define {xs: (apply map args), max: (len xs)}
        (loopAs next {i: 0}
          (if (< i max) (p.then (i xs) (next {i: (inc i)}))
                        null))))

### `map`

>     (map inc '[1 2 3]) ;= [2, 3, 4]
>     (map inc '[]) ;= []

>     (map sub '[4 6 2] '[1 2 3]) ;= [3, 4, -1]
>     (map sub '[4 6 2] '[1 2]) ;= [3, 4]
>     (map sub '[4 6] '[1 2 3]) ;= [3, 4]

---

    map:
    (fn* args
      (assertArgs args "expected at least 1 argument"
        (if (= 2 (len args))
            (define {f: (0 args), xs: (1 args)}
              (p.arrayMake (\ f (_ xs)) (len xs)))
            (define {f: (hd args), arrs: (tl args)}
              (p.arrayMake (\ apply f (map _ arrs))
                           (apply min (map len arrs)))))))

### `mapcat`

>     (mapcat (\ [] _ (inc _)) '[10 20 30]) ;= [10, 11, 20, 21, 30, 31]

    mapcat: (comp flat map)

### `filter`

>     (filter (const true) '[1 2 3]) ;= [1, 2, 3]
>     (filter (const false) '[1 2 3]) ;= []
>     (filter number? '[1 a 2 b 3 c]) ;= [1, 2, 3]

---

    filter:
    (fn- f xs
      (define {max: (len xs)}
        (loopAs next {i: 0, out: []}
          (if (< i max)
              (define {x: (i xs)}
                (next {i: (inc i), out: (if (f x) (snoc out x) out)}))
              out))))

### `reject`

>     (reject (const true) '[1 2 3]) ;= []
>     (reject (const false) '[1 2 3]) ;= [1, 2, 3]
>     (reject number? '[1 a 2 b 3 c]) ;= ["a", "b", "c"]

    reject: (fn- f xs (filter (comp no f) xs))

### `fold`

    ; TODO: Implement a parallel fold algorithm
    fold: reduce

### `reduce`

    reduce:
    (fn- f init xs
      (define {max: (len xs)}
        (loopAs next {i: 0, accum: init}
          (if (< i max)
              (next {i: (inc i), accum: (f accum (i xs))})
              accum))))

### `reduceRight`

    reduceRight:
    (fn- f init xs
      (loopAs next {i: (dec (len xs)), accum: init}
        (if (>= i 0)
            (next {i: (dec i), accum: (f (i xs) accum)})
            accum)))

### `takeWhile`

    ; TODO: Implement takeWhile

### `dropWhile`

    ; TODO: Implement dropWhile

### `takeRightWhile`

    ; TODO: Implement takeRightWhile

### `dropRightWhile`

    ; TODO: Implement dropRightWhile

### `find`

>     (find number? '[foo bar 1 2]) ;= 1
>     (find string? '[foo bar 1 2]) ;= "foo"
>     (find array?  '[foo bar 1 2]) ;= null

>     (find number? 1 '[foo bar 1 baz 2]) ;= 1
>     (find number? 2 '[foo bar 1 baz 2]) ;= 1
>     (find number? 3 '[foo bar 1 baz 2]) ;= 2
>     (find number? 9 '[foo bar 1 baz 2]) ;= null

    find:
    (fn* args (define {i: (apply indexWhere args)}
                (if (< i 0) null (i (last args)))))

### `findLast`

    findLast:
    (fn* args (define {i: (apply lastIndexWhere args)}
                (if (< i 0) null (i (last args)))))

### `indexOf`

>     (indexOf "bar" '[foo bar baz]) ;= 1
>     (indexOf "foo" '[foo bar baz]) ;= 0
>     (indexOf "qux" '[foo bar baz]) ;= -1

>     (indexOf 1 1 '[foo bar 1 baz 1]) ;= 2
>     (indexOf 1 2 '[foo bar 1 baz 1]) ;= 2
>     (indexOf 1 3 '[foo bar 1 baz 1]) ;= 4
>     (indexOf 1 9 '[foo bar 1 baz 1]) ;= -1

    indexOf:
    (fn* args
      (assertArgs args "expected 2 or 3 args"
        (define {x: (hd args)} (apply indexWhere (cons (\ = _ x) (tl args))))))

### `lastIndexOf`

    lastIndexOf:
    (fn* args
      (assertArgs args "expected 2 or 3 args"
        (define {x: (hd args)} (apply lastIndexWhere (cons (\ = _ x) (tl args))))))

### `indexesOf`

    indexesOf: (fn- x xs (indexesWhere (\ = _ x) xs))

### `indexWhere`

>     (indexWhere number? '[foo bar 1 2]) ;= 2
>     (indexWhere string? '[foo bar 1 2]) ;= 0
>     (indexWhere array?  '[foo bar 1 2]) ;= -1

>     (indexWhere number? 1 '[foo bar 1 baz 2]) ;= 2
>     (indexWhere number? 2 '[foo bar 1 baz 2]) ;= 2
>     (indexWhere number? 3 '[foo bar 1 baz 2]) ;= 4
>     (indexWhere number? 9 '[foo bar 1 baz 2]) ;= -1

    indexWhere:
    (fn* args
      (case= (len args)
        2 (indexWhere (0 args) 0 (1 args))
        3 (define {f: (0 args), i: (1 args), xs: (2 args)}
            (assertArgs (and (integer? i) (<= 0 i)) "not a nonnegative integer"
                        (array? xs) "not an array"
              (define {max: (len xs)}
                (loopAs next {i} (if (>= i max) -1
                                     (f (i xs)) i
                                     (next {i: (inc i)}))))))
        (raise {err: 'BadArgs why: "expected 2 or 3 args" fn: (myName) args})))

### `lastIndexWhere`

    lastIndexWhere:
    (fn* args
      (case= (len args)
        2 (lastIndexWhere (0 args) (dec (len (1 args))) (1 args))
        3 (define {f: (0 args), i: (1 args), xs: (2 args)}
            (assertArgs (and (integer? i) (<= 0 i)) "not a nonnegative integer"
                        (array? xs) "not an array"
              (loopAs next {i: (min i (dec (len xs)))}
                (if (< i 0) -1
                    (f (i xs)) i
                    (next {i: (dec i)})))))
        (raise {err: 'BadArgs why: "expected 2 or 3 args" fn: (myName) args})))

### `indexesWhere`

>     (indexesWhere (const true) '[1 2 3]) ;= [0, 1, 2]
>     (indexesWhere (const false) '[1 2 3]) ;= []
>     (indexesWhere number? '[1 a 2 b 3 c]) ;= [0, 2, 4]

---

    indexesWhere:
    (fn- f xs
      (define {max: (len xs)}
        (loopAs next {i: 0, out: []}
          (if (< i max)
              (next {i: (inc i), out: (if (f (i xs)) (snoc out i) out)})
              out))))

### `unfold`

    ; TODO: Implement unfold

### `count`

    count:
    (fn- f xs
      (define {max: (len xs)}
        (loopAs next {i: 0, n: 0}
          (if (< i max)
              (next {i: (inc i), n: (if (f (i xs)) (inc n) n)})
              n))))

### `countBy`

    countBy:
    (fn- f xs
      (define {max: (len xs)}
        (loopAs next {i: 0, out: {}}
          (if (< i max)
              (next {i: (inc i), out: (update (f (i xs)) inc 0 out)})
              out))))

### `groupBy`

    groupBy:
    (fn- f xs
      (define {max: (len xs)}
        (loopAs next {i: 0, out: {}}
          (if (< i max)
              (next { i: (inc i),
                      out: (update (f (i xs)) (\ snoc (i xs) _) [] out) })
              out))))

### `split`

>     (split "." '[1 2 . 3 4 . 5]) ;= [[1, 2], [3, 4], [5]]

    split:
    (fn- delim xs
      (reduceRight (fn- x accum
        (if (= delim x) (cons [] accum)
                        (cons (cons x (hd accum)) (tl accum))))
        '[[]] xs))

### `intercalate`

    ; TODO: Implement intercalate

## Exports

    $export: {
      snoc cat range indexes flat transpose zip reverse repeat cycle
      conj:snoc append:snoc concat:cat indices:indexes flatten:flat
      unzip:transpose ⊔:cat ⨆:flat ⧅:transpose
      ⇄:reverse ⇆:reverse 🔂:repeat 🔁:cycle

      last init take drop takeRight dropRight slice chunk

      uniq uniq? union intersection difference in? allIn? remove
      subarray? superarray?
      intersect:intersection subset?:allIn? superset?:containsAll?
      ∪:union ∩:intersection ∈:in? ∋:contains?
      ⊂:allIn? ⊃:containsAll? ⊆:allIn? ⊇:containsAll?
      ⊏:subarray? ⊐:superarray? ⊑:subarray? ⊒:superarray?

      all? any? none? makeArray forEach map mapcat filter reject fold reduce
      reduceRight takeWhile dropWhile takeRightWhile dropRightWhile find
      findLast indexOf lastIndexOf indexesOf indexWhere lastIndexWhere
      indexesWhere unfold count countBy groupBy split intercalate
      every?:all? some?:any? flatMap mapcat
      reduceLeft:reduce foldLeft:reduce foldRight:reduceRight
      indicesOf:indexesOf indicesWhere:indexesWhere
      ∀:all? ∃:any? ∄:none? 🔎:find 🔍:findLast
    }

[☙ Number Operations][prev] | [🗏 Table of Contents][toc] | [Object Operations ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: numbers.jaspr.md
[next]: objects.jaspr.md
