/* *
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

import * as p from 'parsimmon'
import * as _ from 'lodash'
import {Json, JsonObject} from './Jaspr'

const lineComment =
  p.string('//').then(p.takeWhile(x => x != '\n')).desc('line comment')

const inBlockComment: p.Parser<string> =
  p.string('*/').result("").or(p.seqMap(
    p.takeWhile(x => x != '*'),
    p.lazy(() => inBlockComment),
    (a, b) => a + b))

const blockComment: p.Parser<string> =
  p.string('/*').then(inBlockComment).desc('block comment')

const whitespace: p.Parser<null> = p.alt(
    p.regex(/[\s,]+/).desc('whitespace'),
    lineComment,
    blockComment
  ).many().result(null)

const unquoted = p.regex(/[^()\[\]{},:;'"`~\s]+/).desc('string')

const literal: p.Parser<null | boolean | number> = p.alt(
  p.string("null").notFollowedBy(unquoted).result(null),
  p.string("true").notFollowedBy(unquoted).result(true),
  p.string("false").notFollowedBy(unquoted).result(false),
  p.regex(/[+-]?\d+(\.\d+)?([eE][+-]?\d+)?/).map(parseFloat).desc('number'))

const escape = p.string('\\').then(p.alt(
  p.string('n').result('\n'),
  p.string('r').result('\r'),
  p.string('t').result('\t'),
  p.string('b').result('\b'),
  p.string('f').result('\f'),
  p.string('v').result('\v')))

const inQuoted: p.Parser<string> =
  p.string('"').result("").or(p.seqMap(
    escape.or(p.takeWhile(x => x != '"' && x != '\\')),
    p.lazy(() => inQuoted),
    (a, b) => a + b))

const quoted = p.string('"').then(inQuoted).desc('quoted string')

const quoteChar = p.alt<Json>(
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

const object: p.Parser<JsonObject> = 
  whitespace.skip(p.string("{")).then(entry.many())
            .skip(whitespace).skip(p.string("}"))
            .map(_.fromPairs).desc('object')

const lObject: p.Parser<JsonObject> = 
  whitespace.skip(p.string("{")).then((lEntry.or(pun)).many())
            .skip(whitespace).skip(p.string("}"))
            .map(_.fromPairs).desc('object')

const value: p.Parser<Json> = whitespace.then(p.alt<Json>(
  literal, quoted, quote, lArray, array, object, unquoted))

const lValue: p.Parser<Json> = whitespace.then(p.alt<Json>(
  literal, quoted.map(s => [null, s]), lQuote, lArray, array, lObject, unquoted))

export default (x: string): Json => value.skip(whitespace).tryParse(x)
