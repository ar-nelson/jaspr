/* 
 * --- Jaspr Source Parser ---
 * Adam R. Nelson <adam@nels.onl>
 *
 * A Clojure-like syntax that parses to JSON.
 *
 * All JSON is valid Jaspr. Commas are whitespace, and strings may be unquoted.
 * Arrays may be written with parentheses, making Lisp forms valid Jaspr as
 * well. Within parenthesized lists, ""-quoted strings are surrounded by a quote
 * macro to simulate Lisp's symbol/string distinction. Clojure's quote (') and
 * syntax-quote (` ~ ~@) syntaxes are also supported.
 */

const p = require('parsimmon')
const _ = require('lodash')

const lineComment =
  p.string('//').then(p.takeWhile(x => x != '\n')).desc('line comment')

const inBlockComment =
  p.string('*/').result("").or(p.seqMap(
    p.takeWhile(x => x != '*'),
    p.lazy(() => inBlockComment),
    (a, b) => a + b))

const blockComment =
  p.string('/*').then(inBlockComment).desc('block comment')

const whitespace = p.alt(
    p.regex(/[\s,]+/).desc('whitespace'),
    lineComment,
    blockComment
  ).many().result(null)

const literal = p.alt(
  p.string("null").result(null),
  p.string("true").result(true),
  p.string("false").result(false),
  p.regex(/[+-]?\d+(\.\d+)?([eE][+-]?\d+)?/).map(parseFloat).desc('number'))

const unquoted = p.regex(/[^()\[\]{}.,:;'"`~\s]+/).desc('string')

const escape = p.string('\\').then(p.alt(
  p.string('n').result('\n'),
  p.string('r').result('\r'),
  p.string('t').result('\t'),
  p.string('b').result('\b'),
  p.string('f').result('\f'),
  p.string('v').result('\v')))

const inQuoted =
  p.string('"').result("").or(p.seqMap(
    escape.or(p.takeWhile(x => x != '"' && x != '\\')),
    p.lazy(() => inQuoted),
    (a, b) => a + b))

const quoted = p.string('"').then(inQuoted).desc('quoted string')

const quoteChar = p.alt(
  p.string("'").result(null),
  p.string("`").result(true),
  p.string("~@").result([false]),
  p.string("~").result(false))

const quote = p.seq(quoteChar, p.lazy(() => value))
const lQuote = p.seq(quoteChar, p.lazy(() => lValue))

const array = whitespace.skip(p.string("[")).then(p.lazy(() => value.many()))
                        .skip(whitespace).skip(p.string("]")).desc('array')

const lArray = whitespace.skip(p.string("(")).then(p.lazy(() => lValue.many()))
                         .skip(whitespace).skip(p.string(")")).desc('list')

const key = whitespace.then(quoted.or(unquoted)).skip(whitespace).skip(p.string(":"))
const pun = whitespace.then(quoted.or(unquoted)).map(k => [k, k])

const entry = p.seq(key, p.lazy(() => value))
const lEntry = p.seq(key, p.lazy(() => lValue))

const object = whitespace.skip(p.string("{")).then(entry.many())
                         .skip(whitespace).skip(p.string("}"))
                         .map(_.fromPairs).desc('object')

const lObject = whitespace.skip(p.string("{")).then((lEntry.or(pun)).many())
                          .skip(whitespace).skip(p.string("}"))
                          .map(_.fromPairs).desc('object')

const value = whitespace.then(p.alt(
  literal, quoted, quote, lArray, array, object, unquoted))

const lValue = whitespace.then(p.alt(
  literal, quoted.map(s => [null, s]), lQuote, lArray, array, lObject, unquoted))

module.exports = x => value.skip(whitespace).tryParse(x)
