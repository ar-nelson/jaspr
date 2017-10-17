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
import {Json} from './Jaspr'

export const magicPrefix = '$'
export const numberRegex = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/

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
  ['⟮', '⟯'],
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

export const colonChars = new Set([':', '：'])

export const commaChars = new Set([',', '，', '、'])

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
  ['`', {prefix: magicPrefix + 'syntax-quote'}],
  ['｀', {prefix: magicPrefix + 'syntax-quote'}],
  ['~', {prefix: magicPrefix + 'unquote'}],
  ['～', {prefix: magicPrefix + 'unquote'}],
  ['~@', {prefix: magicPrefix + 'unquote-splicing'}],
  ['～＠', {prefix: magicPrefix + 'unquote-splicing'}],
  ['⸢', {close: '⸣', prefix: magicPrefix + 'syntax-quote'}],
  ['⸤', {close: '⸥', prefix: magicPrefix + 'unquote'}],
  ['⸤@', {close: '⸥', prefix: magicPrefix + 'unquote-splicing'}],
])

export const commentTokens = new Map([
  [';', '\n'],
  ['；', '\n'],
  ['//', '\n'],
  ['／／', '\n'],
  ['/*', '*/'],
  ['／＊', '＊／']
])

const prefixTokenStarts = new Set([...prefixTokens.keys()].map(x => x.charAt(0)))
const commentTokenStarts = new Set([...commentTokens.keys()].map(x => x.charAt(0)))

export const reservedChars = new Set(controlChars)
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

enum FrameType {
  Root, Paren, Bracket, Brace, Prefix
}

interface ParseFrame {
  type: FrameType
  contents: Json[]
  readonly line: number
  readonly column: number
  readonly open?: string
  readonly close?: string
  lastComma?: boolean
  commas?: boolean
  key?: boolean
}

export class ParseError extends Error {
  readonly filename: string
  readonly line: number
  readonly column: number
  constructor(message: string, filename: string, line: number, column: number) {
    super(`${message} (${filename}, line ${line}, col ${column})`)
    this.filename = filename
    this.line = line
    this.column = column
  }
}

export default function parse(str: string, filename: string = "<no filename>"): Json {
  let i = 0, line = 1, lastNewline = 0
  const end = str.length
  const stack: ParseFrame[] = []
  let frame: ParseFrame = {type: FrameType.Root, contents: [], line: 0, column: 0}
  function err(message: string) {
    throw new ParseError(message, filename, line, i - lastNewline)
  }

  // The parser is written as a single, gigantic while loop. Not the easiest to
  // read, but it's FAST, and it isn't subject to stack overflows when reading
  // large files.
  // ---------------------------------------------------------------------------
  parsing: while (i < end) {
    let expr: Json | undefined = undefined
    const c = str.charAt(i)

    // Comments
    //
    // Comment tokens may consist of 1 or 2 characters. Both line comments and
    // block comments are supported, and block comments may nest.
    // -------------------------------------------------------------------------
    if (commentTokenStarts.has(c)) {
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
          while (str.charAt(j) !== '\n' && j < end) j++
        } else { // Block comment
          let depth = 1
          const oc = open.charAt(0), cc = close.charAt(0)
          while (depth > 0) {
            const c = str.charAt(j)
            if (c === '\n') { line++; lastNewline = j } // Keep track of line no
            if (c === cc && str.substring(j, j + close.length) === close) {
              depth--
              j += close.length
            } else if (c === oc && str.substring(j, j + open.length) === open) {
              depth++
              j += open.length
            } else if (j >= end) {
              err('unclosed block comment')
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
    // -------------------------------------------------------------------------
    if (prefixTokenStarts.has(c)) {
      stack.push(frame)
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
        frame = {
          type: FrameType.Prefix, contents: [op.prefix],
          line, column: i - lastNewline
        }
        i += len
        continue parsing
      } // fallthrough if no prefix token was matched
    }

    // Whitespace
    // -------------------------------------------------------------------------
    if (whitespaceChars.has(c)) {
      if (c === '\n') { line++; lastNewline = i } // Keep track of line number
      i++
      continue parsing
    }
    
    // Closing delimiters
    //
    // When the closing delimiter of an array or object is reached, the rest of
    // the parsing cases are skipped, the stack is popped once, and the array or
    // object is appended to the structure below it in the stack.
    // -------------------------------------------------------------------------
    else if (c === frame.close) {
      let popped: ParseFrame | undefined
      switch (frame.type) {
      case FrameType.Paren:
      case FrameType.Bracket:
        expr = frame.contents
        break
      case FrameType.Brace:
        expr = _.fromPairs(frame.contents.map(v => {
          if (Array.isArray(v)) return v
          else if (typeof v === 'string') return [v, v]
          else throw new ParseError('bad object', filename, frame.line, frame.column)
        }))
        break
      default:
        err(`close behavior not configured for state ${frame.type}`)
      }
      popped = stack.pop()
      if (popped) frame = popped
      else throw new Error("stack underflow")
      i++
      // fallthrough (the other `else` cases will be skipped)
    }
    
    // Brackets (array)
    //
    // An array is a sequence of expressions, between square brackets,
    // optionally delimited by commas. This is the standard JSON syntax, without
    // the additional quoting behavior found in parenthesized arrays.
    // -------------------------------------------------------------------------
    else if (bracketChars.has(c)) {
      if (frame.key) err('expected object key, got open bracket')
      stack.push(frame)
      frame = {
        type: FrameType.Bracket,
        contents: [],
        open: c, close: bracketChars.get(c),
        line, column: i - lastNewline
      }
      i++
      continue parsing
    }

    // Parentheses (array)
    //
    // An alternate syntax for JSON arrays. Inside a parenthesized array, quoted
    // strings are quoted in the Lisp sense (prefixed with '), while unquoted
    // strings are not. This makes unquoted/quoted strings behave like
    // symbols/strings in Lisp.
    // -------------------------------------------------------------------------
    else if (parenChars.has(c)) {
      if (frame.key) err('expected object key, got open paren')
      stack.push(frame)
      frame = {
        type: FrameType.Paren,
        contents: [],
        open: c, close: parenChars.get(c),
        line, column: i - lastNewline
      }
      i++
      continue parsing
    }
    
    // Braces (object)
    //
    // An object is a sequence of colon-separated key-value pairs, between
    // braces, optionally delimited by commas. Keys must be strings, and may be
    // quoted or unquoted. A key may occur without a value, in which case the
    // value will be the same as the key.
    // -------------------------------------------------------------------------
    else if (braceChars.has(c)) {
      if (frame.key) err('expected object key, got open brace')
      stack.push(frame)
      frame = {
        type: FrameType.Brace,
        contents: [],
        open: c, close: braceChars.get(c),
        line, column: i - lastNewline,
        key: true
      }
      i++
      continue parsing
    }
    
    // Quoted string
    //
    // Sequence of arbitrary characters between delimiters. Supports both
    // identical ("") and paired (“”) delimiters; paired delimiters may nest if
    // there is no ambiguity. Can contain newlines. Supports escapes starting
    // with `\`.
    // -------------------------------------------------------------------------
    else if (stringQuoteChars.has(c)) {
      const close = <string[]>stringQuoteChars.get(c)
      const ln = line, col = i - lastNewline
      const recur = _.includes(close, c) ? undefined : c
      let depth = 1
      expr = ''
      while (depth > 0) {
        i++
        if (i >= end) throw new ParseError('unclosed string', filename, ln, col)
        const c = str.charAt(i)
        if (c === '\n') {
          line++; lastNewline = i // Keep track of line number
        } else if (c === '\\') {
          const escape = str.charAt(++i)
          const result = escapes.get(escape)
          if (result === undefined) err(`invalid escape: \\${escape}`)
          expr += result
          continue
        } else if (c === recur) {
          depth++
        } else {
          for (let cc of close) { if (c === cc) { depth--; break } }
        }
        if (depth > 0) expr += c
      }
      i++
      // fallthrough
    }
    
    // Comma
    //
    // Optionally used to separate elements of arrays and objects. A structure
    // can either use commas or not use them, but cannot mix and match. This can
    // prevent mistakes, such as forgetting colons in objects.
    // -------------------------------------------------------------------------
    else if (commaChars.has(c)) {
      switch (frame.type) {
        case FrameType.Prefix: err('unexpected comma after quote')
        case FrameType.Brace: frame.key = true
      }
      if (frame.lastComma) err('duplicate comma')
      if (frame.contents.length === 0) err('comma before first element')
      if (!frame.commas && frame.contents.length > 1) {
        err('unexpected comma (no commas between previous elements)')
      }
      frame.lastComma = true
      frame.commas = true
      i++
      continue parsing
    }
    
    // Colon
    //
    // Separates keys and values in objects; cannot occur elsewhere, cannot be
    // duplicated, and cannot be preceded or followed by a comma
    // -------------------------------------------------------------------------
    else if (colonChars.has(c)) {
      if (frame.type === FrameType.Root) {
        if (frame.contents.length !== 1) {
          err('misplaced colon for top-level object')
        } else if (typeof frame.contents[0] !== 'string') {
          err('top-level colon after non-string expression')
        }
        frame.type = FrameType.Brace
        frame.key = true
      }
      if (frame.type !== FrameType.Brace) err('unexpected colon in non-object')
      if (frame.contents.length === 0) err('expected object key, got colon')
      if (frame.lastComma) err('unexpected colon after comma')
      if (!frame.key) err('duplicate colon')
      frame.lastComma = true
      frame.key = false
      i++
      continue parsing
    }
    
    // Unexpected reserved character
    //
    // Either a control character or a closing delimiter that does not match
    // the current opening delimiter; this is an error condition.
    // -------------------------------------------------------------------------
    else if (reservedChars.has(c)) {
      if (controlChars.has(c)) err('unexpected non-printing control character')
      else err(`unexpected ${c}`)
      break
    }
    
    // Unquoted string
    //
    // A sequence of 1 or more non-reserved, non-whitespace characters.
    // Numbers, `null`, `true`, and `false` are special cases.
    // Unquoted strings are Unicode normalized, using normalization type NFKC.
    // -------------------------------------------------------------------------
    else {
      const start = i
      while (++i < end && !reservedChars.has(str.charAt(i))) {}
      expr = str.substring(start, i)
      if (expr === 'null') expr = null
      else if (expr === 'true') expr = true
      else if (expr === 'false') expr = false
      else if (numberRegex.test(expr)) expr = parseFloat(expr)
      else expr = expr.normalize('NFKC')
    }

    // Pushing new expressions onto the stack
    //
    // If the above code has produced a value for `expr` without restarting
    // the parent `while` loop, then the below loop will add `expr` to the
    // structure on top of the parser's stack.
    // 
    // The loop repeats if the top of the stack is a prefix operator (quote,
    // syntax-quote, etc.)
    // -----------------------------------------------------------------------
    if (expr === undefined) {
      err('expr is undefined -- this should never happen!')
      return null
    }
    while (true) {
      if (!frame.lastComma && frame.commas) {
        err('expected comma (commas between previous elements)')
      }
      frame.lastComma = false
      switch (frame.type) {
      case FrameType.Prefix:
        frame.contents.push(expr)
        expr = frame.contents
        const popped = stack.pop()
        if (popped) frame = popped
        else throw new Error("stack underflow")
        break
      case FrameType.Brace:
        if (frame.key) {
          if (typeof expr === 'string') frame.contents.push(expr)
          else err(`expected object key, got non-string value ${expr}`)
        } else {
          frame.key = true
          frame.contents.push([<Json>frame.contents.pop(), expr])
        }
        continue parsing
      case FrameType.Root:
        if (frame.contents.length > 0) {
          err('multiple top-level expressions do not form an object')
        }
        // fallthrough
      default:
        frame.contents.push(expr)
        continue parsing
      }
    }
  }

  // Termination
  // ---------------------------------------------------------------------------
  if (stack.length > 0) {
    throw new ParseError(
      frame.open ? `unclosed ${frame.open}` : 'form unterminated due to EOF',
      filename, frame.line, frame.column)
  } else if (frame.contents.length === 0) {
    err('no top-level expression found')
  } else if (frame.type === FrameType.Brace) {
    return _.fromPairs(frame.contents.map(v => {
      if (Array.isArray(v)) return v
      else if (typeof v === 'string') return [v, v]
      else throw new ParseError('bad object', filename, frame.line, frame.column)
    }))
  } else if (frame.contents.length > 1) {
    err('more than 1 top-level expression')
  }
  return frame.contents[0]
}
