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

import * as _ from 'lodash'
import * as XRegExp from 'xregexp'
import {Json} from './Jaspr'
import {
  syntaxQuote, unquote, unquoteSplicing, assertDeepEquals
} from './ReservedNames'

export const number = XRegExp(`^
  ([+-])?              # sign
  (\\p{Nd}*)           # before decimal point
  (\\.)?               # decimal point
  (\\p{Nd}+)           # after decimal point (or before, if missing)
  ([eE][+-]?\\p{Nd}+)? # exponent
$`, 'xA')

function charClass(chars: Iterable<string>, not = false) {
  return (not ? '[^' : '[') + _.join([...chars].map(XRegExp.escape), '') + ']'
}

export const whitespaceChars = new Set([
  ' ', '\t', '\n', '\r', '\f', '\v',
  '\u0085', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003',
  '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a',
  '\u2028', '\u2029', '\u202f', '\u205f', '\u3000'
])

export const controlChars = new Set([
  '\u0000', '\u0001', '\u0002', '\u0003', '\u0004', '\u0005', '\u0006',
  '\u0007', '\u0008', '\u000e', '\u000f',

  '\u0010', '\u0011', '\u0012', '\u0013', '\u0014', '\u0015', '\u0016',
  '\u0017', '\u0018', '\u0019', '\u001a', '\u001b', '\u001c', '\u001d',
  '\u001e', '\u001f',
  
  '\u007f'
])

export const stringQuoteChars = new Map([
  ['"', ['"']],
  ['‘', ['’']],
  ['’', ['’', '‘']],
  ['‚', ['‘', '’']],
  ['“', ['”']],
  ['”', ['”', '“']],
  ['„', ['“', '”']],
  ['‹', ['›']],
  ['›', ['‹']],
  ['«', ['»']],
  ['»', ['«', '»']],
  ['｢', ['｣']],
  ['＂', ['＂']],
  ['「', ['」']],
  ['『', ['』']],
  ['〈', ['〉']],
  ['《', ['》']],
  ['〝', ['〞']],
  ['〟', ['〝', '〞']]
])

export const parenChars = new Map([
  ['(', ')'],
  ['⦅', '⦆'],
  ['﴾', '﴿'],
  ['⸨', '⸩'],
  ['（', '）'],
  ['﹙', '﹚'],
  ['【', '】'],
  ['｟', '｠']
])

export const bracketChars = new Map([
  ['[', ']'],
  ['⦋', '⦌'],
  ['⦍', '⦎'],
  ['⦏', '⦐'],
  ['⁅', '⁆'],
  ['⟦', '⟧'],
  ['［', '］'],
  ['〚', '〛'],
  ['〖', '〗'],
  ['⟨', '⟩'],
  ['⟪', '⟫'],
  ['〈', '〉'],
  ['⦑', '⦒'],
  ['⧼', '⧽']
])

export const braceChars = new Map([
  ['{', '}'],
  ['⦃', '⦄'],
  ['⟬', '⟭'],
  ['⦗', '⦘'],
  ['｛', '｝'],
  ['﹛', '﹜'],
  ['〔', '〕'],
  ['﹝', '﹞'],
  ['〘', '〙']
])

export const colonChars = new Set(':：﹕')

export const commaChars = new Set(',﹐，՝،、﹑､')

const escapes = new Map<string, string>([
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['b', '\b'],
  ['f', '\f'],
  ['v', '\v'],
  ['\\', '\\'],
  ['/', '/'],
  ["'", "'"],
  ['"', '"']
])
for (let [open, close] of stringQuoteChars) {
  escapes.set(open, open)
  for (let c of close) escapes.set(c, c)
}

export const prefixTokens = new Map<string, {close?: string, prefix: string}>([
  ["'", {prefix: ''}],
  ["＇", {prefix: ''}],
  ['`', {prefix: syntaxQuote}],
  ['｀', {prefix: syntaxQuote}],
  ['~', {prefix: unquote}],
  ['～', {prefix: unquote}],
  ['~@', {prefix: unquoteSplicing}],
  ['～＠', {prefix: unquoteSplicing}],
  ['⸢', {close: '⸣', prefix: syntaxQuote}],
  ['⸤', {close: '⸥', prefix: unquote}],
  ['⸤@', {close: '⸥', prefix: unquoteSplicing}],
])

export const commentTokens = new Map([
  [';', '\n'],
  ['；', '\n'],
  ['﹔', '\n'],
  ['؛', '\n'],
  ['//', '\n'],
  ['／／', '\n'],
  ['/*', '*/'],
  ['／＊', '＊／'],
  ['💭', '\n']
])

const openParen = XRegExp(charClass(parenChars.keys()))
const openBracket = XRegExp(charClass(bracketChars.keys()))
const openBrace = XRegExp(charClass(braceChars.keys()))
const openQuote = XRegExp(charClass(stringQuoteChars.keys()))
const colon = XRegExp(charClass(colonChars))
const comma = XRegExp(charClass(commaChars))
const whitespace = XRegExp(charClass(whitespaceChars))
const prefixTokenStart =
  XRegExp(charClass([...prefixTokens.keys()].map(x => x.charAt(0))))
const commentTokenStart =
  XRegExp(charClass([...commentTokens.keys()].map(x => x.charAt(0))))

const reservedChars = new Set(controlChars)
for (let c of whitespaceChars) reservedChars.add(c)
for (let [open, close] of stringQuoteChars) {
  reservedChars.add(open)
  for (let c of close) reservedChars.add(c)
}
for (let [open, close] of parenChars) {
  reservedChars.add(open)
  reservedChars.add(close)
}
for (let [open, close] of bracketChars) {
  reservedChars.add(open)
  reservedChars.add(close)
}
for (let [open, close] of braceChars) {
  reservedChars.add(open)
  reservedChars.add(close)
}
for (let c of colonChars) reservedChars.add(c)
for (let c of commaChars) reservedChars.add(c)
for (let [open, {close}] of prefixTokens) {
  if (open.length === 1) reservedChars.add(open)
  if (close && close.length === 1) reservedChars.add(close)
}
for (let [open, close] of commentTokens) {
  if (open.length === 1) reservedChars.add(open)
  if (close.length === 1) reservedChars.add(close)
}

export const reservedChar =
  XRegExp(charClass(reservedChars))
export const legalName =
  XRegExp('^' +
    charClass(['$', '.', ...reservedChars], true) +
    charClass(['.', ...reservedChars], true) + '*$')
const unquotedString = 
  XRegExp('^(' + charClass(reservedChars, true) + '+)')

/**
 * The Jaspr parser. Use by passing individual chunks of source via `read`, then
 * retrieving the parsed result via `getOneResult` or `getManyResults`.
 */
class Parser {
  filename?: string
  testComments: boolean
  line: number = 0
  column: number = 0
  stack: Parser.Frame[] = []
  frame: Parser.Frame = {
    type: T.Root,
    contents: [],
    location: {line: 0, column: 0}
  }

  constructor(filename?: string, testComments = false) {
    this.filename = filename
    this.testComments = testComments
  }

  /**
   * Reads and parses another chunk of data. Throws a `Parser.ParseError` if an
   * error occurs while parsing the chunk.
   * 
   * @param str The next chunk to parse
   * @param location (optional) Location data of the chunk, if the parsing
   *   filename/location has changed
   */
  read(str: string, location?: Parser.Location) {
    let i = 0, lastNewline: number
    const end = str.length
    if (location) {
      this.filename = location.filename || this.filename
      this.line = location.line
      lastNewline = 0 - location.column
    } else {
      lastNewline = 0 - this.column
    }
    const loc = (): Parser.Location =>
      ({filename: this.filename, line: this.line, column: i - lastNewline})

    // The parser is written as a single, gigantic while loop. Not the easiest
    // to read, but it's FAST, and it isn't subject to stack overflows when
    // reading large files.
    // ═════════════════════════════════════════════════════════════════════════
    parsing: while (i < end) {
      let expr: Json | undefined = undefined
      const c = str.charAt(i)
      
      // Closing delimiters
      //
      // When the closing delimiter of an array or object is reached, the rest
      // of the parsing cases are skipped, the stack is popped once, and the
      // array or object is appended to the structure below it in the stack.
      // ═══════════════════════════════════════════════════════════════════════
      if (this.frame.close != null && this.frame.close.indexOf(c) > -1) {
        let popped: Parser.Frame | undefined
        switch (this.frame.type) {
        case T.Paren:
        case T.Bracket:
          expr = this.frame.contents
          break
        case T.Brace:
          expr = _.fromPairs(this.frame.contents.map(v => {
            if (Array.isArray(v)) return v
            else if (typeof v === 'string') return [v, v]
            else throw new Parser.ParseError('bad object', this.frame.location)
          }))
          break
        case T.Quote:
          expr = this.frame.contents[0]
          break
        default:
          throw new Parser.ParseError(
            `close behavior not configured for state ${this.frame.type}`,
            loc())
        }
        popped = this.stack.pop()
        if (popped) {
          if (popped.type === T.Quote) expr = '' + this.frame.open + expr + c
          this.frame = popped
        }
        else throw new Error("stack underflow")
        i++
        // fallthrough (skips everything up to pushing onto stack)
      } else {

      // Quoted string contents
      // ═══════════════════════════════════════════════════════════════════════
      if (this.frame.type === T.Quote) {
        if (c === this.frame.open &&
            (<string[]>this.frame.close).indexOf(this.frame.open) === -1) {
          this.stack.push(this.frame)
          this.frame = {
            type: T.Quote, contents: [''], location: loc(),
            open: c, close: this.frame.close
          }
        } else if (c === '\\') {
          const escape = str.charAt(++i)
          const result = escapes.get(escape)
          if (result === undefined) throw new Parser.ParseError(
            `invalid escape: \\${escape}`, loc())
          this.frame.contents[0] += result
        } else {
          if (c === '\n') {
            this.line++; lastNewline = i // Keep track of line number
          }
          this.frame.contents[0] += c
        }
        i++
        continue parsing
      }

      // Comments
      //
      // Comment tokens may consist of 1 or 2 characters. Both line comments and
      // block comments are supported, and block comments may nest.
      // ═══════════════════════════════════════════════════════════════════════
      else if (commentTokenStart.test(c)) {
        let open = c, close = commentTokens.get(c), j = i + 1
        for (let [open2, close2] of commentTokens) { // Handle 2-char tokens
          if (open2.length === 2 && open2.charAt(0) === c &&
              str[j] === open2.charAt(1)) {
            open = open2
            close = close2
            j++
            break
          }
        }
        if (close !== undefined) {
          if (close === '\n') { // Line comment
            const end = str.indexOf('\n', j)
            const comment = str.slice(j, end < 0 ? str.length : end)
            // Test comments ( ;= )
            if (this.testComments &&
                this.stack.length === 0 &&
                this.frame.contents.length > 0) {
              const testComment = /^(\s*=>?\s+)(\S.*)$/.exec(comment)
              if (testComment) {
                const [_, offset, rhs] = testComment,
                      subParser = new Parser(this.filename),
                      {filename, line, column: c} = loc()
                subParser.read(rhs, {filename, line, column: c + offset.length})
                const rhsValue = subParser.getOneResult()
                this.frame.contents[this.frame.contents.length - 1] = [
                  assertDeepEquals,
                  this.frame.contents[this.frame.contents.length - 1],
                  ['', rhsValue]]
              }
            }
            j += comment.length
          } else { // Block comment
            let depth = 1
            const oc = open.charAt(0), cc = close.charAt(0)
            while (depth > 0) {
              const c = str.charAt(j)
              if (c === '\n') {
                this.line++; lastNewline = j // Keep track of line number
              }
              if (c === cc && str.substring(j, j + close.length) === close) {
                depth--
                j += close.length
              } else if (c === oc && str.substring(j, j + open.length) === open) {
                depth++
                j += open.length
              } else if (j >= end) {
                throw new Parser.ParseError('unclosed block comment', loc())
              } else j++
            }
          }
          i = j
          continue parsing
        } // fallthrough if no comment token was matched
      }

      // Prefix operators
      //
      // 1- or 2-character operators that apply to a single expression. Used for
      // Lisp-style quoting.
      // ═══════════════════════════════════════════════════════════════════════
      if (prefixTokenStart.test(c)) {
        this.stack.push(this.frame)
        let len = 1, op = prefixTokens.get(c)
        for (let [open, op2] of prefixTokens) { // Handle 2-char tokens
          if (open.length === 2 && open.charAt(0) === c &&
              str[i+1] === open.charAt(1)) {
            len = 2
            op = op2
            break
          }
        }
        if (op !== undefined) {
          this.frame = {
            type: T.Prefix, contents: [op.prefix], location: loc()
          }
          i += len
          continue parsing
        } // fallthrough if no prefix token was matched
      }

      // Whitespace
      // ═══════════════════════════════════════════════════════════════════════
      if (whitespace.test(c)) {
        if (c === '\n') {
          this.line++; lastNewline = i // Keep track of line number
        }
        i++
        continue parsing
      }
      
      // Brackets (array)
      //
      // An array is a sequence of expressions, between square brackets,
      // optionally delimited by commas. This is the standard JSON syntax,
      // without the additional quoting behavior found in parenthesized arrays.
      // ═══════════════════════════════════════════════════════════════════════
      else if (openBracket.test(c)) {
        if (this.frame.key) throw new Parser.ParseError(
          'expected object key, got open bracket', loc())
        this.stack.push(this.frame)
        this.frame = {
          type: T.Bracket,
          contents: [],
          open: c, close: [<string>bracketChars.get(c)],
          location: loc()
        }
        i++
        continue parsing
      }

      // Parentheses (array)
      //
      // An alternate syntax for JSON arrays. Inside a parenthesized array,
      // quoted strings are quoted in the Lisp sense (prefixed with '), while
      // unquoted strings are not. This makes unquoted/quoted strings behave
      // like symbols/strings in Lisp.
      // ═══════════════════════════════════════════════════════════════════════
      else if (openParen.test(c)) {
        if (this.frame.key) throw new Parser.ParseError(
          'expected object key, got open paren', loc())
        this.stack.push(this.frame)
        this.frame = {
          type: T.Paren,
          contents: [],
          open: c, close: [<string>parenChars.get(c)],
          location: loc()
        }
        i++
        continue parsing
      }
      
      // Braces (object)
      //
      // An object is a sequence of colon-separated key-value pairs, between
      // braces, optionally delimited by commas. Keys must be strings, and may
      // be quoted or unquoted. A key may occur without a value, in which case
      // the value will be the same as the key.
      // ═══════════════════════════════════════════════════════════════════════
      else if (openBrace.test(c)) {
        if (this.frame.key) throw new Parser.ParseError(
          'expected object key, got open brace', loc())
        this.stack.push(this.frame)
        this.frame = {
          type: T.Brace,
          contents: [],
          open: c, close: [<string>braceChars.get(c)],
          location: loc(),
          key: true
        }
        i++
        continue parsing
      }
      
      // Quoted string
      //
      // Sequence of arbitrary characters between delimiters. Supports both
      // identical ("") and paired (“”) delimiters; paired delimiters may nest
      // if there is no ambiguity. Can contain newlines. Supports escapes
      // starting with `\`.
      // ═══════════════════════════════════════════════════════════════════════
      else if (openQuote.test(c)) {
        this.stack.push(this.frame)
        this.frame = {
          type: T.Quote, contents: [''], location: loc(),
          open: c, close: <string[]>stringQuoteChars.get(c)
        }
        i++
        continue parsing
      }
      
      // Comma
      //
      // Optionally used to separate elements of arrays and objects. A structure
      // can either use commas or not use them, but cannot mix and match. This
      // can prevent mistakes, such as forgetting colons in objects.
      // ═══════════════════════════════════════════════════════════════════════
      else if (comma.test(c)) {
        switch (this.frame.type) {
          case T.Prefix:
            throw new Parser.ParseError('unexpected comma after quote', loc())
          case T.Brace:
            this.frame.key = true
        }
        if (this.frame.lastComma) {
          throw new Parser.ParseError('duplicate comma', loc())
        } if (this.frame.contents.length === 0) {
          throw new Parser.ParseError('comma before first element', loc())
        } if (!this.frame.commas && this.frame.contents.length > 1) {
          throw new Parser.ParseError(
            'unexpected comma (no commas between previous elements)', loc())
        }
        this.frame.lastComma = true
        this.frame.commas = true
        i++
        continue parsing
      }
      
      // Colon
      //
      // Separates keys and values in objects; cannot occur elsewhere, cannot be
      // duplicated, and cannot be preceded or followed by a comma
      // ═══════════════════════════════════════════════════════════════════════
      else if (colon.test(c)) {
        if (this.frame.type === T.Root) {
          if (this.frame.contents.length !== 1) {
            throw new Parser.ParseError(
              'misplaced colon for top-level object', loc())
          } else if (typeof this.frame.contents[0] !== 'string') {
            throw new Parser.ParseError(
              'top-level colon after non-string expression', loc())
          }
          this.frame.type = T.Brace
          this.frame.key = true
        }
        if (this.frame.type !== T.Brace) {
          throw new Parser.ParseError('unexpected colon in non-object', loc())
        } if (this.frame.contents.length === 0) {
          throw new Parser.ParseError('expected object key, got colon', loc())
        } if (this.frame.lastComma) {
          throw new Parser.ParseError('unexpected colon after comma', loc())
        } if (!this.frame.key) {
          throw new Parser.ParseError('duplicate colon', loc())
        }
        this.frame.lastComma = true
        this.frame.key = false
        i++
        continue parsing
      }
      
      else {
        const match = unquotedString.exec(str.slice(i))

        // Unquoted string
        //
        // A sequence of 1 or more non-reserved, non-whitespace characters.
        // Numbers, `null`, `true`, and `false` are special cases. Unquoted
        // strings are Unicode normalized, using normalization type NFKC.
        // ═════════════════════════════════════════════════════════════════════
        if (match != null) {
          expr = match[0]
          i += expr.length
          if (expr === 'null') expr = null
          else if (expr === 'true') expr = true
          else if (expr === 'false') expr = false
          else if (number.test(expr)) expr = parseFloat(expr)
          else expr = expr.normalize('NFKC')
        }
        
        // Unexpected reserved character
        //
        // Either a control character or a closing delimiter that does not match
        // the current opening delimiter; this is an error condition.
        // ═════════════════════════════════════════════════════════════════════
        else throw new Parser.ParseError(
          controlChars.has(c)
            ? 'unexpected non-printing control character'
            : `unexpected ${c}`,
          loc())
      }
      }

      // Pushing new expressions onto the stack
      //
      // If the above code has produced a value for `expr` without restarting
      // the parent `while` loop, then the below loop will add `expr` to the
      // structure on top of the parser's stack.
      // 
      // The loop repeats if the top of the stack is a prefix operator (quote,
      // syntax-quote, etc.)
      // ═══════════════════════════════════════════════════════════════════════
      if (expr === undefined) {
        throw new Parser.ParseError(
          'expr is undefined -- this should never happen!', loc())
      }
      while (true) {
        if (!this.frame.lastComma && this.frame.commas) {
          throw new Parser.ParseError(
            'expected comma (commas between previous elements)', loc())
        }
        this.frame.lastComma = false
        switch (this.frame.type) {
        case T.Prefix:
          this.frame.contents.push(expr)
          expr = this.frame.contents
          const popped = this.stack.pop()
          if (popped) this.frame = popped
          else throw new Error("stack underflow")
          break
        case T.Brace:
          if (this.frame.key) {
            if (typeof expr === 'string') this.frame.contents.push(expr)
            else throw new Parser.ParseError(
              `expected object key, got non-string value ${expr}`, loc())
          } else {
            this.frame.key = true
            this.frame.contents.push([<Json>this.frame.contents.pop(), expr])
          }
          continue parsing
        case T.Quote:
          this.frame.contents[0] += ('' + expr)
          continue parsing
        default:
          this.frame.contents.push(expr)
          continue parsing
        }
      }
    }
    this.column = i - lastNewline
  }

  /** 
   * If the parser has completely parsed *exactly one* JSON value, returns that
   * value. Otherwise, throws a `Parser.ParseError`.
   */
  getOneResult(): Json {
    if (this.stack.length > 0) {
      throw new Parser.ParseError(
        this.frame.open
          ? `unclosed ${this.frame.open}`
          : 'form unterminated due to EOF',
        this.frame.location)
    } else if (this.frame.contents.length === 0) {
      throw new Parser.ParseError('no top-level expression found', this)
    } else if (this.frame.type === T.Brace) {
      return _.fromPairs(this.frame.contents.map(v => {
        if (Array.isArray(v)) return v
        else if (typeof v === 'string') return [v, v]
        else throw new Parser.ParseError('bad object', this.frame.location)
      }))
    } else if (this.frame.contents.length > 1) {
      throw new Parser.ParseError('more than 1 top-level expression', this)
    }
    return this.frame.contents[0]
  }

  /** 
   * If the parser has completely parsed zero or more top-level JSON values (but
   * not a single top-level object without braces), returns all of the parsed
   * values. Otherwise, throws a `Parser.ParseError`.
   */
  getManyResults(): Json[] {
    if (this.stack.length > 0) {
      throw new Parser.ParseError(
        this.frame.open
          ? `unclosed ${this.frame.open}`
          : 'form unterminated due to EOF',
        this.frame.location)
      } else if (this.frame.type === T.Brace) {
        throw new Parser.ParseError(
          'Expected expression(s), got top-level no-brace object', this)
      } else return this.frame.contents
  }

  /** 
   * True if the parser has completely parsed 1 or more JSON values, and does
   * not currently have any unclosed structures.
   */
  isDone(): boolean {
    return this.stack.length === 0 && this.frame.contents.length > 0
  }
}

namespace Parser {

  export class ParseError extends Error {
    readonly location: Location
    constructor(message: string, location: Location) {
      super(`${message} (${locationToString(location)})`)
      this.location = location
    }
  }
  
  export interface Location {
    readonly filename?: string
    readonly line: number
    readonly column: number
  }
  
  export function locationToString({filename, line, column}: Location) {
    return `${filename || '<no filename>'}, line ${line}, col ${column}`
  }
  
  export interface Frame {
    type: Frame.Type
    contents: Json[]
    readonly location: Location
    readonly open?: string
    readonly close?: string[]
    lastComma?: boolean
    commas?: boolean
    key?: boolean
  }
  
  export namespace Frame {
    export enum Type {
      Root, Paren, Bracket, Brace, Quote, Prefix
    }
  }
}

const T = Parser.Frame.Type

export default Parser
