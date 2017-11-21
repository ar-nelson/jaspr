import {withEnv} from './Helpers'
import {
  Jaspr, JasprObject,  JsonObject, resolveFully, Deferred
} from '../src/Jaspr'
import {
  Env, Scope, emptyScope, makeDynamic, isClosure, evalExpr, macroExpand,
  evalDefs, deferExpandEval
} from '../src/Interpreter'
import * as Names from '../src/ReservedNames'
import {NativeFn} from '../src/NativeFn'
import * as _ from 'lodash'
import {expect} from 'chai'

const sq = Names.syntaxQuote, uq = Names.unquote, uqs = Names.unquoteSplicing

function values(value: JasprObject): Scope {
  return _.create(emptyScope, {value})
}
function macros(macro: JasprObject): Scope {
  return _.create(emptyScope, {macro})
}
function closure(env: Env, code: Jaspr, scope: JasprObject = {}): JasprObject {
  return {
    [env.closureName]: scope,
    [Names.code]: code
  }
}
const add1 = (env: Env) => ({
  add1: new NativeFn(function(n) { return 1 + (+<any>n) }).toClosure(env)
})
const macroAdd1 = (env: Env) =>
  ({macroAdd1: closure(env, [[], ['', 'add1'], [0, Names.args]])})
const macroArrayAdd1 = (env: Env) => ({
  macroArrayAdd1: closure(env,
    [[], [], [[], ['', 'add1'], [0, Names.args]], [[], ['', 'add1'], [1, Names.args]]])
})
const dyn = makeDynamic(false)

describe('eval', () => {
  it('evaluates null, booleans, numbers, and empty structures as themselves',
    withEnv((env, should) => {
      evalExpr(env, emptyScope, null, should.equal(null))
      evalExpr(env, emptyScope, true, should.equal(true))
      evalExpr(env, emptyScope, false, should.equal(false))
      evalExpr(env, emptyScope, 0, should.equal(0))
      evalExpr(env, emptyScope, 91, should.equal(91))
      evalExpr(env, emptyScope, '', should.equal(''))
      evalExpr(env, emptyScope, [], should.equal([]))
      evalExpr(env, emptyScope, {}, should.equal({}))
    }))
  it('resolves strings as variables', withEnv((env, should) => {
    evalExpr(env, values({foo: 1}), 'foo', should.equal(1))
    evalExpr(env, values({foo: 'bar'}), 'foo', should.equal('bar'))
    evalExpr(env, values({foo: 'foo'}), 'foo', should.equal('foo'))
    evalExpr(env, values({foo: ['foo', 'bar']}), 'foo', should.equal(['foo', 'bar']))
    evalExpr(env, values({bar: ['foo', 'bar']}), 'bar', should.equal(['foo', 'bar']))
    evalExpr(env, values({a: 1, b: 2, c: 3}), 'b', should.equal(2))
  }))
  it('raises NoBinding when variable cannot be resolved', withEnv((env, should) =>
    should.raise('NoBinding', (env, cb) =>
      evalExpr(env, emptyScope, 'foo', cb))))
  it('does not evaluate quoted code', withEnv((env, should) => {
    evalExpr(env, emptyScope, ['', 1], should.equal(1))
    evalExpr(env, emptyScope, ['', 'foo'], should.equal('foo'))
    evalExpr(env, emptyScope, ['', ['', 'foo']], should.equal(['', 'foo']))
    evalExpr(env, emptyScope, ['', [sq, 'foo']], should.equal([sq, 'foo']))
    evalExpr(env, values({foo: 'bar'}), ['', 'foo'], should.equal('foo'))
    evalExpr(env, values({foo: 'bar'}), ['', ['foo', 'bar', 'baz']],
      should.equal(['foo', 'bar', 'baz']))
    evalExpr(env, values({foo: 'bar'}), ['', {bar: 'foo', baz: 'quux'}],
      should.equal({bar: 'foo', baz: 'quux'}))
  }))
  it('indexes into arrays by calling numbers as functions', withEnv((env, should) => {
    evalExpr(env, emptyScope, [0, ['', ['foo', 'bar']]], should.equal('foo'))
    evalExpr(env, emptyScope, [1, ['', ['foo', 'bar']]], should.equal('bar'))
    should.raise('NoKey', (env, cb) =>
      evalExpr(env, emptyScope, [2, ['', ['foo', 'bar']]], cb))
  }))
  it('supports negative array indices', withEnv((env, should) => {
    evalExpr(env, emptyScope, [-1, ['', ['foo', 'bar']]], should.equal('bar'))
    evalExpr(env, emptyScope, [-2, ['', ['foo', 'bar']]], should.equal('foo'))
  }))
  it('indexes into objects by calling strings as functions', withEnv((env, should) => {
    evalExpr(env, emptyScope, [['', 'a'], {a: 1, b: 2}], should.equal(1))
    evalExpr(env, emptyScope, [['', 'b'], {a: 1, b: 2}], should.equal(2))
    should.raise('NoKey', (env, cb) =>
      evalExpr(env, emptyScope, [['', 'c'], {a: 1, b: 2}], cb))
  }))
  it('does not leak JavaScript properties via object indexing', withEnv((env, should) => {
    should.raise('BadArgs', (env, cb) =>
      evalExpr(env, emptyScope, [['', 'length'], ['', 'foo']], cb))
    should.raise('BadArgs', (env, cb) =>
      evalExpr(env, emptyScope, [['', 'length'], ['', [1, 2]]], cb))
    should.raise('NoKey', (env, cb) =>
      evalExpr(env, emptyScope, [['', 'hasOwnProperty'], {a: 1, b: 2}], cb))
  }))
  describe('closure', () => {
    it('can be called inline', withEnv((env, should) =>
      evalExpr(env, emptyScope, [['', closure(env, 91)]], should.equal(91))))
    it('loads its own scope', withEnv((env, should) =>
      evalExpr(env, emptyScope, [['', closure(env, 'foo', values({foo: 1}))]],
        should.equal(1))))
    it('replaces the callsite scope', withEnv((env, should) =>
      evalExpr(env, values({foo: 1}), [['', closure(env, 'foo', values({foo: 2}))]],
        should.equal(2))))
    it('cannot access the callsite scope', withEnv((env, should) =>
      should.raise('NoBinding', (env, cb) =>
        evalExpr(env, values({foo: 1}), [['', closure(env, 'foo')]], cb))))
    it('stores arguments array in $args', withEnv((env, should) =>
      evalExpr(env, emptyScope, [['', closure(env, [1, '$args'])],
                                 ['', 'foo'],
                                 ['', 'bar'],
                                 ['', 'baz']], should.equal('bar'))))
  })
  describe('supports magic form', () => {
    it('$if', withEnv((env, should) => {
      evalExpr(env, emptyScope, ['$if', true, 1, 2], should.equal(1))
      evalExpr(env, emptyScope, ['$if', false, 1, 2], should.equal(2))
    }))
    it('$closure', withEnv((env, should) => {
      evalExpr(env, values({a:1, b: 2}), ['$closure', {}, ['+', 1, 2], {}],
        should.pass(cl => {
          expect(cl).to.be.an('object')
          expect(cl).to.have.property(env.closureName).be.an('object')
          expect(cl).to.have.property(Names.code).deep.equal(['+', 1, 2])
          const sc = (<any>cl)[env.closureName]
          expect(sc).to.have.property('value').be.an('object')
          expect(sc.value).to.have.property('a').equal(1)
          expect(sc.value).to.have.property('b').equal(2)
        }))
      evalExpr(env, values({a: 1, b: 2}), ['$closure', {c: 3}, null, {}],
        should.pass(cl => {
          const sc = (<any>cl)[env.closureName]
          expect(sc).to.be.an('object')
          expect(sc).to.have.property('value').be.an('object')
          expect(sc.value).to.have.property('a').equal(1)
          expect(sc.value).to.have.property('b').equal(2)
          expect(sc.value).to.have.property('c') // won't be resolved...
        }))
      evalExpr(env, values({a: 1, b: 2}), ['$closure', {a: 3}, null, {}],
        should.pass(cl => {
          const sc = (<any>cl)[env.closureName]
          expect(sc).to.be.an('object')
          expect(sc).to.have.property('value').be.an('object')
          expect(sc.value).to.have.property('a').not.equal(1) // won't be resolved...
          expect(sc.value).to.have.property('b').equal(2)
          expect(sc.value).to.not.have.property('c')
        }))
      }))
    it('$dynamicLet', withEnv((env, should) => {
      const scope = values({dynamicGet: new NativeFn(function dynamicGet(dyn) {
        return this.defer((env, cb) => this.getDynamic(<any>dyn, cb))
      }).toClosure(env)})
      evalExpr(env, scope, ['dynamicGet', ['', dyn]], should.equal(false))
      evalExpr(env, scope,
            ['$dynamicLet', ['', dyn], true, ['dynamicGet', ['', dyn]]],
          should.equal(true))
      evalExpr(env, values({get: closure(env, ['dynamicGet', [0, '$args']], scope)}),
        ['$dynamicLet', ['', dyn], true, ['get', ['', dyn]]],
        should.equal(true))
    }))
  })
  it('can call a function from the scope', withEnv((env, should) =>
    evalExpr(env, values(add1(env)), ['add1', 2], should.equal(3))))
  it('can call multiple functions inside arrays', withEnv((env, should) =>
    evalExpr(env, values(add1(env)), [[], ['add1', 1], ['add1', 2], 4],
      should.equal([2, 3, 4]))))
  it('can call multiple functions inside objects', withEnv((env, should) =>
    evalExpr(env, values(add1(env)), {a: ['add1', 1], b: ['add1', 2], c: 4},
      should.equal({a: 2, b: 3, c: 4}))))
})

describe('macroexpand', () => {
  it('does not expand scalar values', withEnv((env, should) => {
    macroExpand(env, emptyScope, null, should.equal(null))
    macroExpand(env, emptyScope, true, should.equal(true))
    macroExpand(env, emptyScope, false, should.equal(false))
    macroExpand(env, emptyScope, '', should.equal(''))
    macroExpand(env, emptyScope, 'foo', should.equal('foo'))
    macroExpand(env, macros({foo: 1}), 'foo', should.equal('foo'))
    macroExpand(env, emptyScope, 0, should.equal(0))
    macroExpand(env, emptyScope, 91, should.equal(91))
    macroExpand(env, emptyScope, [], should.equal([]))
    macroExpand(env, emptyScope, {}, should.equal({}))
  }))
  it('does not expand non-macro calls', withEnv((env, should) => {
    macroExpand(env, emptyScope, ['foo', 'bar'], should.equal(['foo', 'bar']))
    macroExpand(env, macros(add1(env)), ['foo', 'bar'], should.equal(['foo', 'bar']))
    macroExpand(env, emptyScope, [0, 'bar'], should.equal([0, 'bar']))
    macroExpand(env, macros(add1(env)), [0, 'bar'], should.equal([0, 'bar']))
  }))
  it('expands macro calls from the scope', withEnv((env, should) =>
    macroExpand(env, macros(add1(env)), ['add1', 2], should.equal(3))))
  it('recursively expands', withEnv((env, should) =>
    macroExpand(env, macros(_.assign(add1(env), macroAdd1(env))), ['macroAdd1', 2],
      should.equal(3))))
  it('does not expand quoted code', withEnv((env, should) =>
    macroExpand(env, macros(add1(env)), ['', ['add1', 2]],
      should.equal(['', ['add1', 2]]))))
  it('expands arguments to []', withEnv((env, should) =>
    macroExpand(env, macros(add1(env)), [[], ['add1', 1], ['add1', 2]],
      should.equal([[], 2, 3]))))
  it('expands arguments to non-macro call', withEnv((env, should) =>
    macroExpand(env, macros(add1(env)), ['foo', ['add1', 1], ['add1', 2]],
      should.equal(['foo', 2, 3]))))
  it('recursively expands arguments', withEnv((env, should) =>
    macroExpand(env, macros(_.assign(add1(env), macroArrayAdd1(env))),
      ['macroArrayAdd1', 1, 2], should.equal([[], 2, 3]))))
  describe('syntax-quote', () => {
    it('becomes a normal quote macro when there are no unquotes',
      withEnv((env, should) => {
        macroExpand(env, emptyScope, [sq, 1], should.equal(1))
        macroExpand(env, emptyScope, [sq, 'foo'], should.equal(['', 'foo']))
        macroExpand(env, emptyScope, [sq, ['', 'foo']],
          should.equal(['', ['', 'foo']]))
        macroExpand(env, emptyScope, [sq, [sq, 'foo']],
          should.equal(['', [sq, 'foo']]))
        macroExpand(env, macros(add1(env)), [sq, 'add1'],
          should.equal(['', 'add1']))
        macroExpand(env, macros(add1(env)), [sq, ['add1', 0]],
          should.equal([[], ['', 'add1'], 0]))
      }))
    it('cancels out `~', withEnv((env, should) =>
      macroExpand(env, emptyScope, [sq, [uq, 'foo']], should.equal('foo'))))
    it('expands macros inside `~', withEnv((env, should) =>
      macroExpand(env, macros(add1(env)), [sq, [uq, ['add1', 1]]], should.equal(2))))
    it('uses [] to join unquotes', withEnv((env, should) => {
      macroExpand(env, emptyScope, [sq, [[uq, 'a'], 'b']],
        should.equal([[], 'a', ['', 'b']]))
      macroExpand(env, emptyScope, [sq, [[uq, ['a', 'b']], [[uq, 'c'], 'd']]],
        should.equal([[], ['a', 'b'], [[], 'c', ['', 'd']]]))
    }))
    it('expands macros inside unquotes', withEnv((env, should) =>
      macroExpand(env, macros(add1(env)), [sq, ['a', [uq, ['add1', 1]], 'b']],
        should.equal([[], ['', 'a'], 2, ['', 'b']]))))
    it('uses arrayConcat to join $unquoteSplicing/~@', withEnv((env, should) =>
      macroExpand(env, emptyScope, [sq, [1, 2, [uqs, ['', [3, 4]]]]],
        should.equal([Names.arrayConcatQualified, [[], 1, 2], ['', [3, 4]]]))))
    it('can nest', withEnv((env, should) => {
      macroExpand(env, macros({foo: 1}), [sq, [uq, [sq, 'foo']]],
        should.equal(['', 'foo']))
      macroExpand(env, macros({foo: 1}), [sq, [uq, [sq, [uq, 'foo']]]],
        should.equal('foo'))
      macroExpand(env, macros({foo: 1}), [sq, [sq, [uq, 'foo']]],
        should.equal(['', [sq, [uq, 'foo']]]))
    }))
    it('qualifies names', withEnv((env, should) => {
      macroExpand(env,
        _.create(emptyScope, {value: {foo: 1}, qualified: {foo: 'baz.bar.foo@'}}),
        [sq, 'foo'],
        should.equal(['', 'baz.bar.foo@']))
      macroExpand(env,
        _.create(emptyScope, {
          value: {foo: 1, bar: 2, baz: 3},
          qualified: {foo: 'quux.foo@', bar: 'quux.bar@'}
        }),
        [sq, ['foo', 'bar', 'baz']],
        should.equal([[], ['', 'quux.foo@'], ['', 'quux.bar@'], ['', 'baz']]))
    }))
    it('does not qualify quoted names', withEnv((env, should) => {
      macroExpand(env,
        _.create(emptyScope, {
          value: {foo: 1, bar: 2, baz: 3},
          qualified: {foo: 'quux.foo@', bar: 'quux.bar@'}
        }),
        [sq, ['foo', ['', 'bar'], 'baz']],
        should.equal([[], ['', 'quux.foo@'], ['', ['', 'bar']], ['', 'baz']]))
    }))
    it('replaces .name.s with gensyms', withEnv((env, should) => {
      macroExpand(env, emptyScope, [sq, '.x.'], should.pass((val: Jaspr[]) => {
        expect(val).to.be.an('array')
        expect(val).to.have.length(2)
        expect(val[0]).to.equal('')
        expect(val[1]).to.be.a('string').and.not.equal('.x.')
      }))
      macroExpand(env, emptyScope, [sq, ['.x.', '.y.', '.x.']],
        should.pass(([[], [q1, x1], [q2, y], [q3, x2]]: Jaspr[][]) => {
          expect(q1).to.equal('').and.equal(q2).and.equal(q3)
          expect(x1).to.be.a('string').and.not.equal('.x.')
          expect(x2).to.equal(x1)
          expect(y).to.be.a('string').and.not.equal('.y.').and.not.equal(x1)
        }))
      macroExpand(env, emptyScope, [[sq, '.x.'], [sq, '.x.']],
        should.pass(([[q1, x1], [q2, x2]]: Jaspr[][]) => {
          expect(q1).to.equal('')
          expect(q2).to.equal('')
          expect(x1).to.be.a('string').and.not.equal('.x.')
          expect(x2).to.be.a('string').and.not.equal('.x.').and.not.equal(x1)
        }))
      macroExpand(env, emptyScope, [sq, {'.x.': '.x.'}],
        should.pass((obj: JasprObject) => {
          expect(obj).to.be.an('object')
          expect(Object.keys(obj)).to.have.length(1)
          const x = Object.keys(obj)[0]
          expect(x).to.not.equal('.x.')
          expect(obj[x]).to.deep.equal(['', x])
        }))
      }))
    it('can compile a piece of standard library code', withEnv((env, should) =>
      macroExpand(env, _.create(emptyScope, {
        qualified: {
          'p.if': 'jaspr.primitive.if@',
          'p.arraySlice': 'jaspr.primitive.arraySlice@',
          'p.arrayLength': 'jaspr.primitive.arrayLength@',
          'p.dynamicGet': 'jaspr.primitive.dynamicGet@',
          assertArgs: 'jaspr.assertArgs@',
          debugArgs: 'jaspr.debugArgs@',
          myName: 'jaspr.myName@',
          raise: 'jaspr.raise@'
        }
      }), [sq, ['p.if', [uq, [0, '$args']],
            ['assertArgs', [uqs, ['p.arraySlice', 2, ['p.arrayLength', '$args'], '$args']]],
            ['raise', {
              err: ['', 'BadArgs'], why: [uq, [1, '$args']], fn: ['myName'],
              args: ['p.dynamicGet', 'debugArgs']
            }]]],
        should.equal(
          [[], ['', 'jaspr.primitive.if@'], [0, '$args'],
              [Names.arrayConcatQualified,
                  [[], ['', 'jaspr.assertArgs@']],
                  ['p.arraySlice', 2, ['p.arrayLength', '$args'], '$args']],
              [[], ['', 'jaspr.raise@'], {
                err: ['', ['', 'BadArgs']],
                why: [1, '$args'],
                fn: [[], ['', 'jaspr.myName@']],
                args: [[], ['', 'jaspr.primitive.dynamicGet@'], ['', 'jaspr.debugArgs@']]
              }]]))))
  })
})

const letDefs = {
  'macro.let': ['$closure', {},
    [sq, [['$closure', [uq, [0, '$args']], [uq, [1, '$args']], {}]]], {}]
}

const fnDefs = _.assign({}, letDefs, {
  'macro.fn*': ['$closure', {},
    [sq, ['$closure', {}, ['let', {args: '$args'}, [uq, [0, '$args']]], {}]], {}]
})

describe('evalDefs', () => {
  it('evaluates literal variables', withEnv((env, should) =>
    evalDefs(env, null, emptyScope, {a: 1, b: 2},
      should.withoutError.pass((scope: Scope) => {
        expect(scope.value).to.have.property('a').equal(1)
        expect(scope.value).to.have.property('b').equal(2)
      }))))
  it('evaluates simple code w/o a scope', withEnv((env, should) =>
    evalDefs(env, null, emptyScope, {a: ['', 'foo'], b: [[], 1, 2]},
      should.withoutError.pass((scope: Scope) => {
        expect(scope.value).to.have.property('a').equal('foo')
        expect(scope.value).to.have.property('b').deep.equal([1, 2])
      }))))
  it('evaluates variables in the scope', withEnv((env, should) =>
    evalDefs(env, null, emptyScope, {a: 1, b: 'a', c: 'b'},
      should.withoutError.pass((scope: Scope) => {
        expect(scope.value).to.have.property('a').equal(1)
        expect(scope.value).to.have.property('b').equal(1)
        expect(scope.value).to.have.property('c').equal(1)
      }))))
  it('evaluates functions in the scope', withEnv((env, should) =>
    evalDefs(env, null, emptyScope,
      {add1: ['', add1(env).add1], a: ['add1', 2], b: ['add1', 3]},
      should.withoutError.pass((scope: Scope) => {
        expect(scope.value).to.have.property('a').equal(3)
        expect(scope.value).to.have.property('b').equal(4)
      }))))
  it('evaluates functions in the parent scope', withEnv((env, should) =>
    evalDefs(env, null, values(add1(env)), {a: ['add1', 2], b: ['add1', 3]},
      should.withoutError.pass((scope: Scope) => {
        expect(scope.value).to.have.property('a').equal(3)
        expect(scope.value).to.have.property('b').equal(4)
      }))))
  it('evaluates macros in the scope', withEnv((env, should) =>
    evalDefs(env, null, emptyScope,
      {'macro.add1': ['', add1(env).add1], a: ['add1', 2], b: ['add1', 3]},
      should.withoutError.pass((scope: Scope) => {
        expect(scope.value).to.have.property('a').equal(3)
        expect(scope.value).to.have.property('b').equal(4)
      }))))
  it('can define "let"', withEnv((env, should) =>
    evalDefs(env, null, emptyScope, letDefs,
      should.withoutError.pass((scope: Scope) => {
        deferExpandEval(env, scope, ['let', {a: 1}, 'a'])
          .await(should.equal(1))
        deferExpandEval(env, scope, ['let', {a: 1}, ['let', {b: 2}, 'b']])
          .await(should.equal(2))
        deferExpandEval(env, scope, ['let', {a: 1}, ['let', {a: 2}, 'a']])
          .await(should.equal(2))
        deferExpandEval(env, scope, ['let', {a: 1, b: 3}, ['let', {a: 2}, 'b']])
          .await(should.equal(3))
        deferExpandEval(env, scope, ['let', {a: ['let', {b: 2}, 'b']}, 'a'])
          .await(should.equal(2))
      }))))
  it('can use "let" from another scope member', withEnv((env, should) =>
    evalDefs(env, null, emptyScope,
      _.assign({a: ['let', {b: 1}, 'b']}, letDefs),
      should.withoutError.pass((scope: Scope) => {
        expect(scope.value).to.have.property('a').equal(1)
        expect(scope.value).to.not.have.property('b')
      }))))
  it('can define "fn*"', withEnv((env, should) =>
    evalDefs(env, null, emptyScope, fnDefs,
      should.withoutError.pass((scope: Scope) => {
        expect(scope.macro).to.have.property('fn*').not.be.an.instanceOf(Deferred)
        expect(isClosure(env, <Jaspr>scope.macro['fn*'])).to.be.true
      }))))
  it('can define a macro with "fn*"', withEnv((env, should) =>
    evalDefs(env, null, values(add1(env)),
      _.assign({'macro.mAdd1': ['fn*', ['add1', [0, 'args']]]}, fnDefs),
      should.withoutError.pass((scope: Scope) => {
        expect(scope.macro).to.have.property('mAdd1').not.be.an.instanceOf(Deferred)
        expect(isClosure(env, <Jaspr>scope.macro.mAdd1)).to.be.true
      }))))
  it('can use a "fn*"-defined macro in the scope', withEnv((env, should) =>
    evalDefs(env, null, values(add1(env)),
      _.assign({'macro.mAdd1': ['fn*', ['add1', [0, 'args']]], a: ['mAdd1', 2]}, fnDefs),
      should.withoutError.pass((scope: Scope) => {
        expect(scope.value).to.have.property('a').equal(3)
      }))))
})
