[☙ Macros][prev] | [🗏 Table of Contents][toc] | [Array Operations ❧][next]
:---|:---:|---:

    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Number Operations

## Arithmetic

### `add`

Returns the sum of its arguments. Raises a `BadArgs` error if any of its arguments are not numbers.

>     (add 1 2 3) ;= 6

The alias `+` is preferred.

---

    add:
    (fn* args
      (case= (len args)
        2 (assertArgs (number? (0 args)) "not a number"
                      (number? (1 args)) "not a number"
                      (p.add (0 args) (1 args)))
        0 0
        (assertArgs (number? (hd args)) "not a number"
                    (p.add (hd args) (apply add (tl args))))))


### `dec`

`(dec n)` returns the predecessor of `n` (i.e., `n` - 1).

>     (dec 4) ;= 3

`dec` raises a `BadArgs` error if `n` is not a number.

---

    dec: (fn- n (assertArgs (number? n) "not a number"
                            (p.subtract n 1)))

### `div`

`(div dividend divisor)` returns the quotient of `dividend` and `divisor`. Division by zero returns `NaN`. `div` raises a `BadArgs` error if either of its arguments is not a number.

---

    div:
    (fn- dividend divisor
      (assertArgs (number? dividend) "dividend is not a number"
                  (number? divisor) "divisor is not a number"
                  (p.divide dividend divisor)))

### `inc`

`(inc n)` returns the successor of `n` (i.e., `n` + 1).

>     (inc 3) ;= 4

`inc` throws a `BadArgs` error if `n` is not a number.

---

    inc: (fn- n (assertArgs (number? n) "not a number"
                            (p.add n 1)))

### `minus`

`minus` (more commonly used via its alias `-`) is equivalent to either `neg` or `sub`, depending on its number of arguments.

`(minus x)` returns the negation of the number `x`.

>     (minus 42)  ;= -42
>     (minus -91) ;= 91

`(minus x0 x1 … xn)` returns the value of `x0` − (`x1` − (… − `xn`)).

>     (minus 5 3)      ;= 2
>     (minus 10 5 -10) ;= -5

`minus` Raises a `BadArgs` error if it receives 0 arguments or if any of its arguments are not numbers.

---

    minus: (fn* args (if (p.is? 1 (len args))
                         (neg (0 args))
                         (apply sub args)))

### `mod`

`(mod dividend divisor)` returns the modulus of `dividend` and `divisor`. Modulus by zero returns `NaN`. `mod` raises a `BadArgs` error if either of its arguments is not a number.

The distinction between remainder (`rem`/`%`) and modulus (`mod`) is that the _remainder_ has the same sign as the _dividend_, while the _modulus_ has the same sign as the _divisor_.

---

    mod:
    (fn- dividend divisor
      (assertArgs (number? dividend) "dividend is not a number"
                  (number? divisor) "divisor is not a number"
                  (p.modulus dividend divisor)))

### `mul`

Returns the product of its arguments. Raises a `BadArgs` error if any of its arguments are not numbers.

>     (mul 6 7 -1) ;= -42

The alias `*` or `×` is preferred.

---

    mul:
    (fn* args
      (case= (len args)
        2 (assertArgs (number? (0 args)) "not a number"
                      (number? (1 args)) "not a number"
                      (p.multiply (0 args) (1 args)))
        0 1
        (assertArgs (number? (hd args)) "not a number"
                    (p.multiply (hd args) (apply mul (tl args))))))

### `neg`

Negates its argument. Raises a `BadArgs` error if its argument is not a number.

>     (neg 42)  ;= -42
>     (neg -91) ;= 91

The alias `-` of `minus`, which has the same functionality when called with one argument, is preferred.

---

    neg: (fn- n (assertArgs (number? n) "not a number"
                            (p.negate n)))

### `product`

`(product xs)` returns the product of the numbers in the array `xs`.

>     (product '[2 3 4]) ;= 24

`(product xs)` is semantically equivalent to `(apply mul xs)`, but it uses `fold` for better performance on large lists. It raises a `BadArgs` error if `xs` is not an array of numbers.

---

    product: (fn- xs (fold (\xy p.multiply x y) 1 xs))

### `rem`

`(rem dividend divisor)` returns the remainder of `dividend` and `divisor`. Division by zero returns `NaN`. `rem` raises a `BadArgs` error if either of its arguments is not a number.

The distinction between remainder (`rem`/`%`) and modulus (`mod`) is that the _remainder_ has the same sign as the _dividend_, while the _modulus_ has the same sign as the _divisor_.

---

    rem:
    (fn- dividend divisor
      (assertArgs (number? dividend) "dividend is not a number"
                  (number? divisor) "divisor is not a number"
                  (p.remainder dividend divisor)))

### `sub`

Returns the (right-associative) difference of its arguments. Raises a `BadArgs` error if any of its arguments are not numbers.

>     (sub 5 3) ;= 2
>     (sub 5 3 2) ;= 4

The alias `-` of `minus`, which has the same functionality when called with more than one argument, is preferred.

---

    sub:
    (fn* args
      (case= (len args)
        2 (assertArgs (number? (0 args)) "not a number"
                      (number? (1 args)) "not a number"
                      (p.subtract (0 args) (1 args)))
        0 0
        (assertArgs (number? (hd args)) "not a number"
                    (p.subtract (hd args) (apply sub (tl args))))))

### `sum`

`(sum xs)` returns the sum of the numbers in the array `xs`.

>     (sum '[2 3 4]) ;= 9

`(sum xs)` is semantically equivalent to `(apply add xs)`, but it uses `fold` for better performance on large lists. It raises a `BadArgs` error if `xs` is not an array of numbers.

---

    sum: (fn- xs (fold (\xy p.add x y) 0 xs))

## Exponents, Roots and Logarithms

### `cbrt`

    cbrt: (\ p.cbrt _)

### `pow`

    pow: (\xy p.pow x y)

### `sqrt`

    sqrt: (\ p.sqrt _)

### `log`

    log: (\ p.log _)

### `log2`

    log2: (\ p.log2 _)

### `log10`

    log10: (\ p.log10 _)

## Comparison

### `<`

Less-than operator. Returns `true` if all of its arguments are ordered from least to greatest and none of them are equal, `false` otherwise.

>     (< 1 2) ;= true
>     (< 2 1) ;= false
>     (< 1 1) ;= false
>     (< 1 2 3 4 5) ;= true
>     (< 1 2 3 3 5) ;= false
>     (< 5 4 3 2 1) ;= false

`<` raises a `BadArgs` error if any of its arguments are not numbers.

---

    <:
    (fn* args
      (assertArgs (p.< 1 (len args)) "expected 2 or more arguments"
                  (number? (0 args)) "not a number"
                  (number? (1 args)) "not a number"
        (and (p.< (0 args) (1 args))
             (or (p.is? (len args) 2)
                 (apply < (tl args))))))
    
### `<=`

Less-than-or-equal operator. Returns `true` if all of its arguments are ordered from least to greatest, `false` otherwise.

>     (<= 1 2) ;= true
>     (<= 2 1) ;= false
>     (<= 1 1) ;= true
>     (<= 1 2 3 4 5) ;= true
>     (<= 1 2 3 3 5) ;= true
>     (<= 5 4 3 2 1) ;= false

`<=` raises a `BadArgs` error if any of its arguments are not numbers.

---

    <=:
    (fn* args
      (assertArgs (p.< 1 (len args)) "expected 2 or more arguments"
                  (number? (0 args)) "not a number"
                  (number? (1 args)) "not a number"
        (and (p.<= (0 args) (1 args))
             (or (p.is? (len args) 2)
                 (apply <= (tl args))))))

### `>`

Greater-than operator. Returns `true` if all of its arguments are ordered from greatest to least and none of them are equal, `false` otherwise.

>     (> 1 2) ;= false
>     (> 2 1) ;= true
>     (> 1 1) ;= false
>     (> 1 2 3 4 5) ;= false
>     (> 5 3 3 2 1) ;= false
>     (> 5 4 3 2 1) ;= true

`>` raises a `BadArgs` error if any of its arguments are not numbers.

---

    >:
    (fn* args
      (assertArgs (p.< 1 (len args)) "expected 2 or more arguments"
                  (number? (0 args)) "not a number"
                  (number? (1 args)) "not a number"
        (and (p.< (1 args) (0 args))
             (or (p.is? (len args) 2)
                 (apply > (tl args))))))

### `>=`

Greater-than-or-equal operator. Returns `true` if all of its arguments are ordered from greatest to least, `false` otherwise.

>     (>= 1 2) ;= false
>     (>= 2 1) ;= true
>     (>= 1 1) ;= true
>     (>= 1 2 3 4 5) ;= false
>     (>= 5 3 3 2 1) ;= true
>     (>= 5 4 3 2 1) ;= true

`>=` raises a `BadArgs` error if any of its arguments are not numbers.

---

    >=:
    (fn* args
      (assertArgs (p.< 1 (len args)) "expected 2 or more arguments"
                  (number? (0 args)) "not a number"
                  (number? (1 args)) "not a number"
        (and (p.<= (1 args) (0 args))
             (or (p.is? (len args) 2)
                 (apply >= (tl args))))))

### `max`

    max:
    (fn* ns
      (case= (len ns)
        0 0
        1 (0 ns)
        2 (let {a:(0 ns) b:(1 ns)}
            (if (> a b) a b))
        (let {half: (floor (div (len ns) 2))}
          (max (apply max (p.arraySlice 0 half ns))
               (apply max (p.arraySlice half (len ns) ns))))))

### `min`

    min:
    (fn* ns
      (case= (len ns)
        0 0
        1 (0 ns)
        2 (let {a:(0 ns) b:(1 ns)}
            (if (< a b) a b))
        (let {half: (floor (div (len ns) 2))}
          (min (apply min (p.arraySlice 0 half ns))
               (apply min (p.arraySlice half (len ns) ns))))))

### `kronecker`

The [Kronecker delta](https://en.wikipedia.org/wiki/Kronecker_delta) function _δ_. `(kronecker i j)` returns `1` if `i` = `j`, `0` otherwise.

>     (kronecker 42 42) ;= 1
>     (kronecker 1 2) ;= 0

The preferred alias of this function is `δ`, which allows `(δ i j)` to be used as shorthand for `(if (= i j) 1 0)`.

---

    kronecker: (fn- i j (if (= i j) 1 0))

## Predicates and Rounding

    floor: (\ p.floor _)
    ceil: (\ p.ceil _)
    round: (\ p.round _)
    abs: (\ p.abs _)
    sign: (\ if (pos? _) 1 (neg? _) -1 (NaN? _) NaN 0)
    pos?: (\ < 0 _)
    neg?: (\ > 0 _)
    zero?: (\ p.is? 0 _)
    even?: (\-> (mod 2) (= 0))
    odd?: (\-> (mod 2) (= 1))
    integer?: (\ and (number? _) (no (NaN? _)) (finite? _) (= _ (floor _)))
    finite?: (\ p.finite? _)
    infinite?: (\ no (p.finite? _))
    NaN?: (\ p.NaN? _)

## Trigonometry

    sin: (\ p.sin _)
    cos: (\ p.cos _)
    tan: (\ p.tan _)
    asin: (\ p.asin _)
    acos: (\ p.acos _)
    atan: (\ p.atan _)
    atan2: (\xy p.atan2 x y)
    sinh: (\ p.sinh _)
    cosh: (\ p.cosh _)
    tanh: (\ p.tanh _)
    asinh: (\ p.asinh _)
    acosh: (\ p.acosh _)
    atanh: (\ p.atanh _)
    hypot: (\xy p.hypot x y)

## Constants

    pi: 3.141592653589793
    e: 2.718281828459045
    sqrt2: 1.4142135623730951
    sqrt1/2: 0.7071067811865476
    ln2: 0.6931471805599453
    ln10: 2.302585092994046
    log2e: 1.4426950408889634
    log10e: 0.4342944819032518

## Exports

    $export: {
      add sub mul neg div rem mod minus pow inc dec sum product < <= > >=
      min max kronecker pow sqrt cbrt log log2 log10
      finite? infinite? NaN? pos? neg? even? odd? zero? integer?
      floor ceil round abs sign
      sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh hypot
      pi e sqrt2 sqrt1/2 ln2 ln10 log2e log10e 
      
      +:add *:mul ×:mul ✕:mul -:minus −:minus ÷:div %:rem ↑:inc ↓:dec
      ∑:sum ∏:product √:sqrt ∛:cbrt expt:pow =<:<= ≤:<= ≥:>= ∞?:infinite?
      ⌊:floor ⌈:ceil |:abs ±:sign ∟:hypot ∠:atan2 π:pi √2:sqrt2 √½:sqrt1/2
      δ:kronecker

      ➕:add ➖:minus ✖:mul ➗:div
    }

[☙ Macros][prev] | [🗏 Table of Contents][toc] | [Array Operations ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: macros.jaspr.md
[next]: arrays.jaspr.md
