# Jaspr

Jaspr is a highly concurrent, dynamically-typed functional programming language based on Lisp and JSON. It is especially well suited to processing JSON data and creating/consuming JSON APIs.

This document is both the documentation for the Jaspr programming language and a literate Jaspr program that defines the `jaspr` standard library module.

    $schema: “http://adam.nels.onl/schema/jaspr/module”
    $module: jaspr
    $version: 0.1.171121
    $author: “Adam R. Nelson <adam@nels.onl>”

## Literate Code Blocks

Because the files in this directory are literate programs, code blocks in Markdown have special semantics.

Top-level code blocks are actual Jaspr code that is part of the standard library module.

    ; This is actual Jaspr code!

Code blocks inside of blockquotes are unit tests. If the code contains a `;=` comment, it is an assertion that the code before the `;=` evaluates to the JSON data after it.

>     ; This is Jaspr unit test code!

## Table of Contents

1. [Syntax and Semantics](syntax.jaspr.md)
2. [Data Types](data-types.jaspr.md)
3. [Concurrency and Channels](concurrency.jaspr.md)
4. [Signals and Error Handling](signals-and-errors.jaspr.md)
5. [Macros](macros.jaspr.md)
6. [Number Operations](numbers.jaspr.md)
7. [Array Operations](arrays.jaspr.md)
8. [Object Operations](objects.jaspr.md)
9. [String Operations](strings.jaspr.md)
10. [Iterators and Pipelines](iterators.jaspr.md)
11. [Pattern Matching](pattern-matching.jaspr.md)
12. [Comparisons and Sorting](sorting.jaspr.md)
13. [Basic I/O](io.jaspr.md)

This index file does not contain any Jaspr code; the standard library is defined in the rest of the files in this directory.

    $include: [
      syntax.jaspr.md,
      data-types.jaspr.md,
      concurrency.jaspr.md,
      signals-errors.jaspr.md,
      macros.jaspr.md,
      numbers.jaspr.md,
      arrays.jaspr.md,
      //objects.jaspr.md,
      //strings.jaspr.md,
      //iterators.jaspr.md,
      //pattern-matching.jaspr.md,
      //sorting.jaspr.md,
      //io.jaspr.md
    ]
