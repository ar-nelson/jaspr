import {AssertionError} from 'assert'
import {expect} from 'chai'
import {waterfall} from 'async'
import {Jaspr, JasprError, resolveFully, toString, toBool} from '../src/Jaspr'
import Fiber from '../src/Fiber'
import {ErrorHandler} from '../src/Fiber'
import {Env, deferExpandEval} from '../src/Interpreter'
import {readModuleFile, evalModule, ModuleSource, Module} from '../src/Module'
import newPrimitiveModule from '../src/JasprPrimitive'
import prettyPrint from '../src/PrettyPrint'
import {NativeFn} from '../src/NativeFn'

let stdlib: Promise<Module> | null = null
let root: Env | null

describe('the standard library', () => {
  it('loads', function() {
    this.timeout(5000)
    return stdlib || Promise.reject('stdlib is null')
  })
  
  before(() => {
    stdlib = new Promise<Module>((resolve, reject) => {
      let errored = false
      function fail(msg: string, err: Jaspr, raisedBy?: Fiber): void {
        reject(new AssertionError({
          message: `\n${msg}: ${prettyPrint(err, false)}` +
            (raisedBy ? `\n\nStack trace:\n${raisedBy.stackTraceString(false)}` : '')
        }))
      }
      const env = root = Fiber.newRoot((root, err, raisedBy, cb) => {
        if (errored) return cb(null)
        errored = true
        resolveFully(err, (resErr, err) => {
          if (resErr) return fail('error resolving error', resErr,)
          if (err) return fail('error evaluating module', err, raisedBy)
          errored = false
          cb(null)
        })
      })
      waterfall<Module, JasprError>([
        (cb: any) => readModuleFile('jaspr/jaspr.jaspr.md', cb),
        (mod: ModuleSource, cb: any) =>
          evalModule(env, mod, {
            filename: 'jaspr/jaspr.jaspr.md',
            localModules: new Map([['jaspr.primitive', newPrimitiveModule(env)]])
          }, cb),
        resolveFully,
      ], (err, mod) => {
        if (err) return fail('error loading module', <JasprError>err)
        resolve(mod)
      })
    })

    stdlib.then(mod => describe('standard library test', () => {
      for (let test in mod.test) {
        it(test, () => new Promise<Jaspr>((resolve, reject) => {
          const env = root
          if (!env) return reject('env is null')
          const fiber = env.defer({
            dynamics: [[env.signalHandlerVar,
              new NativeFn(function errorHandler(err) {
                reject(new AssertionError({message: prettyPrint(err, false)}))
                fiber.cancel()
                return null
              }).toClosure(env)]],
            fn: (env, cb) =>
              deferExpandEval(env, mod, mod.test[test], `jaspr.${test}`).await(v => {
                try { expect(toBool(v)).to.be.true }
                catch (ex) { reject(ex) }
                cb(v)
              })
          })
          fiber.await(resolve)
        }))
      }
    }))
  })
})
