# Jaspr

Jaspr is a highly concurrent, dynamically-typed functional programming language based on Lisp and JSON. It is especially well suited to processing JSON data and creating/consuming JSON APIs.

This document is both the documentation for the Jaspr programming language and a literate Jaspr program that defines the `jaspr` standard library module.

    $schema: “http://adam.nels.onl/schema/jaspr/module”
    $module: jaspr
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
4. [Macros](macros.jaspr.md)
5. [Array Operations](arrays.jaspr.md)
6. [Object Operations](objects.jaspr.md)
7. [Function Operations](functions.jaspr.md)
8. [String Operations](strings.jaspr.md)
9. [Pattern Matching](pattern-matching.jaspr.md)
10. [Comparisons and Sorting](comparisons.jaspr.md)
11. [Basic I/O](io.jaspr.md)

This index file does not contain any Jaspr code; the standard library is defined in the rest of the files in this directory.

    $include: [
      syntax.jaspr.md,
      data-types.jaspr.md,
      concurrency.jaspr.md,
      macros.jaspr.md,
      //arrays.jaspr.md,
      //objects.jaspr.md,
      //functions.jaspr.md,
      //strings.jaspr.md,
      //pattern-matching.jaspr.md,
      //comparisons.jaspr.md,
      //io.jaspr.md
    ]
