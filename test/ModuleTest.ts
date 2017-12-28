import {AssertionError} from 'assert'
import {expect} from 'chai'
import {Jaspr, JasprError, resolveFully, toString, magicSymbol} from '../src/Jaspr'
import {Root, Branch} from '../src/Fiber'
import prettyPrint from '../src/PrettyPrint'
import * as Names from '../src/ReservedNames'
import prim from '../src/JasprPrimitive'
import {
  readModuleFile, evalModule, importModule, ModuleSource, Module
} from '../src/Module'

function loadModule(
  filename: string,
  importedAs: string | null,
  assertions: (module: Module) => void
): () => Promise<void> {
  return () => new Promise((resolve, reject) => {
    function fail(msg: string, err: Jaspr, raisedBy?: Branch): void {
      reject(new AssertionError({
        message: `\n${msg}: ${prettyPrint(err, false)}`/* +
          (raisedBy ? `\n\nStack trace:\n${raisedBy.stackTraceString(false)}` : '') */
      }))
    }
    const env = new Root((root, err, raisedBy, cb) => {
      fail('error evaluating module', err, raisedBy)
      root.cancel()
    })
    readModuleFile(`test/modules/${filename}`, (err, modsrc) => {
      if (err) return fail('error loading module', err)
      evalModule(env, <ModuleSource>modsrc, {
        filename, localModules: new Map([
          [Names.primitiveModule, Promise.resolve(prim(env))]
        ])
      }).then(
        mod => resolveFully(importedAs ? importModule(mod, importedAs) : mod,
          (err, mod) => {
            try { assertions(<Module>mod) }
            catch (ex) { reject(ex); return }
            resolve()
          }),
        err => fail('error loading module', err))
    })
  })
}

describe('the module loader', () => {
  it('can load a module', loadModule('hello-world.jaspr', null, mod => {
    expect(mod.$module).to.equal('jaspr-tests.hello-world')
    expect(mod.$version).to.equal('1.0')
    expect(mod.$export).to.deep.equal({'hello-world': 'hello-world'})
    expect(mod.value).to.have.property('hello-world').equal('Hello, world!')
    expect(mod.value).to.have.property('jaspr-tests.hello-world.hello-world').equal('Hello, world!')
    expect(mod.value).to.have.property('jaspr-tests.hello-world.hello-world@1.0').equal('Hello, world!')
    expect(mod.qualified).to.have.property('jaspr-tests.hello-world.hello-world').equal('jaspr-tests.hello-world.hello-world@1.0')
    expect(mod.qualified).to.have.property('hello-world').equal('jaspr-tests.hello-world.hello-world@1.0')
  }))
  it('can load a module as a named import', loadModule('hello-world.jaspr', 'hello', mod => {
    expect(mod).to.not.have.property('$module')
    expect(mod).to.not.have.property('$export')
    expect(mod.value).to.have.property('hello-world').equal('Hello, world!')
    expect(mod.value).to.have.property('hello.hello-world').equal('Hello, world!')
    expect(mod.value).to.have.property('jaspr-tests.hello-world.hello-world@1.0').equal('Hello, world!')
    expect(mod.value).to.not.have.property('jaspr-tests.hello-world.hello-world')
    expect(mod.value).to.not.have.property('hello.hello-world@1.0')
    expect(mod.qualified).to.have.property('hello-world').equal('jaspr-tests.hello-world.hello-world@1.0')
    expect(mod.qualified).to.have.property('hello.hello-world').equal('jaspr-tests.hello-world.hello-world@1.0')
    expect(mod.qualified).to.not.have.property('jaspr-tests.hello-world.hello-world')
  }))
  it('handles recursive functions', loadModule('recursive-fn.jaspr', null, mod => {
    expect(mod.$module).to.equal('jaspr-tests.recursive-fn')
    expect(mod.$version).to.equal('1.0')
    expect(mod.value).to.have.property('factorial').be.an('object')
    expect(mod.value).to.have.property('five-factorial').equal(120)
    expect(mod.value).to.have.property('jaspr-tests.recursive-fn.five-factorial').equal(120)
    expect(mod.qualified).to.have.property('factorial').equal('jaspr-tests.recursive-fn.factorial@1.0')
  }))
  it('can load macros', loadModule('macros.jaspr', null, mod => {
    expect(mod.$module).to.equal('jaspr-tests.macros')
    expect(mod.macro).to.have.property('quote').be.an('object')
    expect(mod.macro).to.have.property('jaspr-tests.macros.quote').be.an('object')
    expect(mod.macro).to.not.have.property('quoted')
    expect(mod.macro).to.not.have.property('jaspr-tests.macros.quoted')
    expect(mod.value).to.not.have.property('quote')
    expect(mod.value).to.not.have.property('jaspr-tests.macros.quote')
    expect(mod.value).to.have.property('quoted').equal('quoted-value')
    expect(mod.value).to.have.property('jaspr-tests.macros.quoted').equal('quoted-value')
    expect(mod.qualified).to.have.property('quote').equal('jaspr-tests.macros.quote@1.0')
    expect(mod.qualified).to.have.property('quoted').equal('jaspr-tests.macros.quoted@1.0')
  }))
  it('can load literate modules', loadModule('simple-literate.jaspr.md', null, mod => {
    expect(mod.$module).to.equal('jaspr-tests.simple-literate')
    expect(mod.value).to.have.property('indented').equal('indented-value')
    expect(mod.value).to.have.property('fenced').equal('fenced-value')
  }))
  it('extracts tests from literate modules', loadModule('literate-tests.jaspr.md', null, mod => {
    expect(mod.$module).to.equal('jaspr-tests.literate-tests')
    //expect(mod.value).to.be.empty
    expect(mod.test).to.be.an('object')
    expect(mod.test).to.have.property('Literate-Program-with-Tests-0').equal(true)
    expect(mod.test).to.have.property('Literate-Program-with-Tests-1').deep.equal(
      ['jaspr.primitive.is?', ['jaspr.primitive.add', 2, 2], 4])
    expect(mod.test).to.have.property('Heading-1-0').deep.equal(
      [Names.assertEqualsQualified, ['jaspr.primitive.add', 2, 2], ['', 4]])
    expect(mod.test).to.have.property('Heading-2-0').deep.equal(
      [Names.assertEqualsQualified, [[], ['', 'a'], ['', 'b'], ['', 'c']], ['', ['a', 'b', 'c']]])
  }))
  it('loads included files', loadModule('has-includes.jaspr', null, mod => {
    expect(mod.$module).to.equal('jaspr-tests.has-includes')
    expect(mod.value).to.have.property('original').equal('original-value')
    expect(mod.value).to.have.property('included').equal('included-value')
    expect(mod.$export).to.deep.equal({original: 'original', included: 'included'})
  }))
  it('handles recursive includes', loadModule('has-recursive-include.jaspr', null, mod => {
    expect(mod.$module).to.equal('jaspr-tests.has-recursive-include')
    expect(mod.value).to.have.property('original').equal('original-value')
    expect(mod.value).to.have.property('included').equal('included-value')
    expect(mod.value).to.have.property('recursive-included').equal('recursive-included-value')
    expect(mod.$export).to.deep.equal({
      original: 'original',
      included: 'included',
      'recursive-included': 'recursive-included'
    })
  }))
})
