_[Prev: Number Operations ⇦](numbers.jaspr.md) • [Table of Contents](jaspr.jaspr.md) • [⇨ Next: Object Operations](objects.jaspr.md)_

    $schema: “http://adam.nels.onl/schema/jaspr/module”

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

A backwards `cons`. `(snoc xs x0 x1 ... xn)` constructs a new array made up of the elements of `xs` with `x0`...`xn` appended to the end.

>     (snoc '[1] 2) ;= [1 2]
>     (snoc '[1] 2 3) ;= [1 2 3]

`snoc` is also known as `conj`, for Clojure users. 

---

    snoc:
    (fn* args
      (assertArgs args "expected at least one argument"
                  (array? (hd args)) "not an array"
                  ($arrayConcat (hd args) (tl args))))

### `cat`

`(cat a0 a1 ... an)` returns the concatenation of the arrays `a0`...`an`.

    cat:
    (fn* args
      (case= (len args)
        0 []
        1 (0 args)
        2 ($arrayConcat (0 args) (1 args))
        ($arrayConcat (hd args) (apply cat (tl args)))))

### `range`

### `indexes`

### `flat`

### `zip`

### `reverse`

    reverse: (fn- xs (makeArray (\->> inc neg (-> xs)) (len xs)))

### `repeat`

    repeat: (fn- n x (makeArray (const x) n))

## Destructuring Operations

### `hd`

Returns the _head_ (first element) of an array. `hd` raises a `BadArgs` error if its argument is not an array, or a `NoKey` error if its argument is empty.

### `tl`

Returns the _tail_ (all but the first element) of an array. `tl` raises a `BadArgs` error if its argument is empty or not an array.

### `last`

    last: -1

### `init`

    init: (fn- xs ($arraySlice 0 (dec (len xs)) xs))

### `take`

    take:
    (fn- n xs
      (assertArgs (integer? n) "not an integer"
                  (array? xs) "not an array"
                  ($arraySlice 0 n xs)))

### `drop`

    drop:
    (fn- n xs
      (assertArgs (integer? n) "not an integer"
                  (array? xs) "not an array"
                  ($arraySlice n (len xs) xs)))

### `takeRight`

    takeRight:
    (fn- n xs
      (assertArgs (integer? n) "not an integer"
                  (array? xs) "not an array"
                  ($arraySlice (- (len xs) n) (len xs) xs)))

### `dropRight`

    dropRight:
    (fn- n xs
      (assertArgs (integer? n) "not an integer"
                  (array? xs) "not an array"
                  ($arraySlice 0 (- (len xs) n) xs)))

### `slice`

    slice:
    (fn* args
      (case= (len args)
        2 (let {start: (0 args) xs: (1 args)}
            (assertArgs (integer? start) "start is not an integer"
                        (array? xs) "not an array"
                        ($arraySlice start (len xs) xs)))
        3 (let {start: (0 args) end: (1 args) xs: (2 args)}
            (assertArgs (integer? start) "start is not an integer"
                        (integer? end) "end is not an integer"
                        (array? xs) "not an array"
                        ($arraySlice start end xs)))
        (raise {
          err: 'BadArgs why: "expected 2 or 3 arguments"
          fn: (myName) args
        })))

### `chunk`

### `unzip`

## Set Operations

### `uniq`

### `uniq?`

### `union`

### `intersection`

### `difference`

### `contains?`

### `containsAll?`

### `remove`

### `nil?`

Returns `true` if its argument is the empty array.

## Higher-Order Functions

### `all?`

### `any?`

### `none?`

### `forRange`

### `forRangeSeries`

### `makeArray`

### `forEach`

### `forEachSeries`

### `map`

### `mapSeries`

### `mapcat`

### `mapcatSeries`

### `filter`

### `reject`

### `fold`

### `reduce`

### `reduceRight`

### `takeWhile`

### `dropWhile`

### `takeRightWhile`

### `dropRightWhile`

### `find`

### `findLast`

### `indexOf`

### `lastIndexOf`

### `indexesOf`

### `unfold`

### `count`

### `countBy`

### `groupBy`

### `split`

### `intercalate`

## Exports

    $export: {
      snoc cat range indexes flat zip reverse repeat
      conj: snoc append: snoc concat: cat indices: indexes flatten: flat

      last init take drop takeRight dropRight slice chunk unzip

      uniq uniq? union intersection difference contains? containsAll? remove
      intersect: intersection
      ∪: union ∩: intersection ∈: contains? ⊆: containsAll?

      all? any? none? forRange forRangeSeries makeArray forEach
      forEachSeries map mapSeries mapcat mapcatSeries filter reject fold
      reduce reduceRight takeWhile dropWhile takeRightWhile dropRightWhile
      find findLast indexOf lastIndexOf indexesOf unfold count countBy
      groupBy split intercalate
      every?: all? some?: any? remove: reject flatMap: mapcat
      flatMapSeries: mapcatSeries reduceLeft: reduce foldLeft: reduce
      foldRight: reduceRight indicesOf: indexesOf
      ∀: all? ∃: any? ∄: none?
    }
