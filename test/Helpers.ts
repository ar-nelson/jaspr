import {
  Jaspr, JasprArray, JasprObject, Callback, resolveFully, toString,
  Deferred, JsonObject, Err
} from '../src/Jaspr'
import {
  Env, Action, Scope, emptyScope, raise, evalExpr, macroExpand, evalDefs,
  deferExpandEval, waitFor
} from '../src/Interpreter'
import Fiber from '../src/Fiber'
import newPrimitiveModule from '../src/JasprPrimitive'
import prettyPrint from '../src/PrettyPrint'
import {NativeFn} from '../src/NativeFn'
import {importModule} from '../src/Module'
import * as _ from 'lodash'
import * as assert from 'assert'
import {expect} from 'chai'
require('source-map-support').install({
  handleUncaughtExceptions: false
})

export interface Should<CB> {
  equal(value: Jaspr): CB
  pass<T extends Jaspr>(assertions: (result: T, done?: () => void) => void): CB
}

export class TestCase implements Should<Callback> {
  promises: PromiseLike<any>[] = []
  readonly env: Env

  constructor(env: Env) {
    this.env = env
  }

  pushPromise(): () => {resolve: () => void, reject: (err: any) => void} {
    let resolve: any = null, reject: any = null
    this.promises.push(new Promise<void>((resolve_, reject_) => {
      resolve = resolve_; reject = reject_
    }))
    return () => {
      if (resolve == null || reject == null) {
        console.error(
          'Promise resolve/reject not available. This should never happen!')
        process.exit(1)
      }
      return {resolve, reject}
    }
  } 

  equal(value: Jaspr): Callback {
    const resolvers = this.pushPromise()
    return result => resolveFully(result, (err, result) => {
      const {resolve, reject} = resolvers()
      try { expect(result).to.deep.equal(value) }
      catch (err) { reject(err); return }
      resolve()
    })
  }

  pass<T extends Jaspr>(assertions: (result: T, done: () => void) => void): Callback {
    const resolvers = this.pushPromise()
    return result => resolveFully(result, (err, result) => {
      const {resolve, reject} = resolvers()
      try {
        if (assertions.length <= 1) {
          assertions(<T>result, <any>null)
          resolve()
        } else assertions(<T>result, resolve)
      } catch (err) { reject(err) }
    })
  }

  raise(errType: Err, fn: (env: Env, cb: Callback) => void): void {
    const resolvers = this.pushPromise()
    const handler = new NativeFn(function(err) {
      const {resolve, reject} = resolvers()
      try {
        expect(err).to.be.an('object')
        expect(err).to.have.property('err').equal(errType, 'wrong error type')
      } catch (err) {reject(err)}
      resolve()
      return null
    })
    this.env.defer({
      fn, dynamics: [[this.env.signalHandlerVar, handler.toClosure(this.env)]]
    }).await(v => resolvers().reject(new assert.AssertionError({
      message: 'no error was raised',
      actual: v,
      expected: {err: errType}
    })))
  }

  get withoutError(): Should<AsyncResultCallback<Jaspr, any>> {
    const should = this
    return {
      equal(value: Jaspr) {
        const resolvers = should.pushPromise(), cb = should.equal(value)
        return (err, result) => {
          const {resolve, reject} = resolvers()
          if (err) return reject(err)
          cb(<Jaspr>result)
          resolve()
        }
      },
      pass<T extends Jaspr>(assertions: (result: T, done?: () => void) => void) {
        const resolvers = should.pushPromise(), cb = should.pass(assertions)
        return (err, result) => {
          const {resolve, reject} = resolvers()
          if (err) return reject(err)
          cb(<Jaspr>result)
          resolve()
        }
      }
    }
  }
}

export const withEnv = (body: (env: Env, should: TestCase) => void) => () =>
  new Promise<void>((resolve, reject) => {
    let errored = false
    const root = Fiber.newRoot((root, err, raisedBy, cb) => {
      if (errored) return cb(null)
      errored = true
      reject(new assert.AssertionError({
        message: `
Unhandled signal raised:
${prettyPrint(err, false)}

Stack trace:
${raisedBy.stackTraceString(false)}`
      }))
      root.cancel()
    })
    const testCase = new TestCase(root)
    body(root, testCase)
    expect(testCase.promises).to.not.be.empty
    Promise.all(testCase.promises).then(() => resolve(), reject)
  })
