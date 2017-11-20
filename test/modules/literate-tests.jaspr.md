# Literate Program with Tests

    $schema: "http://adam.nels.onl/schema/jaspr/module"
    $module: jaspr-tests.literate-tests
    $version: "1.0"
    $import: {jaspr.primitive}

Literate Jaspr programs can contain unit tests. Unit tests are indented code blocks inside of blockquotes. Each expression becomes a unit test; a test passes if it returns a truthy value.

>     true ; trivial test, always passes
>
>     (jaspr.primitive.is? (jaspr.primitive.add 2 2) 4) ; basic arithmetic

## Heading 1

The sequence `;=` gets transformed into `jaspr.primitive.assertDeepEquals`.

>     (jaspr.primitive.add 2 2) ;= 4

## Heading 2

The right side of `;=` is not evaluated.

>     ([] 'a 'b 'c) ;= ["a", "b", "c"]
