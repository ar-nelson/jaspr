import {
  Jaspr, JasprArray, JasprObject, Scope, Callback, resolveFully, toString,
  Deferred, JsonObject, emptyScope
} from '../src/Jaspr'
import Fiber from '../src/Fiber'
//import {currentSchema, evalModule} from '../src/Module'
import {
  Env, Action, raise, evalExpr, macroExpand, evalDefs, deferExpandEval
} from '../src/Interpreter'
import * as _ from 'lodash'
import * as assert from 'assert'
import {expect as chaiExpect} from 'chai'
require('source-map-support').install({
  handleUncaughtExceptions: false
})

function waitFor(v: Jaspr | Deferred, cb: Callback): void {
  if (v instanceof Deferred) v.await(cb)
  else cb(v)
}

export type TestCallback = (err: Jaspr, result: Jaspr) => void
export type TestCase = (done: () => void, name?: string) => void

export class Expect {
  fn: (cb: TestCallback) => void
  constructor(fn: (cb: TestCallback) => void) {
    this.fn = fn
  }

  toEqual(value: Jaspr): TestCase {
    return (done, name?) => this.fn((err, result) => {
      if (err == null) {
        if (name) {
          try { chaiExpect(result).to.deep.equal(value) }
          catch (e) {
            e.message = `(in "${name}"): ${e.message}`
            throw e
          }
        } else chaiExpect(value).to.deep.equal(value)
      } else {
        assert(false, (name ? `(in "${name}"): ` : '') + toString(err))
      }
      done()
    })
  }

  toThrow(predicate: (err: Jaspr) => boolean = () => true): TestCase {
    return (done, name?) => this.fn((err, result) => {
      if (err === null) {
        assert(false,
          `${name ? name + ': ' : ''}Expected error, got result ${toString(result)}`)
      } else {
        assert(predicate(err),
          `${name ? name + ': ' : ''}Expected error, but got the wrong kind: ${toString(err)}`)
      }
      done()
    })
  }

  toPass(assertions: (result: Jaspr, done?: () => void) => void): TestCase {
    return (done, name?) => this.fn((err, result) => {
      if (err === null) {
        if (assertions.length > 1) assertions(result, done)
        else {
          assertions(result)
          done()
        }
      } else assert(false, toString(err))
    })
  }
}

function expectContext(fn: (env: Env, cb: Callback) => void): Expect {
  let errCb: TestCallback
  let errored = false
  const root = Fiber.newRoot((root, err, cb) => {
    if (errored) return cb(null)
    errored = true
    resolveFully(err, (re, err) => errCb(err, null))
    // don't cancel; remaining fibers should crash on their own
  })
  return new Expect(cb => {
    errCb = cb
    fn(root, result => resolveFully(result, cb))
  })
}

export const expect = {
  eval(scope: Scope, code: Jaspr): Expect {
    return expectContext((env, cb) => env.defer({
      action: Action.Eval, code,
      fn: (env, cb) => evalExpr(env, scope, code, cb)
    }).await(cb))
  },
  macroExpand(scope: Scope, code: Jaspr): Expect {
    return expectContext((env, cb) => env.defer({
      action: Action.MacroExpand, code,
      fn: (env, cb) => macroExpand(env, scope, code, cb)
    }).await(cb))
  },
  fullEval(scope: Scope, code: Jaspr): Expect {
    return expectContext((env, cb) => deferExpandEval(env, scope, code).await(cb))
  }
}

export function withDefs(
  defs: JsonObject,
  fn: (scope: Scope) => (done: () => void) => void
): TestCase {
  return expectContext((env, cb) =>
    evalDefs(env, undefined, emptyScope, defs, (err, scope) => {
      if (err) raise(env, err, cb)
      else cb(<Jaspr>scope)
    })
  ).toPass(<any>((scope: Scope, done: () => void) => fn(scope)(done)))
}

export function cases(cs: {[name: string]: TestCase}): (done: () => void) => void {
  return done => {
    const iter = (function*(): IterableIterator<void> {
      for (let name in cs) {
        yield cs[name](() => setImmediate(() => iter.next()), name)
      }
      done()
    })()
    iter.next()
  }
}
