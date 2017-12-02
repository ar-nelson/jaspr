import {
  Jaspr, JasprError, resolveFully, toString, toBool, isObject, magicSymbol
} from '../src/Jaspr'
import {Root, Branch} from '../src/Fiber'
import {expandAndEval} from '../src/Interpreter'
import {readModuleFile, evalModule, ModuleSource, Module} from '../src/Module'
import newPrimitiveModule from '../src/JasprPrimitive'
import prettyPrint from '../src/PrettyPrint'
import {NativeSyncFn} from '../src/NativeFn'
import {expect, AssertionError} from 'chai'
import {waterfall} from 'async'

let stdlib: Promise<Module> | null = null
let root: Root | null

describe('the standard library', () => {
  it('loads', function() {
    this.timeout(5000)
    return stdlib || Promise.reject('stdlib is null')
  })
  
  before(() => {
    stdlib = new Promise<Module>((resolve, reject) => {
      let errored = false
      function fail(msg: string, err: Jaspr, raisedBy?: Branch): void {
        reject(new AssertionError(
          `\n${msg}: ${prettyPrint(err, false)}` /*+
          (raisedBy ? `\n\nStack trace:\n${raisedBy.stackTraceString(false)}` : '')*/))
      }
      const env = root = new Root((root, err, raisedBy, cb) => {
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
          const {fiber, cancel} = env.deferCancelable(
            (env, cb) => expandAndEval(env, mod, [], {
                key: env.signalHandlerVar,
                value: new NativeSyncFn(function errorHandler(err) {
                  if (isObject(err) && err[magicSymbol] instanceof Error) {
                    reject(err[magicSymbol])
                  } else reject(new AssertionError(prettyPrint(err, false)))
                  cancel()
                  return null
                }).toClosure(env)
              }, mod.test[test], cb))
          fiber.await(v => {
            try { expect(toBool(v)).to.be.true }
            catch (ex) { return reject(ex) }
            resolve(v)
          })
        }))
      }
    }))
  })
})
