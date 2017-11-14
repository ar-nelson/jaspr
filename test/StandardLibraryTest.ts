import {AssertionError} from 'assert'
import {expect} from 'chai'
import {waterfall} from 'async'
import {Jaspr, JasprError, resolveFully, toString, toBool} from '../src/Jaspr'
import Fiber from '../src/Fiber'
import {deferExpandEval} from '../src/Interpreter'
import {readModuleFile, evalModule, ModuleSource, Module} from '../src/Module'

const stdlib = new Promise<Module>((resolve, reject) => {
    let errored = false
    function fail(msg: string, err: Jaspr): void {
      reject(new AssertionError({message: msg + ': ' + toString(err)}))
    }
    const env = Fiber.newRoot((root, err, cb) => {
      if (errored) return cb(null)
      errored = true
      resolveFully(err, (resErr, err) => {
        if (resErr) return fail('error resolving error', resErr)
        if (err) return fail('error evaluating module', err)
        errored = false
        cb(null)
      })
    })
    waterfall<Module, JasprError>([
      (cb: any) => readModuleFile('jaspr/jaspr.jaspr.md', cb),
      (mod: ModuleSource, cb: any) =>
        evalModule(env, mod, {filename: 'jaspr/jaspr.jaspr.md'}, cb),
      resolveFully,
    ], (err, mod) => {
      if (err) return fail('error loading module', <JasprError>err)
      resolve(mod)
    })
  })

describe('the standard library', () => {
  it('loads', () => stdlib)
  before(() => stdlib.then(mod => describe('standard library test', () => {
    for (let test in mod.test) {
      it(test, () => new Promise((resolve, reject) => {
        const env = Fiber.newRoot((root, err, cb) => {
          reject(new AssertionError({message: toString(err)}))
        }, reject)
        deferExpandEval(env, mod, mod.test[test], test, 'jaspr').await(v => {
          try { expect(toBool(v)).to.be.true }
          catch (ex) { reject(ex) }
          resolve()
        })
      }))
    }
  })))
})
