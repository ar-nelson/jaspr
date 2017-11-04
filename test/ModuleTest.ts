import {AssertionError} from 'assert'
import {expect} from 'chai'
import {Jaspr, resolveFully, toString} from '../src/Jaspr'
import Fiber from '../src/Fiber'
import {readModuleFile, evalModule, ModuleSource, Module} from '../src/Module'

function loadModule(
  filename: string, assertions: (module: Module) => void
): () => Promise<void> {
  return () => new Promise((resolve, reject) => {
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
    readModuleFile(`test/modules/${filename}`, (err, mod) => {
      if (err) return fail('error reading module file', err)
      resolveFully(evalModule(env, <ModuleSource>mod), (err, mod) => {
        if (err) return fail('error resolving module', err)
        try { assertions(<Module>mod) }
        catch (ex) { reject(ex); return }
        resolve()
      })
    })
  })
}

describe('the module loader', () => {
  it('can load a module', loadModule('hello-world.jaspr', mod => {
    expect(mod.$module).to.equal('jaspr-tests.hello-world')
    expect(mod.$export).to.deep.equal({'hello-world': 'hello-world'})
    expect(mod.value).to.have.property('hello-world').equal('Hello, world!')
    expect(mod.value).to.have.property('jaspr-tests.hello-world.hello-world').equal('Hello, world!')
    expect(mod.qualified).to.have.property('hello-world').equal('jaspr-tests.hello-world.hello-world')
  }))
  it('handles recursive functions', loadModule('recursive-fn.jaspr', mod => {
    expect(mod.$module).to.equal('jaspr-tests.recursive-fn')
    expect(mod.value).to.have.property('factorial').be.an('object')
    expect(mod.value).to.have.property('five-factorial').equal(120)
    expect(mod.value).to.have.property('jaspr-tests.recursive-fn.five-factorial').equal(120)
    expect(mod.qualified).to.have.property('factorial').equal('jaspr-tests.recursive-fn.factorial')
  }))
  it('can load macros', loadModule('macros.jaspr', mod => {
    expect(mod.$module).to.equal('jaspr-tests.macros')
    expect(mod.macro).to.have.property('quote').be.an('object')
    expect(mod.macro).to.have.property('jaspr-tests.macros.quote').be.an('object')
    expect(mod.macro).to.not.have.property('quoted')
    expect(mod.macro).to.not.have.property('jaspr-tests.macros.quoted')
    expect(mod.value).to.not.have.property('quote')
    expect(mod.value).to.not.have.property('jaspr-tests.macros.quote')
    expect(mod.value).to.have.property('quoted').equal('quoted-value')
    expect(mod.value).to.have.property('jaspr-tests.macros.quoted').equal('quoted-value')
    expect(mod.qualified).to.have.property('quote').equal('jaspr-tests.macros.quote')
    expect(mod.qualified).to.have.property('quoted').equal('jaspr-tests.macros.quoted')
  }))
  it('can load literate modules', loadModule('simple-literate.jaspr.md', mod => {
    expect(mod.$module).to.equal('jaspr-tests.simple-literate')
    expect(mod.value).to.have.property('indented').equal('indented-value')
    expect(mod.value).to.have.property('fenced').equal('fenced-value')
  }))
  it('extracts tests from literate modules', loadModule('literate-tests.jaspr.md', mod => {
    expect(mod.$module).to.equal('jaspr-tests.literate-tests')
    expect(mod.value).to.be.empty
    expect(mod.test).to.have.property('Literate-Program-with-Tests-0').equal(true)
    expect(mod.test).to.have.property('Literate-Program-with-Tests-1').deep.equal(
      ['$equals', ['$add', 2, 2], 4])
    expect(mod.test).to.have.property('Heading-1-0').deep.equal(
      ['$assert-deep-equals', ['$add', 2, 2], ['', 4]])
    expect(mod.test).to.have.property('Heading-2-0').deep.equal(
      ['$assert-deep-equals', [[], ['', 'a'], ['', 'b'], ['', 'c']], ['', ['a', 'b', 'c']]])
  }))
  it('loads included files', loadModule('has-includes.jaspr', mod => {
    expect(mod.$module).to.equal('jaspr-tests.has-includes')
    expect(mod.value).to.have.property('original').equal('original-value')
    expect(mod.value).to.have.property('included').equal('included-value')
    expect(mod.$export).to.deep.equal({original: 'original', included: 'included'})
  }))
  it('handles recursive includes', loadModule('has-recursive-include.jaspr', mod => {
    expect(mod.$module).to.equal('jaspr-tests.has-recursive-include')
    expect(mod.value).to.have.property('original').equal('original-value')
    expect(mod.value).to.have.property('included').equal('included-value')
    expect(mod.value).to.have.property('recursive-include').equal('recursive-include-value')
    expect(mod.$export).to.deep.equal({
      original: 'original',
      included: 'included',
      'recursive-include': 'recursive-include'
    })
  }))
})
