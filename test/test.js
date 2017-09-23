const Promise = require('bluebird')
const _ = require('lodash')
const i = require('../interpreter')
const chai = require('chai')
const expect = chai.expect
chai.use(require("chai-as-promised"))

const noScope = {scope: {}, macroscope: {}}
function closure(fn, scope={}, macroscope={}) {
  return {fn, '⚙scope': scope, '⚙macros': macroscope}
}
const add1 = closure(['⚙add', 1, [0, '⚙args']])
const macro_add1 = closure([true, ['add1', [false, [0, '⚙args']]]])

function deepResolve(p) {
  if (_.isArray(p)) return Promise.map(p, deepResolve)
  else if (_.isPlainObject(p)) return Promise.props(_.mapValues(p, deepResolve))
  else return p
}

describe('eval', () => {
  function eval(scope, from, to) {
    return expect(i.jasprEval({scope, macroscope: {}}, from).then(deepResolve)).to.become(to)
  }
  it('evaluates null, booleans, and numbers as themselves', async () => {
    await eval({}, null, null)
    await eval({}, true, true)
    await eval({}, false, false)
    await eval({}, 0, 0)
    await eval({}, 91, 91)
    await eval({}, [], [])
    await eval({}, {}, {})
  })
  it('resolves strings as variables', async () => {
    await eval({foo: 1},              "foo", 1)
    await eval({foo: "bar"},          "foo", "bar")
    await eval({foo: "foo"},          "foo", "foo")
    await eval({foo: ["foo", "bar"]}, "foo", ["foo", "bar"])
    await eval({bar: ["foo", "bar"]}, "bar", ["foo", "bar"])
    await eval({a: 1, b: 2, c: 3},    "b", 2)
  })
  it('throws when variable cannot be resolved', async () => {
    return expect(i.jasprEval(noScope, "foo")).to.be.rejected
  })
  it('does not evaluate quoted code', async () => {
    await eval({},           [null, 1], 1)
    await eval({},           [null, "foo"], "foo")
    await eval({},           [null, [null, "foo"]], [null, "foo"])
    await eval({},           [null, [true, "foo"]], [true, "foo"])
    await eval({foo: "bar"}, [null, "foo"], "foo")
    await eval({foo: "bar"}, [null, ["foo", "bar", "baz"]], ["foo", "bar", "baz"])
    await eval({foo: "bar"}, [null, {bar: "foo", baz: "quux"}], {bar: "foo", baz: "quux"})
  })
  it('indexes into arrays by calling numbers as functions', async () => {
    await eval({}, [0, [null, ["foo", "bar"]]], "foo")
    await eval({}, [1, [null, ["foo", "bar"]]], "bar")
    await expect(i.jasprEval(noScope, [2, [null, ["foo", "bar"]]])).to.be.rejected
  })
  it('negative array indices', async () => {
    await eval({}, [-1, [null, ["foo", "bar"]]], "bar")
    await eval({}, [-2, [null, ["foo", "bar"]]], "foo")
  })
  it('indexes into objects by calling strings as functions', async () => {
    await eval({}, [[null, "a"], {a: 1, b: 2}], 1)
    await eval({}, [[null, "b"], {a: 1, b: 2}], 2)
    await expect(i.jasprEval(noScope, [[null, "c"], {a: 1, b: 2}])).to.be.rejected
  })
  it('does not leak JavaScript properties via object indexing', async () => {
    await expect(i.jasprEval(noScope, [[null, "length"], [null, "foo"]])).to.be.rejected
    await expect(i.jasprEval(noScope, [[null, "length"], [null, [1, 2]]])).to.be.rejected
    await expect(i.jasprEval(noScope, [[null, "hasOwnProperty"], {a: 1, b: 2}])).to.be.rejected
  })
  describe('closure', () => {
    it('can be called inline', () => eval({}, [[null, closure(91)]], 91))
    it('loads its own scope', () =>
      eval({}, [[null, closure("foo", {foo: 1})]], 1))
    it('replaces the callsite scope', () =>
      eval({foo: 1}, [[null, closure("foo", {foo: 2})]], 2))
    it('cannot access the callsite scope', () =>
      expect(i.jasprEval({scope: {foo: 1}, macroscope: {}},
                         [[null, closure("foo")]])).to.be.rejected)
    it('stores arguments array in ⚙args', () =>
      eval({}, [[null, closure([1, "⚙args"])],
                [null, "foo"],
                [null, "bar"],
                [null, "baz"]], "bar"))
  })
  describe('syntax-quote', () => {
    it('does not evaluate quoted code', async () => {
      await eval({},           [true, 1], 1)
      await eval({},           [true, "foo"], "foo")
      await eval({},           [true, [null, "foo"]], [null, "foo"])
      await eval({},           [true, [true, "foo"]], [true, "foo"])
      await eval({foo: "bar"}, [true, "foo"], "foo")
      await eval({foo: "bar"}, [true, ["foo", "bar", "baz"]], ["foo", "bar", "baz"])
      await eval({foo: "bar"}, [true, {bar: "foo", baz: "quux"}], {bar: "foo", baz: "quux"})
    })
    it('evaluates unquoted code', async () => {
      await eval({foo: 1}, [true, [false, "foo"]], 1)
      await eval({foo: 1}, [true, [[false, "foo"], "foo"]], [1, "foo"])
      await eval({foo: 1, bar: 2}, [true, [[false, "foo"], [false, "bar"]]], [1, 2])
      await eval({foo: 1, bar: 2}, [true, {a: [false, "foo"], b: [false, "bar"], c: 3}],
                                   {a: 1, b: 2, c: 3})
    })
    it('merges lists with [false]/~@', async () => {
      await eval({foo: 1}, [true, [1, 2, [[false], [null, [3, 4]]]]], [1, 2, 3, 4])
    })
    it('can nest', async () => {
      await eval({foo: 1}, [true, [false, [true, "foo"]]], "foo")
      await eval({foo: 1}, [true, [false, [true, [false, "foo"]]]], 1)
      await eval({foo: 1}, [true, [true, [false, "foo"]]], [true, [false, "foo"]])
    })
  })
  describe('supports builtin function', () => {
    it('⚙if', async () => {
      await eval({}, ["⚙if", true, 1, 2], 1)
      await eval({}, ["⚙if", false, 1, 2], 2)
    })
    it('⚙macroget', () =>
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
    })
    it('⚙copyScope', () =>
      eval({a:1, b: 2}, ["⚙copyScope"], {"⚙scope": {a: 1, b: 2}, "⚙macros": {}}))
    it('⚙closure', async () => {
      await eval({a:1, b: 2}, ["⚙closure", {}, ["+", 1, 2]], {"⚙scope": {a: 1, b: 2}, "⚙macros": {}, "fn": ["+", 1, 2]})
      const cl1 = await i.jasprEval({scope: {a: 1, b: 2}, macroscope: {}},  ["⚙closure", {a: 3}])
      const sc1 = Promise.resolve(cl1["⚙scope"])
      await expect(sc1.then(s => s.a)).to.become(3)
      await expect(sc1.then(s => s.b)).to.become(2)
      const cl2 = await i.jasprEval({scope: {a: 1, b: 2}, macroscope: {}},  ["⚙closure", {c: 3}])
      const sc2 = Promise.resolve(cl2["⚙scope"])
      await expect(sc2.then(s => s.a)).to.become(1)
      await expect(sc2.then(s => s.b)).to.become(2)
      await expect(sc2.then(s => s.c)).to.become(3)
    })
    it('⚙equals', async () => {
      await eval({}, ["⚙equals", 0, 0], true)
      await eval({}, ["⚙equals", 0, 1], false)
      await eval({}, ["⚙equals", 0, null], false)
    })
    it('⚙add', () => eval({}, ["⚙add", 2, 3], 5))
    it('⚙subtract', () => eval({}, ["⚙subtract", 2, 3], -1))
    it('⚙multiply', () => eval({}, ["⚙multiply", 2, 3], 6))
    it('⚙divide', () => eval({}, ["⚙divide", 6, 2], 3))
    it('⚙modulus', () => eval({}, ["⚙modulus", 5, 2], 1))
    it('⚙negate', () => eval({}, ["⚙negate", 5], -5))
    it('⚙toString', () => eval({}, ["⚙toString", 91], "91"))
    it('⚙objectMerge', () =>
      eval({}, ["⚙objectMerge", {a: 1, b: 2}, {b: 3, c: 4}], {a: 1, b: 3, c: 4}))
  })
  it('can call a function from the scope', () => eval({add1}, ["add1", 2], 3))
})

describe('macroexpand', () => {
  function expand(macroscope, from, to) {
    return expect(i.macroExpand(macroscope, from)).to.become(to)
  }
  it('does not expand scalar values', async () => {
    await expand({}, null, null)
    await expand({}, true, true)
    await expand({}, false, false)
    await expand({}, 0, 0)
    await expand({}, 91, 91)
    await expand({}, "", "")
    await expand({}, "0", "0")
    await expand({}, "foo", "foo")
    await expand({}, [], [])
    await expand({}, {}, {})
  })
  it('does not expand non-macro calls', async () => {
    await expand({},     ["foo", "bar"], ["foo", "bar"])
    await expand({add1}, ["foo", "bar"], ["foo", "bar"])
    await expand({},     [0, "bar"],     [0, "bar"])
    await expand({add1}, [0, "bar"],     [0, "bar"])
  })
  it('expands macro calls from the scope', () => expand({add1}, ["add1", 2], 3))
  it('recursively expands', () => expand({add1, macro_add1}, ["macro_add1", 2], 3))
  it('does not expand quoted code', () =>
    expand({add1}, [null, ["add1", 2]], [null, ["add1", 2]]))
  it('does not expand syntax-quoted code', () =>
    expand({add1}, [true, ["add1", 2]], [true, ["add1", 2]]))
  it('expands inside unquotes', () =>
    expand({add1}, [true, [false, ["add1", 2]]], [true, [false, 3]]))
  it('handles nested syntax-quotes', async () => {
    await expand({add1}, [true, [false, [true, [false, ["add1", 2]]]]],
                         [true, [false, [true, [false, 3]]]])
    await expand({add1}, [true, [true, [false, ["add1", 2]]]],
                         [true, [true, [false, ["add1", 2]]]])
  })
})

const letScope = {
  "macro.let": ["⚙closure", {}, [true, [["⚙closure", [[false], "⚙args"]]]]]
}

const fnScope = _.merge(letScope, {
  "macro.fn*": ["⚙closure", {},
    [true, ["⚙closure", {}, ["let", {"args": "⚙args"}, [false, [0, "⚙args"]]]]]]
})

describe('evalModule', () => {
  function eval(scopes, from, to) {
    return expect(
      i.macroExpand(scopes.macroscope, from)
       .then(expanded => i.jasprEval(scopes, expanded))
       .then(deepResolve)).to.become(to)
  }
  it('evaluates literal variables', async () => {
    const {scope} = i.evalModule({
      module: 'test',
      export: ['a', 'b'],
      defs: {a: 1, b: 2}
    })
    await expect(scope.a).to.become(1)
    await expect(scope.b).to.become(2)
  })
  it('evaluates simple code w/o a scope', async () => {
    const {scope} = i.evalModule({
      module: 'test',
      export: ['a', 'b'],
      defs: {a: [null, "foo"], b: ["⚙add", 1, 2]}
    })
    await expect(scope.a).to.become("foo")
    await expect(scope.b).to.become(3)
  })
  it('evaluates variables in the scope', async () => {
    const {scope} = i.evalModule({
      module: 'test',
      export: ['a', 'b', 'c'],
      defs: {a: 1, b: "a", c: "b"}
    })
    await expect(scope.a).to.become(1)
    await expect(scope.b).to.become(1)
    await expect(scope.c).to.become(1)
  })
  it('evaluates functions in the scope', async () => {
    const {scope} = i.evalModule({
      module: 'test',
      export: ['a', 'b'],
      defs: {add1: [null, add1], a: ["add1", 2], b: ["add1", 3]}
    })
    await expect(scope.a).to.become(3)
    await expect(scope.b).to.become(4)
  })
  it('evaluates macros in the scope', async () => {
    const {scope} = i.evalModule({
      module: 'test',
      export: ['a', 'b'],
      defs: {a: ["add1", 2], b: ["add1", 3], "macro.add1": [null, add1]}
    })
    await expect(scope.a).to.become(3)
    await expect(scope.b).to.become(4)
  })
  it('can define "let"', async () => {
    const s = i.evalModule({module: 'test', export: ['let', 'closure'], defs: letScope})
    await eval(s, ["let", {a: 1}, "a"], 1)
    await eval(s, ["let", {a: 1}, ["let", {b: 2}, "b"]], 2)
    await eval(s, ["let", {a: 1}, ["let", {a: 2}, "a"]], 2)
    await eval(s, ["let", {a: 1, b: 3}, ["let", {a: 2}, "b"]], 3)
    await eval(s, ["let", {a: ["let", {b: 2}, "b"]}, "a"], 2)
  })
  it('can use "let" from another scope member', async () => {
    const {scope} = i.evalModule({
      module: 'test',
      export: ['a'],
      defs: _.merge(letScope, {a: ["let", {b: 1}, "b"]})
    })
    await expect(scope.a).to.become(1)
  })
  it('can define "fn*"', async () => {
    const {macroscope} = await i.evalModule({module: 'test', export: ['fn*'], defs: fnScope})
    await expect(macroscope["fn*"]).to.be.fulfilled
  })
  it('can define a macro with "fn*"', async () => {
    const {macroscope} = i.evalModule({
      module: 'test',
      export: ['add1'],
      defs: _.merge(fnScope, {"macro.add1": ["fn*", ["⚙add", 1, [0, "args"]]]})
    })
    await expect(macroscope.add1).to.be.fulfilled
    await expect(i.isClosure(await macroscope.add1)).to.be.true
  })
  it('can use a "fn*"-defined macro in the scope', async () => {
    const {scope} = i.evalModule({
      module: 'test',
      export: ['a'],
      defs: _.merge(fnScope, {"macro.add1": ["fn*", ["⚙add", 1, [0, "args"]]], a: ["add1", 2]})
    })
    await expect(scope.a).to.become(3)
  })
})
