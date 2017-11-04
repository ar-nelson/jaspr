# Design Rationale

I started out designing Jaspr simply because it interested me; I love functional programming, and the idea of a JSON-based Lisp seemed so obvious that I was amazed that no one had done it before. As Jaspr development continued, I decided to set out specific design goals for it, to help decide which features to keep over others.

These goals are ordered from most important to least.

 1. **Learnability**

    Jaspr should be extremely easy for experienced programmers to pick up and start using, with very few unique traits to learn. This is accomplished through minimalism, in a few ways:

    - Minimal data types: only the 6 JSON data types, with special cases for closures and channels.
    - Minimal syntax: many programmers already know both Lisp and JSON, and Jaspr's basic syntax is the union of these.
    - Minimal primitive operations: everything is immutable, the only special language features are macros and a unique approach to concurrency.
    - Minimal concurrency complexity: concurrency _just happens_, and users don't have to think about it; immutability makes this a non-issue.
    - Principle of least surprise:
      - All JSON is valid Jaspr
      - Only one kind of equality (😒 Scheme)
      - Only two kinds of sequence (arrays, channels)
      - `!` consistently denotes impure functions

 2. **Compatibility**
 
    Jaspr is designed to interoperate with existing systems written in other languages. Its focus on JSON is central to this, but also important is that its choice of naming conventions, standard library features, and integrated formats (such as JSON Schema) make integration with other languages painless.

    This is one reason I'm considering changing Jaspr's naming convention to `camelCase`. The `kebab-case` names used by Lisps aren't syntactically supported by most languages, but idiomatic Jaspr objects should be easy to deserialize in other languages without having to think about compatibility.

 3. **Correctness**

    Jaspr should make it easy to write correct code. This is a feature shared with many functional languages, and is a primary reason that Jaspr is functional, immutable, and has a limited set of data types.

    Most functional languages that emphasize correctness are statically-typed (ML, Haskell). Jaspr, like Scheme and Erlang, is functional but dynamically-typed. This is because static typing would impair Learnability (another complex detail to learn) and Compatibility (foreign APIs won't always fit into a rigid type system).

    However, most dynamically-typed languages, even functional ones, make unnecessary tradeoffs in correctness. Even without a type system, Jaspr's interpreter/compiler should warn when an undefined name is used, or when a function is passed the wrong number of arguments, or when a literal of the wrong type indicates that the arguments of a standard library function have been incorrectly transposed. This is accomplished through three features:

    - Simple pre-run checks for obvious problems, like undefined names
    - Check macros, which can warn if a function is given the wrong number of arguments or an argument is a literal of the wrong type
    - A Typescript-esque optional type system layer based on JSON Schema and check macros

 4. **Portability**

    Multiple Jaspr implementations should be possible, with as much compatibility as possible. Implementations could be interpreted or compiled, and run on PC, mobile, browser, or even embedded in other applications.

    Lisps make this easy; most of the core language features can be hidden behind macros, and macros can selectively define functions based on features available only on certain platforms.

    Jaspr's concurrency should also be portable to different platforms, even browsers. Its underlying semantics are basically CPS, which runs equally well on threads or on a JavaScript event loop.

 5. **Live Debugging**

    Jaspr's error handling and concurrency features make it possible to observe, interact with, and alter running programs. It should be possible to perform "surgery" on a running Jaspr VM, restarting a crashed fiber by inserting the value it was expecting, then patching the function that threw the exception.

 6. **Potential Clarity**

    It was hard to find the right word for this one. "Expressiveness" isn't quite correct; languages like Scala and Haskell are extremely expressive, but not very readable. At the same time, Jaspr doesn't _enforce_ readability the way Java, Go, and Python do; as a Lisp, that would be almost impossible.

    Jaspr's goals in clarity and expressiveness are closest to Ruby: there's More Than One Way To Do It, lots of syntactic constructs that do similar things, and multiple aliases for the same functions to make sure that whatever you _think_ will work probably will. The end result is that, while it's certainly possible to write messy, unreadable Jaspr code, it's also possible to write extremely clear and elegant code, to an extent not possible in more rigid languages.

    This means providing built-in macros and even syntactic shortcuts for lots of conveniences: lambdas and pattern-matching functions leave out extra parentheses that would be required in other Lisps, raw strings and multi-line strings with smart quotes are supported, ES2015-style object punning is built-in.

    Jaspr borrows a few core macros from Arc, which has a similar approach: `if` works like `cond` without the extra parentheses, `\` is like Arc's square brackets, and `let*` and `case` don't need parentheses around each binding/case. It also borrows threading macros and syntax-quote from Clojure.

 7. **Syntactic Beauty**

    This is something that I just can't help working on. There are very few languages that really, fully use Unicode; Perl 6 is the only one I can think of. Jaspr supports smart quotes and alternative paren/bracket/brace characters, has optional Unicode syntax-quote and comment characters, and has Unicode or even emoji aliases for many core library functions.
