/**
 * Literate programming extension to the Jaspr parser (Parse.ts)
 * 
 * Extracts Jaspr source code from .jaspr.md Markdown files.
 * 
 * Code blocks are interpreted as code, quoted code blocks are interpreted as
 * unit tests. If a definition is contained in a block whose header is the name
 * of the definition, the text content of that block will become that
 * definintion's docstring.
 */

import {Json, JsonObject, isObject} from './Jaspr'
import {isLegalName} from './Interpreter'
import Parser from './Parser'
import {reservedChar} from './Parser'
import * as _ from 'lodash'

const atxHeader = /^[ ]{0,3}(#{1,6})\s+([^#]*?)(\s+#*)?\s*$/
const setextHeader = /^[ ]{0,3}(-+|=+)\s*$/
const aboveSetextHeader = /^[ ]{0,3}([^\s>\-*].*)$/
const blockquote = /(^[ ]{0,3}>\s)(.*)$/
const emptyBlockquote = /^[ ]{0,3}>\s*$/
const codeFence = /^[ ]{0,3}(```+|~~~+)\s*(\w+)?[^`~]*$/
const indentedCode = /^(    |[ ]{0,3}\t)(\s*\S+.*)$/

export function parseMarkdown(src: string, filename?: string): JsonObject {
  const srcParser = new Parser(filename)
  const tests: { [name: string]: Json } = {}
  const doc: { [name: string]: string } = {}
  const headers: string[] = []
  let headerName: string | null = null,
      headerNameDepth: number | null = null,
      lastLine = "",
      currentDoc = "",
      closeFence: string | null = null,
      ignoreFence = false,
      testParser: Parser | null = null,
      inBlockquote = false

  function pushHeader(text: string, h: number) {
    while (headers.length > h) headers.pop()
    while (headers.length < h - 1) headers.push("")
    headers.push(text)
    if (headerName && headerNameDepth !== null && h <= headerNameDepth) {
      doc[headerName] = currentDoc
      currentDoc = ""
      headerName = null
      headerNameDepth = null
    }
    if (text.length > 2 &&
        text.charAt(0) === '`' &&
        text.charAt(text.length - 1) === '`' &&
        isLegalName(text.substring(1, text.length - 1))) {
      headerName = text.substring(1, text.length - 1)
      headerNameDepth = h
    }
  }

  function pushTests() {
    if (testParser === null) return
    const currentTests = testParser.getManyResults()
    testParser = null
    if (currentTests.length === 0) return
    let prefix = ''
    for (let c of headerName || _.last(headers) || 'test') {
      if (c === ' ' || c === '.') prefix += '-'
      if (!reservedChar.test(c)) prefix += c
    }
    if (prefix === '') prefix = 'test'
    prefix += '-'
    for (let test of currentTests) {
      let n = 0
      while (tests.hasOwnProperty(prefix + n)) n++
      tests[prefix + n] = test
    }
  }

  src.split(/\r?\n/).forEach((line, n) => {
    let match: RegExpExecArray | null
    if (match = blockquote.exec(line)) {
      inBlockquote = true
      if (!testParser) testParser = new Parser(filename, true)
      const [_, quoteIndent, rest] = match
      if (closeFence) {
        // TODO: Handle spaces in front of closing code fence
        if (rest.startsWith(closeFence)) closeFence = null
        else if (!ignoreFence) {
          testParser.read(rest + '\n',
            {filename, line: n + 1, column: quoteIndent.length})
        }
      } else if (match = indentedCode.exec(rest)) {
        const [_, indent, code] = match
        testParser.read(code + '\n',
          {filename, line: n + 1, column: quoteIndent.length + indent.length})
      } else if (match = codeFence.exec(rest)) {
        const [_, fence, lang] = match
        closeFence = fence
        ignoreFence = lang !== undefined && lang.length > 0 && lang !== 'jaspr'
      }
    } else if (inBlockquote && !emptyBlockquote.exec(line)) {
      inBlockquote = false
      pushTests()
      if (closeFence) throw new Parser.ParseError(
        `Blockquote containing code fence ${closeFence} closed without closing fence`,
        {filename, line: n + 1, column: 0})
    }
    if (closeFence) {
      // TODO: Handle spaces in front of closing code fence
      if (line.startsWith(closeFence)) closeFence = null
      else if (!ignoreFence) {
        srcParser.read(line + '\n', {filename, line: n + 1, column: 0})
      }
    } else if (match = indentedCode.exec(line)) {
      const [_, indent, code] = match
      srcParser.read(code + '\n', {filename, line: n + 1, column: indent.length})
    } else if (match = codeFence.exec(line)) {
      const [_, fence, lang] = match
      closeFence = fence
      ignoreFence = lang !== undefined && lang.length > 0 && lang !== 'jaspr'
    } else if (match = atxHeader.exec(line)) {
      const [_, prefix, text, suffix] = match
      pushHeader(text, prefix.length - 1)
    } else if (match = setextHeader.exec(line)) {
      const headerMatch = aboveSetextHeader.exec(lastLine)
      if (headerMatch) {
        pushHeader(headerMatch[1], match[1].charAt(0) === '=' ? 0 : 1)
      }
    }
    if (headerName) currentDoc += line + '\n'
    lastLine = line
  })
  pushTests()

  const result = srcParser.getOneResult()
  if (!isObject(result)) {
    throw new Parser.ParseError(
      "Literate Jaspr file must produce an object", srcParser)
  }
  return _.assign(result, _.mapKeys(doc, (v, k) => 'doc.' + k),
                          _.mapKeys(tests, (v, k) => 'test.' + k))
}
