import {
  Jaspr, JasprArray, JasprObject, Scope, Callback, resolveFully, toString,
  Deferred, currentSchema
} from '../src/Jaspr'
import Proc from '../src/Proc'
import Interpreter from '../src/Interpreter'
import {Context} from '../src/Interpreter'
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
      if (err === null) {
        if (name) {
          try { chaiExpect(result).to.deep.equal(value) }
          catch (e) {
            e.message = `(in "${name}"): ${e.message}`
            throw e
          }
        } else chaiExpect(value).to.deep.equal(value)
        done()
      } else assert(false, (name ? `(in "${name}"): ` : '') + toString(err))
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
        done()
      }
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

function expectContext(fn: (ctx: Context, cb: Callback) => void): Expect {
  let errCb: TestCallback
  const interpreter = new Interpreter()
  const ctx = interpreter.spawn("test", undefined, (err, cb) => {
    resolveFully(err, (re, err) => errCb(err, null))
    //interpreter.printFibers()
    return false
  })
  return new Expect(cb => {
    errCb = (err, v) => {
      //if (err) interpreter.printFibers()
      cb(err, v)
    }
    fn(ctx, result => resolveFully(result, cb))
  })
}

export const expect = {
  eval(scope: Scope, code: Jaspr): Expect {
    return expectContext((ctx, cb) => waitFor(ctx.eval(scope, code), cb))
  },
  macroExpand(scope: Scope, code: Jaspr): Expect {
    return expectContext((ctx, cb) => waitFor(ctx.macroExpand(scope, code), cb))
  },
  fullEval(scope: Scope, code: Jaspr): Expect {
    return expectContext((ctx, cb) =>
      waitFor(ctx.macroExpand(scope, code), expanded => {
        waitFor(ctx.eval(scope, expanded), cb)
      }))
  }
}

export function withModule(
  module: JasprObject,
  fn: (scope: Scope) => (done: () => void) => void
): TestCase {
  return expectContext((ctx, cb) => ctx.evalModule(
    _.merge({$schema: currentSchema}, module),
    (err, m) => { if (err) throw err; else cb(<any>m)}
  )).toPass(<any>((scope: Scope, done: () => void) => fn(scope)(done)))
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
