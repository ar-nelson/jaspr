import {expect, cases, withModule} from './Helpers'
import {Jaspr, resolveFully, scopeKey, macroscopeKey, isClosure, Deferred} from '../src/Jaspr'
import * as _ from 'lodash'
import * as chai from 'chai'

function closure(fn: Jaspr, scope={}, macroscope={}) {
  return {fn, [scopeKey]: scope, [macroscopeKey]: macroscope}
}
const add1 = closure(['⚙add', 1, [0, '⚙args']])
const macro_add1 = closure([[], [null, 'add1'], [0, '⚙args']])
const macro_array_add1 =
  closure([[], [[], [null, 'add1'], [0, '⚙args']], [[], [null, 'add1'], [1, '⚙args']]])

describe('eval', () => {
  it('evaluates null, booleans, and numbers as themselves', cases({
    "null": expect.eval({}, null).toEqual(null),
    "true": expect.eval({}, true).toEqual(true),
    "false": expect.eval({}, false).toEqual(false),
    "0": expect.eval({}, 0).toEqual(0),
    "91": expect.eval({}, 91).toEqual(91),
    "empty array": expect.eval({}, []).toEqual([]),
    "empty object": expect.eval({}, {}).toEqual({})
  }))
  it('resolves strings as variables', cases({
    "foo = 1": expect.eval({foo: 1}, "foo").toEqual(1),
    "foo = bar": expect.eval({foo: "bar"}, "foo").toEqual("bar"),
    "foo = foo": expect.eval({foo: "foo"}, "foo").toEqual("foo"),
    "foo = [foo, bar]": expect.eval({foo: ["foo", "bar"]}, "foo").toEqual(["foo", "bar"]),
    "bar = [foo, bar]": expect.eval({bar: ["foo", "bar"]}, "bar").toEqual(["foo", "bar"]),
    "{a, b, c} = {1, 2, 3}": expect.eval({a: 1, b: 2, c: 3}, "b").toEqual(2)
  }))
  it('throws when variable cannot be resolved', expect.eval({}, "foo").toThrow())
  it('does not evaluate quoted code', cases({
    "'1": expect.eval({}, [null, 1]).toEqual(1),
    "'foo": expect.eval({}, [null, "foo"]).toEqual("foo"),
    "''foo": expect.eval({}, [null, [null, "foo"]]).toEqual([null, "foo"]),
    "'`foo":  expect.eval({}, [null, [true, "foo"]]).toEqual([true, "foo"]),
    "'foo w/ foo in scope":
      expect.eval({foo: "bar"}, [null, "foo"]).toEqual("foo"),
    "'(foo bar baz) w/ foo in scope":
      expect.eval({foo: "bar"}, [null, ["foo", "bar", "baz"]])
            .toEqual(["foo", "bar", "baz"]),
    "'{bar: foo, baz: quux} w/ foo in scope":
      expect.eval({foo: "bar"}, [null, {bar: "foo", baz: "quux"}])
            .toEqual({bar: "foo", baz: "quux"})
  }))
  it('indexes into arrays by calling numbers as functions', cases({
    "0": expect.eval({}, [0, [null, ["foo", "bar"]]]).toEqual("foo"),
    "1": expect.eval({}, [1, [null, ["foo", "bar"]]]).toEqual("bar"),
    "2": expect.eval({}, [2, [null, ["foo", "bar"]]]).toThrow()
  }))
  it('supports negative array indices', cases({
    "-1": expect.eval({}, [-1, [null, ["foo", "bar"]]]).toEqual("bar"),
    "-2": expect.eval({}, [-2, [null, ["foo", "bar"]]]).toEqual("foo")
  }))
  it('indexes into objects by calling strings as functions', cases({
    "a": expect.eval({}, [[null, "a"], {a: 1, b: 2}]).toEqual(1),
    "b": expect.eval({}, [[null, "b"], {a: 1, b: 2}]).toEqual(2),
    "c": expect.eval({}, [[null, "c"], {a: 1, b: 2}]).toThrow()
  }))
  it('does not leak JavaScript properties via object indexing', cases({
    "String.length": expect.eval({}, [[null, "length"], [null, "foo"]]).toThrow(),
    "Array.length": expect.eval({}, [[null, "length"], [null, [1, 2]]]).toThrow(),
    "Object.hasOwnProperty": expect.eval({}, [[null, "hasOwnProperty"], {a: 1, b: 2}]).toThrow()
  }))
  describe('closure', () => {
    it('can be called inline', expect.eval({}, [[null, closure(91)]]).toEqual(91))
    it('loads its own scope',
      expect.eval({}, [[null, closure("foo", {foo: 1})]]).toEqual(1))
    it('replaces the callsite scope',
      expect.eval({foo: 1}, [[null, closure("foo", {foo: 2})]]).toEqual(2))
    it('cannot access the callsite scope',
      expect.eval({foo: 1}, [[null, closure("foo")]]).toThrow())
    it('stores arguments array in ⚙args',
      expect.eval({}, [[null, closure([1, "⚙args"])],
                      [null, "foo"],
                      [null, "bar"],
                      [null, "baz"]]).toEqual("bar"))
  })
  describe('supports builtin function', () => {
    it('⚙if', cases({
      "then": expect.eval({}, ["⚙if", true, 1, 2]).toEqual(1),
      "else": expect.eval({}, ["⚙if", false, 1, 2]).toEqual(2)
    }))
    /*it('⚙macroget', () =>
      expect(i.jasprEval({scope: {}, macroscope: {a: 1}}, ["⚙macroget", "a"])).to.become(1))
    it('⚙macroexpand', async () => {
      await expect(i.jasprEval(
        {scope: {}, macroscope: {add1}},
        ["⚙macroexpand", [null, ["add1", 4]]])).to.become(5)
      await expect(i.jasprEval(
        {scope: {add1}, macroscope: {macro_add1}},
        ["⚙macroexpand", [null, ["macro_add1", 4]]])).to.become(["add1", 4])
      await expect(i.jasprEval(
        {scope: {add1: null}, macroscope: {add1, macro_add1}},
        ["⚙macroexpand", [null, ["macro_add1", 4]]])).to.become(5)
    })*/
    it('⚙closure', cases({
      "create closure":
        expect.eval({a:1, b: 2}, ["⚙closure", {}, ["+", 1, 2], {}]).toPass(cl => {
          const {expect} = chai
          expect(cl).to.be.an('object')
          expect(cl).to.have.property(scopeKey)
          expect(cl).to.have.property('fn').deep.equal(["+", 1, 2])
          const sc = (<any>cl)[scopeKey]
          expect(sc).to.be.an('object')
          expect(sc).to.have.property('a').equal(1)
          expect(sc).to.have.property('b').equal(2)
        }),
      "extend parent scope":
        expect.eval({a: 1, b: 2}, ["⚙closure", {c: 3}, null, {}]).toPass(cl => {
          const {expect} = chai, sc = (<any>cl)[scopeKey]
          expect(sc).to.be.an('object')
          expect(sc).to.have.property('a').equal(1)
          expect(sc).to.have.property('b').equal(2)
          expect(sc).to.have.property('c') // won't be resolved...
        }),
      "shadow binding in parent scope":
        expect.eval({a: 1, b: 2}, ["⚙closure", {a: 3}, null, {}]).toPass(cl => {
          const {expect} = chai, sc = (<any>cl)[scopeKey]
          expect(sc).to.be.an('object')
          expect(sc).to.have.property('a').not.equal(1) // won't be resolved...
          expect(sc).to.have.property('b').equal(2)
          expect(sc).to.not.have.property('c')
        })
      }))
    it('⚙equals', cases({
      "0 = 0": expect.eval({}, ["⚙equals", 0, 0]).toEqual(true),
      "0 != 1": expect.eval({}, ["⚙equals", 0, 1]).toEqual(false),
      "0 != null": expect.eval({}, ["⚙equals", 0, null]).toEqual(false)
    }))
    it('⚙add', expect.eval({}, ["⚙add", 2, 3]).toEqual(5))
    it('⚙subtract', expect.eval({}, ["⚙subtract", 2, 3]).toEqual(-1))
    it('⚙multiply', expect.eval({}, ["⚙multiply", 2, 3]).toEqual(6))
    it('⚙divide', expect.eval({}, ["⚙divide", 6, 2]).toEqual(3))
    it('⚙modulus', expect.eval({}, ["⚙modulus", 5, 2]).toEqual(1))
    it('⚙negate', expect.eval({}, ["⚙negate", 5]).toEqual(-5))
    it('⚙toString', expect.eval({}, ["⚙toString", 91]).toEqual("91"))
    it('⚙arrayConcat',
      expect.eval({}, ["⚙arrayConcat", [[], 1, 2], [[], 3, 4]]).toEqual([1, 2, 3, 4]))
    it('⚙objectMerge',
      expect.eval({}, ["⚙objectMerge", {a: 1, b: 2}, {b: 3, c: 4}]).toEqual({a: 1, b: 3, c: 4}))
  })
  it('can call a function from the scope',
    expect.eval({add1}, ["add1", 2]).toEqual(3))
  it('can call multiple functions inside arrays',
    expect.eval({add1}, [[], ["add1", 1], ["add1", 2], 4]).toEqual([2, 3, 4]))
  it('can call multiple functions inside objects',
    expect.eval({add1}, {a: ["add1", 1], b: ["add1", 2], c: 4}).toEqual({a: 2, b: 3, c: 4}))
})

describe('macroexpand', () => {
  it('does not expand scalar values', cases({
    "null": expect.macroExpand({}, null).toEqual(null),
    "true": expect.macroExpand({}, true).toEqual(true),
    "false": expect.macroExpand({}, false).toEqual(false),
    "empty string": expect.macroExpand({}, "").toEqual(""),
    "unbound string": expect.macroExpand({}, "foo").toEqual("foo"),
    "bound string": expect.macroExpand({foo: 1}, "foo").toEqual("foo"),
    "0": expect.macroExpand({}, 0).toEqual(0),
    "91": expect.macroExpand({}, 91).toEqual(91),
    "empty array": expect.macroExpand({}, []).toEqual([]),
    "empty object": expect.macroExpand({}, {}).toEqual({})
  }))
  it('does not expand non-macro calls', cases({
    "no binding, string":
      expect.macroExpand({}, ["foo", "bar"]).toEqual(["foo", "bar"]),
    "different binding, string":
      expect.macroExpand({add1}, ["foo", "bar"]).toEqual(["foo", "bar"]),
    "no binding, number":
      expect.macroExpand({}, [0, "bar"]).toEqual([0, "bar"]),
    "one binding, number":
      expect.macroExpand({add1}, [0, "bar"]).toEqual([0, "bar"])
  }))
  it('expands macro calls from the scope',
    expect.macroExpand({add1}, ["add1", 2]).toEqual(3))
  it('recursively expands',
    expect.macroExpand({add1, macro_add1}, ["macro_add1", 2]).toEqual(3))
  it('does not expand quoted code',
    expect.macroExpand({add1}, [null, ["add1", 2]]).toEqual([null, ["add1", 2]]))
  it('expands arguments to []',
    expect.macroExpand({add1}, [[], ["add1", 1], ["add1", 2]]).toEqual([[], 2, 3]))
  it('expands arguments to non-macro call',
    expect.macroExpand({add1}, ["foo", ["add1", 1], ["add1", 2]]).toEqual(["foo", 2, 3]))
  it('recursively expands arguments',
    expect.macroExpand({add1, macro_array_add1},
      ["macro_array_add1", 1, 2]).toEqual([[], 2, 3]))
  describe('syntax-quote', () => {
    it('becomes a normal quote macro when there are no unquotes', cases({
      "`1": expect.macroExpand({}, [true, 1]).toEqual([null, 1]),
      "`foo": expect.macroExpand({}, [true, "foo"]).toEqual([null, "foo"]),
      "`'foo": expect.macroExpand({}, [true, [null, "foo"]])
                     .toEqual([null, [null, "foo"]]),
      "``foo": expect.macroExpand({}, [true, [true, "foo"]])
                     .toEqual([null, [true, "foo"]]),
      "`foo w/ foo bound":
        expect.macroExpand({foo: add1}, [true, "foo"]).toEqual([null, "foo"]),
      "`(foo, 0) w/ foo bound":
        expect.macroExpand({foo: add1}, [true, ["foo", 0]])
              .toEqual([[], [null, "foo"], [null, 0]])
    }))
    it('cancels out `~', expect.macroExpand({}, [true, [false, 1]]).toEqual(1))
    it('expands macros inside `~',
      expect.macroExpand({add1}, [true, [false, ["add1", 1]]]).toEqual(2))
    it('uses [] to join unquotes', cases({
      "`[~1 2]": expect.macroExpand({}, [true, [[false, 1], 2]]).toEqual([[], 1, [null, 2]]),
      "`[~[1 2] [~3 4]]":
        expect.macroExpand({}, [true, [[false, [1, 2]], [[false, 3], 4]]])
              .toEqual([[], [1, 2], [[], 3, [null, 4]]])
    }))
    it('expands macros inside unquotes',
      expect.macroExpand({add1}, [true, [1, [false, ["add1", 1]], 3]])
            .toEqual([[], [null, 1], 2, [null, 3]]))
    it('uses arrayConcat to join [false [] ...]/~@ list unquotes',
      expect.macroExpand({}, [true, [1, 2, [false, [], [null, [3, 4]]]]])
            .toEqual(["⚙arrayConcat", [[], [null, 1], [null, 2]], [null, [3, 4]]]))
    it('can nest', cases({
      "`~`": expect.macroExpand({foo: 1}, [true, [false, [true, "foo"]]])
                   .toEqual([null, "foo"]),
      "`~`~": expect.macroExpand({foo: 1}, [true, [false, [true, [false, "foo"]]]])
                    .toEqual("foo"),
      "``~": expect.macroExpand({foo: 1}, [true, [true, [false, "foo"]]])
                   .toEqual([null, [true, [false, "foo"]]])
    }))
  })
})

const letScope = {
  "macro.let": ["⚙closure", {}, [true, [["⚙closure", [false, [], "⚙args"], {}]]], {}]
}

const fnScope = _.merge({}, letScope, {
  "macro.fn*": ["⚙closure", {},
    [true, ["⚙closure", {}, ["let", {"args": "⚙args"}, [false, [0, "⚙args"]]], {}]], {}]
})

describe('evalModule', () => {
  it('evaluates literal variables', withModule({
    module: 'test',
    export: ['a', 'b'],
    defs: {a: 1, b: 2}
  }, scope => done => {
    chai.expect(scope).to.have.property('a').equal(1)
    chai.expect(scope).to.have.property('b').equal(2)
    done()
  }))
  it('evaluates simple code w/o a scope', withModule({
    module: 'test',
    export: ['a', 'b'],
    defs: {a: [null, "foo"], b: ["⚙add", 1, 2]}
  }, scope => done => {
    chai.expect(scope).to.have.property('a').equal("foo")
    chai.expect(scope).to.have.property('b').equal(3)
    done()
  }))
  it('evaluates variables in the scope', withModule({
    module: 'test',
    export: ['a', 'b', 'c'],
    defs: {a: 1, b: "a", c: "b"}
  }, scope => done => {
    chai.expect(scope).to.have.property('a').equal(1)
    chai.expect(scope).to.have.property('b').equal(1)
    chai.expect(scope).to.have.property('c').equal(1)
    done()
  }))
  it('evaluates functions in the scope', withModule({
      module: 'test',
      export: ['a', 'b'],
      defs: {add1: [null, add1], a: ["add1", 2], b: ["add1", 3]}
  }, scope => done => {
    chai.expect(scope).to.have.property('a').equal(3)
    chai.expect(scope).to.have.property('b').equal(4)
    done()
  }))
  it('evaluates macros in the scope', withModule({
    module: 'test',
    export: ['a', 'b'],
    defs: {a: ["add1", 2], b: ["add1", 3], "macro.add1": [null, add1]}
  }, scope => done => {
    chai.expect(scope).to.have.property('a').equal(3)
    chai.expect(scope).to.have.property('b').equal(4)
    done()
  }))
  it('can define "let"', withModule(
    {module: 'test', export: ['let', 'closure'], defs: letScope},
    (s, m) => cases({
      "one level":
        expect.fullEval(s, m, ["let", {a: 1}, "a"]).toEqual(1),
      "two levels, no shadowing":
        expect.fullEval(s, m, ["let", {a: 1}, ["let", {b: 2}, "b"]]).toEqual(2),
      "two levels, shadowing":
        expect.fullEval(s, m, ["let", {a: 1}, ["let", {a: 2}, "a"]]).toEqual(2),
      "one shadowed, one not":
        expect.fullEval(s, m, ["let", {a: 1, b: 3}, ["let", {a: 2}, "b"]]).toEqual(3),
      "let inside variable":
        expect.fullEval(s, m, ["let", {a: ["let", {b: 2}, "b"]}, "a"]).toEqual(2)
    })))
  it('can use "let" from another scope member', withModule(
    {module: 'test', export: ['a'], defs: _.merge({a: ["let", {b: 1}, "b"]}, letScope)},
    scope => done => {
      chai.expect(scope).to.have.property('a').equal(1)
      chai.expect(scope).to.not.have.property('b')
      done()
    }))
  it('can define "fn*"', withModule(
    {module: 'test', export: ['fn*'], defs: fnScope},
    (scope, macros) => done => {
      chai.expect(macros).to.have.property('fn*').not.be.an.instanceOf(Deferred)
      chai.expect(isClosure(<Jaspr>macros['fn*'])).to.be.true
      done()
    }))
  it('can define a macro with "fn*"', withModule({
      module: 'test',
      export: ['add1'],
      defs: _.merge({"macro.add1": ["fn*", ["⚙add", 1, [0, "args"]]]}, fnScope)
    }, (scope, macros) => done => {
      chai.expect(macros).to.have.property('add1').not.be.an.instanceOf(Deferred)
      chai.expect(isClosure(<Jaspr>macros.add1)).to.be.true
      done()
    }))
  it('can use a "fn*"-defined macro in the scope', withModule({
      module: 'test',
      export: ['a'],
      defs: _.merge({"macro.add1": ["fn*", ["⚙add", 1, [0, "args"]]], a: ["add1", 2]}, fnScope)
    }, scope => done => {
      chai.expect(scope).to.have.property('a').equal(3)
      done()
    }))
})
