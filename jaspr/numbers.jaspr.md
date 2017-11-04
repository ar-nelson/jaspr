
    $schema: “http://adam.nels.onl/schema/jaspr/module”

# Number Operations

## Arithmetic

### `add`

Returns the sum of its arguments. Throws an exception if any of its arguments are not numbers.

>     (add 1 2 3) ;= 6

The alias `+` is preferred.

    add: (fn* args (sum args))

### `div`

`(div dividend divisor)` returns the quotient of `dividend` and `divisor`. Division by zero returns `NaN`. `div` throws an exception if either of its arguments is not a number.

    div:
    (fn- dividend divisor
      (if (no (number? dividend))
            (throw {err: "dividend is not a number", fn: "div",
                    args: ([] dividend divisor)})
          (no (number? divisor))
            (throw {err: "divisor is not a number", fn: "div",
                    args: ([] dividend divisor)})
          ($divide dividend divisor)))

### `dn`

`(dn n)` returns the predecessor of `n` (i.e., `n` - 1). `dn` throws an exception if `n` is not a number.

>     (dn 4) ;= 3

    dn: (fn- n (if (number? n)
                   ($subtract n 1)
                   (throw {err: "not a number", fn: "dn", args: `[~n]})))

### `minus`

`minus` (more commonly used via its alias `-`) is equivalent to either `neg` or `sub`, depending on its number of arguments.

`(minus x)` returns the negation of the number `x`.

>     (minus 42)  ;= -42
>     (minus -91) ;= 91

`(minus x0 x1 … xn)` returns the value of `x0` − `x1` − … − `xn`.

>     (minus 5 3)      ;= 2
>     (minus 10 5 -10) ;= 15

`minus` throws an exception if it receives 0 arguments or if any of its arguments are not numbers.

    minus: (fn* args (if ($equals 1 (len args))
                         (neg (0 args))
                         (apply sub args)))

### `mod`

`(mod dividend divisor)` returns the modulus of `dividend` and `divisor`. Modulus by zero returns `NaN`. `mod` throws an exception if either of its arguments is not a number.

The distinction between remainder (`rem`/`%`) and modulus (`mod`) is that the _remainder_ has the same sign as the _dividend_, while the _modulus_ has the same sign as the _divisor_.

    mod:
    (fn- dividend divisor
      (if (no (number? dividend))
            (throw {err: "dividend is not a number", fn: "mod",
                    args: ([] dividend divisor)})
          (no (number? divisor))
            (throw {err: "divisor is not a number", fn: "mod",
                    args: ([] dividend divisor)})
          ($modulus dividend divisor)))

### `mul`

Returns the product of its arguments. Throws an exception if any of its arguments are not numbers.

>     (mul 6 7 -1) ;= -42

The alias `*` or `×` is preferred.

    mul: (fn* args (product args))

### `neg`

Negates its argument. Throws an exception if its argument is not a number.

>     (neg 42)  ;= -42
>     (neg -91) ;= 91

The alias `-` of `minus`, which has the same functionality when called with one argument, is preferred.

    neg: (fn- n (if (number? n)
                    ($negate n)
                    (throw {err: "not a number", fn: "neg", args: `[~n]})))

### `product`

`(product xs)` returns the product of the numbers in the array `xs`. Throws an exception if `xs` is not an array of numbers.

    product:
    (fn- xs
      (reduce (\xy $multiply x (if (number? y) y
                                   (throw {err: "term is not a number",
                                           fn: "product", term: y})))
              0 xs))

### `rem`

`(rem dividend divisor)` returns the remainder of `dividend` and `divisor`. Division by zero returns `NaN`. `rem` throws an exception if either of its arguments is not a number.

The distinction between remainder (`rem`/`%`) and modulus (`mod`) is that the _remainder_ has the same sign as the _dividend_, while the _modulus_ has the same sign as the _divisor_.

    rem:
    (fn- dividend divisor
      (if (no (number? dividend))
            (throw {err: "dividend is not a number", fn: "rem",
                    args: ([] dividend divisor)})
          (no (number? divisor))
            (throw {err: "divisor is not a number", fn: "rem",
                    args: ([] dividend divisor)})
          ($remainder dividend divisor)))

### `sub`

### `sum`

`(sum xs)` returns the sum of the numbers in the array `xs`. `sum` throws an exception if `xs` is not an array of numbers.

    sum:
    (fn- xs
      (reduce (\xy $add x (if (number? y) y
                              (throw {err: "term is not a number",
                                      fn: "sum", term: y})))
              0 xs))

### `up`

`(up n)` returns the successor of `n` (i.e., `n` + 1). `up` throws an exception if `n` is not a number.

>     (up 3) ;= 4

    up: (fn- n (if (number? n)
                   ($add n 1)
                   (throw {err: "not a number", fn: "up", args: `[~n]})))

## Exponents, Roots and Logarithms

### `cbrt`

    cbrt: (\ $cbrt _)

### `pow`

    pow: (\xy $pow x y)

### `sqrt`

    sqrt: (\ $sqrt _)

### `log`

    log: (\ $log _)

### `log2`

    log2: (\ $log2 _)

### `log10`

    log10: (\ $log10 _)

## Comparison

### `<`

Less-than operator. Returns `true` if all of its arguments are ordered from least to greatest and none of them are equal, `false` otherwise. Throws an exception if any of its arguments are not numbers.

    <: (fn* xs (->> xs len dn range (all? (\ $less (_ xs) ((up _) xs)))))
    
### `<=`

Less-than-or-equal operator. Returns `true` if all of its arguments are ordered from least to greatest, `false` otherwise. Throws an exception if any of its arguments are not numbers.

    <=:
    (fn* xs (->> xs len dn range (all? (\ $less-or-equal (_ xs) ((up _) xs)))))

### `>`

Greater-than operator. Returns `true` if all of its arguments are ordered from greatest to least and none of them are equal, `false` otherwise. Throws an exception if any of its arguments are not numbers.

    >: (fn* xs (->> xs len dn range (all? (\ $less ((up _) xs) (_ xs)))))

### `>=`

Greater-than-or-equal operator. Returns `true` if all of its arguments are ordered from greatest to least, `false` otherwise. Throws an exception if any of its arguments are not numbers.

    >=:
    (fn* xs (->> xs len dn range (all? (\ $less-or-equal ((up _) xs) (_ xs)))))

### `max`

### `min`

## Predicates and Rounding

    floor: (\ $floor _)
    ceil: (\ $ceil _)
    round: (\ $round _)
    abs: (\ $abs _)
    sign: (\ if (pos? _) 1 (neg? _) -1 (NaN? _) NaN 0)
    pos? (\ < 0 _)
    neg? (\ > 0 _)
    even?: (\-> (mod 2) (= 0))
    odd?: (\-> (mod 2) (= 1))
    integer?: (\ and (number? _) (no (NaN? _)) (finite? _) (= _ (floor _)))
    finite?: (\ $is-finite _)
    infinite?: (\ no ($is-finite _))
    NaN?: (\ $is-NaN _)

## Trigonometry

    sin: (\ $sin _)
    cos: (\ $cos _)
    tan: (\ $tan _)
    asin: (\ $asin _)
    acos: (\ $acos _)
    atan: (\ $atan _)
    atan2: (\xy $atan2 x y)
    sinh: (\ $sinh _)
    cosh: (\ $cosh _)
    tanh: (\ $tanh _)
    asinh: (\ $asinh _)
    acosh: (\ $acosh _)
    atanh: (\ $atanh _)
    hypot: (\xy $hypot x y)

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
      add sub mul neg div rem mod minus pow up dn sum product < <= > >= min max
      pow sqrt cbrt log log2 log10
      finite? infinite? NaN? pos? neg? even? odd? integer?
      floor ceil round abs sign
      sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh hypot
      pi e sqrt2 sqrt1/2 ln2 ln10 log2e log10e 
      
      +:add *:mul ×:mul ✕:mul -:minus −:minus ÷:div %:rem ↑:up ↓:dn
      ∑:sum ∏:product √:sqrt ∛:cbrt expt:pow =<:<= ≤:<= ≥:>= ∞?:infinite?
      ⌊:floor ⌈:ceil |:abs ±:sign ∟:hypot ∠:atan2 π:pi √2:sqrt2 √½:sqrt1/2

      ➕:add ➖:minus ✖:mul ➗:div
    }
