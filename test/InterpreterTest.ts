import {expect, cases, withDefs} from './Helpers'
import {
  Jaspr, JasprObject, JasprClosure, JsonObject, Scope, resolveFully,
  isClosure, Deferred, emptyScope, makeDynamic
} from '../src/Jaspr'
import * as Names from '../src/ReservedNames'
import * as _ from 'lodash'
import * as chai from 'chai'

const sq = Names.syntaxQuote, uq = Names.unquote, uqs = Names.unquoteSplicing

function closure(fn: Jaspr, scope=emptyScope): JsonObject & JasprClosure {
  return <any>{[Names.code]: fn, [Names.closure]: scope}
}
function values(value: JasprObject): Scope {
  return _.create(emptyScope, {value})
}
function macros(macro: JasprObject): Scope {
  return _.create(emptyScope, {macro})
}
const add1 = closure(['$add', 1, [0, '$args']])
const macro_add1 = closure([[], ['', 'add1'], [0, '$args']])
const macro_array_add1 =
  closure([[], [[], ['', 'add1'], [0, '$args']], [[], ['', 'add1'], [1, '$args']]])
const dyn = makeDynamic(false)

describe('eval', () => {
  it('evaluates null, booleans, numbers, and empty structures as themselves', cases({
    "null": expect.eval(emptyScope, null).toEqual(null),
    "true": expect.eval(emptyScope, true).toEqual(true),
    "false": expect.eval(emptyScope, false).toEqual(false),
    "0": expect.eval(emptyScope, 0).toEqual(0),
    "91": expect.eval(emptyScope, 91).toEqual(91),
    "empty string": expect.eval(emptyScope, "").toEqual(""),
    "empty array": expect.eval(emptyScope, []).toEqual([]),
    "empty object": expect.eval(emptyScope, {}).toEqual({})
  }))
  it('resolves strings as variables', cases({
    "foo = 1": expect.eval(values({foo: 1}), "foo").toEqual(1),
    "foo = bar": expect.eval(values({foo: "bar"}), "foo").toEqual("bar"),
    "foo = foo": expect.eval(values({foo: "foo"}), "foo").toEqual("foo"),
    "foo = [foo, bar]": expect.eval(values({foo: ["foo", "bar"]}), "foo").toEqual(["foo", "bar"]),
    "bar = [foo, bar]": expect.eval(values({bar: ["foo", "bar"]}), "bar").toEqual(["foo", "bar"]),
    "{a, b, c} = {1, 2, 3}": expect.eval(values({a: 1, b: 2, c: 3}), "b").toEqual(2)
  }))
  it('throws when variable cannot be resolved', expect.eval(emptyScope, "foo").toThrow())
  it('does not evaluate quoted code', cases({
    "'1": expect.eval(emptyScope, ['', 1]).toEqual(1),
    "'foo": expect.eval(emptyScope, ['', "foo"]).toEqual("foo"),
    "''foo": expect.eval(emptyScope, ['', ['', "foo"]]).toEqual(['', "foo"]),
    "'`foo":  expect.eval(emptyScope, ['', [sq, "foo"]]).toEqual([sq, "foo"]),
    "'foo w/ foo in scope":
      expect.eval(values({foo: "bar"}), ['', "foo"]).toEqual("foo"),
    "'(foo bar baz) w/ foo in scope":
      expect.eval(values({foo: "bar"}), ['', ["foo", "bar", "baz"]])
            .toEqual(["foo", "bar", "baz"]),
    "'{bar: foo, baz: quux} w/ foo in scope":
      expect.eval(values({foo: "bar"}), ['', {bar: "foo", baz: "quux"}])
            .toEqual({bar: "foo", baz: "quux"})
  }))
  it('indexes into arrays by calling numbers as functions', cases({
    "0": expect.eval(emptyScope, [0, ['', ["foo", "bar"]]]).toEqual("foo"),
    "1": expect.eval(emptyScope, [1, ['', ["foo", "bar"]]]).toEqual("bar"),
    "2": expect.eval(emptyScope, [2, ['', ["foo", "bar"]]]).toThrow()
  }))
  it('supports negative array indices', cases({
    "-1": expect.eval(emptyScope, [-1, ['', ["foo", "bar"]]]).toEqual("bar"),
    "-2": expect.eval(emptyScope, [-2, ['', ["foo", "bar"]]]).toEqual("foo")
  }))
  it('indexes into objects by calling strings as functions', cases({
    "a": expect.eval(emptyScope, [['', "a"], {a: 1, b: 2}]).toEqual(1),
    "b": expect.eval(emptyScope, [['', "b"], {a: 1, b: 2}]).toEqual(2),
    "c": expect.eval(emptyScope, [['', "c"], {a: 1, b: 2}]).toThrow()
  }))
  it('does not leak JavaScript properties via object indexing', cases({
    "String.length": expect.eval(emptyScope, [['', "length"], ['', "foo"]]).toThrow(),
    "Array.length": expect.eval(emptyScope, [['', "length"], ['', [1, 2]]]).toThrow(),
    "Object.hasOwnProperty": expect.eval(emptyScope, [['', "hasOwnProperty"], {a: 1, b: 2}]).toThrow()
  }))
  describe('closure', () => {
    it('can be called inline', expect.eval(emptyScope, [['', closure(91)]]).toEqual(91))
    it('loads its own scope',
      expect.eval(emptyScope, [['', closure("foo", values({foo: 1}))]]).toEqual(1))
    it('replaces the callsite scope',
      expect.eval(values({foo: 1}), [['', closure("foo", values({foo: 2}))]]).toEqual(2))
    it('cannot access the callsite scope',
      expect.eval(values({foo: 1}), [['', closure("foo")]]).toThrow())
    it('stores arguments array in $args',
      expect.eval(emptyScope, [['', closure([1, "$args"])],
                              ['', "foo"],
                              ['', "bar"],
                              ['', "baz"]]).toEqual("bar"))
  })
  describe('supports builtin function', () => {
    it('$if', cases({
      "then": expect.eval(emptyScope, ["$if", true, 1, 2]).toEqual(1),
      "else": expect.eval(emptyScope, ["$if", false, 1, 2]).toEqual(2)
    }))
    it('$closure', cases({
      "create closure":
        expect.eval(values({a:1, b: 2}), ["$closure", {}, ["+", 1, 2], {}]).toPass(cl => {
          const {expect} = chai
          expect(cl).to.be.an('object')
          expect(cl).to.have.property(Names.closure).be.an('object')
          expect(cl).to.have.property(Names.code).deep.equal(["+", 1, 2])
          const sc = (<any>cl)[Names.closure]
          expect(sc).to.have.property('value').be.an('object')
          expect(sc.value).to.have.property('a').equal(1)
          expect(sc.value).to.have.property('b').equal(2)
        }),
      "extend parent scope":
        expect.eval(values({a: 1, b: 2}), ["$closure", {c: 3}, null, {}]).toPass(cl => {
          const {expect} = chai, sc = (<any>cl)[Names.closure]
          expect(sc).to.be.an('object')
          expect(sc).to.have.property('value').be.an('object')
          expect(sc.value).to.have.property('a').equal(1)
          expect(sc.value).to.have.property('b').equal(2)
          expect(sc.value).to.have.property('c') // won't be resolved...
        }),
      "shadow binding in parent scope":
        expect.eval(values({a: 1, b: 2}), ["$closure", {a: 3}, null, {}]).toPass(cl => {
          const {expect} = chai, sc = (<any>cl)[Names.closure]
          expect(sc).to.be.an('object')
          expect(sc).to.have.property('value').be.an('object')
          expect(sc.value).to.have.property('a').not.equal(1) // won't be resolved...
          expect(sc.value).to.have.property('b').equal(2)
          expect(sc.value).to.not.have.property('c')
        })
      }))
    it('$equals', cases({
      "0 = 0": expect.eval(emptyScope, ["$equals", 0, 0]).toEqual(true),
      "0 != 1": expect.eval(emptyScope, ["$equals", 0, 1]).toEqual(false),
      "0 != null": expect.eval(emptyScope, ["$equals", 0, null]).toEqual(false)
    }))
    it('$add', expect.eval(emptyScope, ["$add", 2, 3]).toEqual(5))
    it('$subtract', expect.eval(emptyScope, ["$subtract", 2, 3]).toEqual(-1))
    it('$multiply', expect.eval(emptyScope, ["$multiply", 2, 3]).toEqual(6))
    it('$divide', expect.eval(emptyScope, ["$divide", 6, 2]).toEqual(3))
    it('$modulus', expect.eval(emptyScope, ["$modulus", 5, 2]).toEqual(1))
    it('$negate', expect.eval(emptyScope, ["$negate", 5]).toEqual(-5))
    it('$toString', expect.eval(emptyScope, ["$toString", 91]).toEqual("91"))
    it('$arrayConcat',
      expect.eval(emptyScope, ["$arrayConcat", [[], 1, 2], [[], 3, 4]]).toEqual([1, 2, 3, 4]))
    it('$dynamicGet, $dynamicLet', cases({
      "get default":
        expect.eval(emptyScope, ["$dynamicGet", ["", dyn]]).toEqual(false),
      "let then get":
        expect.eval(emptyScope,
            ["$dynamicLet", ["", dyn], true, ["$dynamicGet", ["", dyn]]])
          .toEqual(true),
      "get from closure":
        expect.eval(_.merge({}, emptyScope, {value: {get: {$closure:{}, $code:["$dynamicGet", [0, "$args"]]}}}),
            ["$dynamicLet", ["", dyn], true, ["get", ["", dyn]]])
          .toEqual(true),
    }))
  })
  it('can call a function from the scope',
    expect.eval(values({add1}), ["add1", 2]).toEqual(3))
  it('can call multiple functions inside arrays',
    expect.eval(values({add1}), [[], ["add1", 1], ["add1", 2], 4]).toEqual([2, 3, 4]))
  it('can call multiple functions inside objects',
    expect.eval(values({add1}), {a: ["add1", 1], b: ["add1", 2], c: 4}).toEqual({a: 2, b: 3, c: 4}))
})

describe('macroexpand', () => {
  it('does not expand scalar values', cases({
    "null": expect.macroExpand(emptyScope, null).toEqual(null),
    "true": expect.macroExpand(emptyScope, true).toEqual(true),
    "false": expect.macroExpand(emptyScope, false).toEqual(false),
    "empty string": expect.macroExpand(emptyScope, "").toEqual(""),
    "unbound string": expect.macroExpand(emptyScope, "foo").toEqual("foo"),
    "bound string": expect.macroExpand(macros({foo: 1}), "foo").toEqual("foo"),
    "0": expect.macroExpand(emptyScope, 0).toEqual(0),
    "91": expect.macroExpand(emptyScope, 91).toEqual(91),
    "empty array": expect.macroExpand(emptyScope, []).toEqual([]),
    "empty object": expect.macroExpand(emptyScope, {}).toEqual({})
  }))
  it('does not expand non-macro calls', cases({
    "no binding, string":
      expect.macroExpand(emptyScope, ["foo", "bar"]).toEqual(["foo", "bar"]),
    "different binding, string":
      expect.macroExpand(macros({add1}), ["foo", "bar"]).toEqual(["foo", "bar"]),
    "no binding, number":
      expect.macroExpand(emptyScope, [0, "bar"]).toEqual([0, "bar"]),
    "one binding, number":
      expect.macroExpand(macros({add1}), [0, "bar"]).toEqual([0, "bar"])
  }))
  it('expands macro calls from the scope',
    expect.macroExpand(macros({add1}), ["add1", 2]).toEqual(3))
  it('recursively expands',
    expect.macroExpand(macros({add1, macro_add1}), ["macro_add1", 2]).toEqual(3))
  it('does not expand quoted code',
    expect.macroExpand(macros({add1}), ['', ["add1", 2]]).toEqual(['', ["add1", 2]]))
  it('expands arguments to []',
    expect.macroExpand(macros({add1}), [[], ["add1", 1], ["add1", 2]]).toEqual([[], 2, 3]))
  it('expands arguments to non-macro call',
    expect.macroExpand(macros({add1}), ["foo", ["add1", 1], ["add1", 2]]).toEqual(["foo", 2, 3]))
  it('recursively expands arguments',
    expect.macroExpand(macros({add1, macro_array_add1}),
      ["macro_array_add1", 1, 2]).toEqual([[], 2, 3]))
  describe('syntax-quote', () => {
    it('becomes a normal quote macro when there are no unquotes', cases({
      "`1": expect.macroExpand(emptyScope, [sq, 1]).toEqual(['', 1]),
      "`foo": expect.macroExpand(emptyScope, [sq, "foo"]).toEqual(['', "foo"]),
      "`'foo": expect.macroExpand(emptyScope, [sq, ['', "foo"]])
                     .toEqual(['', ['', "foo"]]),
      "``foo": expect.macroExpand(emptyScope, [sq, [sq, "foo"]])
                     .toEqual(['', [sq, "foo"]]),
      "`foo w/ foo bound":
        expect.macroExpand(macros({foo: add1}), [sq, "foo"]).toEqual(['', "foo"]),
      "`(foo, 0) w/ foo bound":
        expect.macroExpand(macros({foo: add1}), [sq, ["foo", 0]])
              .toEqual([[], ['', "foo"], ['', 0]])
    }))
    it('cancels out `~', expect.macroExpand(emptyScope, [sq, [uq, 1]]).toEqual(1))
    it('expands macros inside `~',
      expect.macroExpand(macros({add1}), [sq, [uq, ["add1", 1]]]).toEqual(2))
    it('uses [] to join unquotes', cases({
      "`[~1 2]": expect.macroExpand(emptyScope, [sq, [[uq, 1], 2]]).toEqual([[], 1, ['', 2]]),
      "`[~[1 2] [~3 4]]":
        expect.macroExpand(emptyScope, [sq, [[uq, [1, 2]], [[uq, 3], 4]]])
              .toEqual([[], [1, 2], [[], 3, ['', 4]]])
    }))
    it('expands macros inside unquotes',
      expect.macroExpand(macros({add1}), [sq, [1, [uq, ["add1", 1]], 3]])
            .toEqual([[], ['', 1], 2, ['', 3]]))
    it('uses arrayConcat to join $unquoteSplicing/~@',
      expect.macroExpand(emptyScope, [sq, [1, 2, [uqs, ['', [3, 4]]]]])
            .toEqual(["$arrayConcat", [[], ['', 1], ['', 2]], ['', [3, 4]]]))
    it('can nest', cases({
      "`~`": expect.macroExpand(macros({foo: 1}), [sq, [uq, [sq, "foo"]]])
                   .toEqual(['', "foo"]),
      "`~`~": expect.macroExpand(macros({foo: 1}), [sq, [uq, [sq, [uq, "foo"]]]])
                    .toEqual("foo"),
      "``~": expect.macroExpand(macros({foo: 1}), [sq, [sq, [uq, "foo"]]])
                   .toEqual(['', [sq, [uq, "foo"]]])
    }))
  })
})

const letScope = {
  "macro.let": ["$closure", {}, [sq, [["$closure", [uqs, "$args"], {}]]], {}]
}

const fnScope = _.merge({}, letScope, {
  "macro.fn*": ["$closure", {},
    [sq, ["$closure", {}, ["let", {"args": "$args"}, [uq, [0, "$args"]]], {}]], {}]
})

describe('evalDefs', () => {
  it('evaluates literal variables', withDefs({a: 1, b: 2},
    scope => done => {
      chai.expect(scope.value).to.have.property('a').equal(1)
      chai.expect(scope.value).to.have.property('b').equal(2)
      done()
    }))
  it('evaluates simple code w/o a scope', withDefs({
    a: ['', "foo"], b: ["$add", 1, 2]
  }, scope => done => {
    chai.expect(scope.value).to.have.property('a').equal("foo")
    chai.expect(scope.value).to.have.property('b').equal(3)
    done()
  }))
  it('evaluates variables in the scope', withDefs({a: 1, b: "a", c: "b"},
    scope => done => {
      chai.expect(scope.value).to.have.property('a').equal(1)
      chai.expect(scope.value).to.have.property('b').equal(1)
      chai.expect(scope.value).to.have.property('c').equal(1)
      done()
    }))
  it('evaluates functions in the scope', withDefs({
    add1: ['', add1], a: ["add1", 2], b: ["add1", 3]
  }, scope => done => {
    chai.expect(scope.value).to.have.property('a').equal(3)
    chai.expect(scope.value).to.have.property('b').equal(4)
    done()
  }))
  it('evaluates macros in the scope', withDefs({
    a: ["add1", 2], b: ["add1", 3], "macro.add1": ['', add1]
  }, scope => done => {
    chai.expect(scope.value).to.have.property('a').equal(3)
    chai.expect(scope.value).to.have.property('b').equal(4)
    done()
  }))
  it('can define "let"', withDefs(letScope,
    scope => cases({
      "one level":
        expect.fullEval(scope, ["let", {a: 1}, "a"]).toEqual(1),
      "two levels, no shadowing":
        expect.fullEval(scope, ["let", {a: 1}, ["let", {b: 2}, "b"]]).toEqual(2),
      "two levels, shadowing":
        expect.fullEval(scope, ["let", {a: 1}, ["let", {a: 2}, "a"]]).toEqual(2),
      "one shadowed, one not":
        expect.fullEval(scope, ["let", {a: 1, b: 3}, ["let", {a: 2}, "b"]]).toEqual(3),
      "let inside variable":
        expect.fullEval(scope, ["let", {a: ["let", {b: 2}, "b"]}, "a"]).toEqual(2)
    })))
  it('can use "let" from another scope member', withDefs(
    _.merge({a: ["let", {b: 1}, "b"]}, letScope),
    scope => done => {
      chai.expect(scope.value).to.have.property('a').equal(1)
      chai.expect(scope.value).to.not.have.property('b')
      done()
    }))
  it('can define "fn*"', withDefs(
    fnScope,
    scope => done => {
      chai.expect(scope.macro).to.have.property('fn*').not.be.an.instanceOf(Deferred)
      chai.expect(isClosure(<Jaspr>scope.macro['fn*'])).to.be.true
      done()
    }))
  it('can define a macro with "fn*"', withDefs(_.merge({
      "macro.add1": ["fn*", ["$add", 1, [0, "args"]]]
    }, fnScope), scope => done => {
      chai.expect(scope.macro).to.have.property('add1').not.be.an.instanceOf(Deferred)
      chai.expect(isClosure(<Jaspr>scope.macro.add1)).to.be.true
      done()
    }))
  it('can use a "fn*"-defined macro in the scope', withDefs(_.merge({
      "macro.add1": ["fn*", ["$add", 1, [0, "args"]]], a: ["add1", 2]
    }, fnScope), scope => done => {
      chai.expect(scope.value).to.have.property('a').equal(3)
      done()
    }))
})
