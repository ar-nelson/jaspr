[☙ Array Operations][prev] | [🗏 Table of Contents][toc] | [String Operations ❧][next]
:---|:---:|---:

# Object Operations

    ; TODO: Define object operations

## `hasKey?`

## `hasKeys?`

    hasKeys?:
    (fn* args
      (assertArgs args "expected at least one argument"
        (define {obj: (last args)}
          (all? (\ hasKey? _ obj) (init args)))))

## `withKey`

## `withoutKey`

## `keys`

## `values`

## `entries`

    entries: (fn- obj (map (\ [] _ (_ obj)) (keys obj)))

## `fromEntries`

    fromEntries:
    (fn- xs (reduce (fn- accum kv (withKey (0 kv) (1 kv) accum)) {} xs))

## `size`

    size: (fn- obj (len (kays obj)))

## `merge`

    merge:
    (fn* args
      (if args
          (assertArgs (object? (hd args)) "not an object"
            (reduce (fn- accum kv (withKey (0 kv) (1 kv) accum))
                    (hd args)
                    (mapcat entries (tl args))))
          {}))

## `mergeWith`

## `pick`

## `omit`

## `mapKeys`

## `mapValues`

## `mapEntries`

## `mapMerge`

## `filterKeys`

## `filterValues`

## `filterEntries`

## `subobject?`

## `superobject?`

## Exports

    $export: {
      hasKeys? entries fromEntries size merge mergeWith pick omit
      mapKeys mapValues mapEntries mapMerge filterKeys filterValues
      filterEntries subobject? superobject?
      ⪽:subobject? ⪾:superobject?
    }

[☙ Array Operations][prev] | [🗏 Table of Contents][toc] | [String Operations ❧][next]
:---|:---:|---:

[toc]: jaspr.jaspr.md
[prev]: arrays.jaspr.md
[next]: strings.jaspr.md
