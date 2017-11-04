import {expect} from 'chai'
import Parser from '../src/Parser'
import {readFileSync} from 'fs'
require('source-map-support').install({
  handleUncaughtExceptions: false
})

function parse(str: string, filename = "<test>") {
  const parser = new Parser(filename)
  parser.read(str)
  return parser.getOneResult()
}

describe('the parser', () => {
  it('parses top-level null', () => expect(parse('null')).to.equal(null))
  it('parses top-level true', () => expect(parse('true')).to.equal(true))
  it('parses top-level false', () => expect(parse('false')).to.equal(false))
  it('parses top-level numbers', () => {
    expect(parse('1')).to.equal(1)
    expect(parse('100')).to.equal(100)
    expect(parse('1.0')).to.equal(1.0)
    expect(parse('3.14')).to.equal(3.14)
    expect(parse('-1')).to.equal(-1)
    expect(parse('+1')).to.equal(+1)
    expect(parse('-753.571')).to.equal(-753.571)
    expect(parse('1e2')).to.equal(1e2)
    expect(parse('1E2')).to.equal(1E2)
    expect(parse('1.23e45')).to.equal(1.23e45)
    expect(parse('1.23e+45')).to.equal(1.23e+45)
    expect(parse('1.23e-45')).to.equal(1.23e-45)
    expect(parse('1.23E+45')).to.equal(1.23E+45)
    expect(parse('1.23E-45')).to.equal(1.23E-45)
    expect(parse('-1.2e-3')).to.equal(-1.2e-3)
  })
  it('parses top-level unquoted strings', () => {
    expect(parse('a')).to.equal('a')
    expect(parse('foo')).to.equal('foo')
    expect(parse('this-is-a-string')).to.equal('this-is-a-string')
    expect(parse('*')).to.equal('*')
    expect(parse('!@#$%^&*?<>-+_=\\/')).to.equal('!@#$%^&*?<>-+_=\\/')
    expect(parse('example.com')).to.equal('example.com')
    expect(parse('one1')).to.equal('one1')
    expect(parse('⚙foo')).to.equal('⚙foo')
  })
  it('ignores whitespace around top-level unquoted strings', () => {
    expect(parse(' foo')).to.equal('foo')
    expect(parse('foo ')).to.equal('foo')
    expect(parse(' foo ')).to.equal('foo')
    expect(parse('\n\r\tfoo\v\f')).to.equal('foo')
    expect(parse(`
    
      foo
    
    `)).to.equal('foo')
  })
  it('ignores line comments', () => {
    expect(parse(`
      // This is a line comment.
      foo
    `)).to.equal('foo')
    expect(parse(`
      // This is a line comment.
      // This is another.
      foo
      // This is a comment at the end of the file.
    `)).to.equal('foo')
    expect(parse(`
      //thisisalinecommentwithnospaces
      foo
    `)).to.equal('foo')
    expect(parse(`
      // This is a line comment.
      // This is another.
      foo
      // This is a comment at the end of the file`)).to.equal('foo')
    expect(parse(`
      // This // line // comment // contains // the // delimiter
      //////////////////////////////////////////////////////////
      foo
    `)).to.equal('foo')
    expect(parse(`
      // JS style!
      ; Lisp style!
      💭 Emoji style!
      foo
    `)).to.equal('foo')
  })
  it('ignores block comments', () => {
    expect(parse('/* This is a block comment. */ foo')).to.equal('foo')
    expect(parse('foo /* This is a block comment. */')).to.equal('foo')
    expect(parse('/* bar */ foo /* baz */')).to.equal('foo')
    expect(parse('/*bar*/ foo /*baz*/')).to.equal('foo')
    expect(parse(`/**
      This is a documentation comment!

      @foo: bar <a href="example.com">fhqwhgads</a>
    */ foo `)).to.equal('foo')
  })
  it("doesn't mistake slashes in unquoted strings for comments", () => {
    expect(parse('/')).to.equal('/')
    expect(parse('b/w')).to.equal('b/w')
    expect(parse('/foo/')).to.equal('/foo/')
    expect(parse('-//-')).to.equal('-//-')
    expect(parse('-/*-')).to.equal('-/*-')
    expect(parse('*/')).to.equal('*/')
    expect(parse('*//')).to.equal('*//')
  })
  it("allows single-character line comments adjacent to strings", () => {
    expect(parse('foo;bar')).to.equal('foo')
  })
  it('parses top-level quoted strings', () => {
    expect(parse('""')).to.equal('')
    expect(parse('"a"')).to.equal('a')
    expect(parse('"foo"')).to.equal('foo')
    expect(parse('"this is a string"')).to.equal('this is a string')
    expect(parse('"\'"')).to.equal("'")
    expect(parse('"⚙foo"')).to.equal('⚙foo')
    expect(parse('"one\ntwo"')).to.equal('one\ntwo')
  })
  it('supports all kinds of Unicode quotation marks', () => {
    // These should all say “Hello, world!”
    // If not, blame Google Translate.
    expect(parse('“Hello, world!”')).to.equal("Hello, world!")
    expect(parse('‘¡Hola Mundo!’')).to.equal("¡Hola Mundo!")
    expect(parse('„Hallo Welt!“')).to.equal("Hallo Welt!")
    expect(parse('‚Ahoj světe!‘')).to.equal("Ahoj světe!")
    expect(parse('„Hallo Wereld!”')).to.equal("Hallo Wereld!")
    expect(parse('”Hej världen!”')).to.equal("Hej världen!")
    expect(parse('’Здраво Свете!’')).to.equal("Здраво Свете!")
    expect(parse('«Bonjour monde!»')).to.equal("Bonjour monde!")
    expect(parse('‹Selam Dünya!›')).to.equal("Selam Dünya!")
    expect(parse('»Hej Verden!«')).to.equal("Hej Verden!")
    expect(parse('›Dobrý deň, svet!‹')).to.equal("Dobrý deň, svet!")
    expect(parse('»Hei maailma!»')).to.equal("Hei maailma!")
    expect(parse('「你好，世界！」')).to.equal("你好，世界！")
    expect(parse('『こんにちは世界！』')).to.equal("こんにちは世界！")
    expect(parse('《안녕, 세상!》')).to.equal("안녕, 세상!")
    expect(parse('〈안녕, 세상!〉')).to.equal("안녕, 세상!")
  })
  it('normalizes Unicode in unquoted strings', () => {
    expect(parse("log₁₀")).to.equal("log10")
    expect(parse("√½")).to.equal("√1⁄2")
    expect(parse("ｆｕｌｌｗｉｄｔｈ")).to.equal("fullwidth")
  })
  it('supports standard JSON escapes in quoted strings', () => {
    expect(parse('"\\n"')).to.equal("\n")
    expect(parse('"\\r"')).to.equal("\r")
    expect(parse('"\\t"')).to.equal("\t")
    expect(parse('"\\f"')).to.equal("\f")
    expect(parse('"\\b"')).to.equal("\b")
    expect(parse('"\\v"')).to.equal("\v")
    expect(parse('"\\\\n"')).to.equal("\\n")
    expect(parse('"\\/"')).to.equal("/")
    expect(parse('"\\\'"')).to.equal("'")
    expect(parse('"\\""')).to.equal('"')
  })
  it('can nest unrelated quote styles', () => {
    expect(parse('"“"')).to.equal("“")
    expect(parse('"”"')).to.equal("”")
    expect(parse('“"”')).to.equal('"')
    expect(parse('"I said, “Hello, world!”"')).to.equal('I said, “Hello, world!”')
    expect(parse('«I said, “Hello, world!”»')).to.equal('I said, “Hello, world!”')
  })
  it('can nest the same quote style, if it has non-identical quote characters', () => {
    expect(parse('“ “ “ ” ” ”')).to.equal(" “ “ ” ” ")
    expect(parse('« « « » » »')).to.equal(" « « » » ")
    expect(parse('«««»»»')).to.equal("««»»")
    expect(parse('“I said, “Hello, world!””')).to.equal("I said, “Hello, world!”")
  })
  it('parses empty structures', () => {
    expect(parse('()')).to.deep.equal([])
    expect(parse('[]')).to.deep.equal([])
    expect(parse('{}')).to.deep.equal({})
  })
  it('parses simple arrays without commas', () => {
    expect(parse('(1 2 3 4)')).to.deep.equal([1, 2, 3, 4])
    expect(parse('[foo bar baz quux]')).to.deep.equal(['foo', 'bar', 'baz', 'quux'])
  })
  it('parses simple arrays with commas', () => {
    expect(parse('(1, 2, 3, 4)')).to.deep.equal([1, 2, 3, 4])
    expect(parse('[foo, bar, baz, quux]')).to.deep.equal(['foo', 'bar', 'baz', 'quux'])
  })
  it('parses simple objects without commas', () => {
    expect(parse('{a: 1 b: 2}')).to.deep.equal({a: 1, b: 2})
    expect(parse('{"foo": "bar" baz: quux}')).to.deep.equal({'foo': 'bar', 'baz': 'quux'})
  })
  it('parses simple objects with commas', () => {
    expect(parse('{a: 1, b: 2}')).to.deep.equal({a: 1, b: 2})
    expect(parse('{"foo": "bar", baz: quux}')).to.deep.equal({'foo': 'bar', 'baz': 'quux'})
  })
  it('parses a top-level object without braces', () => {
    expect(parse('a: 1 b: 2')).to.deep.equal({a: 1, b: 2})
    expect(parse('"foo": "bar" baz: quux')).to.deep.equal({'foo': 'bar', 'baz': 'quux'})
  })
  it('parses a top-level object without braces, with commas', () => {
    expect(parse('a: 1, b: 2')).to.deep.equal({a: 1, b: 2})
    expect(parse('"foo": "bar", baz: quux')).to.deep.equal({'foo': 'bar', 'baz': 'quux'})
  })
  it ('parses top-level quoted forms', () => {
    expect(parse("'null")).to.deep.equal(["", null])
    expect(parse("'(1 2 3 4)")).to.deep.equal(["", [1, 2, 3, 4]])
    expect(parse("'{a: b, c: d}")).to.deep.equal(["", {a: 'b', c: 'd'}])
  })
  it ('parses top-level syntax-quoted forms', () => {
    expect(parse("`null")).to.deep.equal(["$syntax-quote", null])
    expect(parse("`(1 2 3 4)")).to.deep.equal(["$syntax-quote", [1, 2, 3, 4]])
    expect(parse("`{a: b, c: d}")).to.deep.equal(["$syntax-quote", {a: 'b', c: 'd'}])
  })
  it("can parse the project's JSON configuration files", () => {
    const file1 = readFileSync('package.json').toString()
    expect(parse(file1, 'package.json')).to.deep.equal(JSON.parse(file1))
    const file2 = readFileSync('package-lock.json').toString()
    expect(parse(file2, 'package-lock.json')).to.deep.equal(JSON.parse(file2))
    const file3 = readFileSync('tsconfig.json').toString()
    expect(parse(file3, 'tsconfig.json')).to.deep.equal(JSON.parse(file3))
  })
})
