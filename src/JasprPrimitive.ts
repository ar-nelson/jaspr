/*
  This file defines the built-in `jaspr.primitive` module.

  `jaspr.primitive` is a module that comes bundled with every Jaspr
  implementation. Unlike the standard library (`jaspr`), `jaspr.primitive` is
  defined in the Jaspr implementation's host language, and the functions it
  exports may exhibit undefined behavior if given arguments of the wrong type.
*/

import {
  Jaspr, JasprObject, Deferred, Callback, magicSymbol, toBool, isArray,
  isObject, isMagic, resolveFully, has, toString
} from './Jaspr'
import {
  isDynamic, makeDynamic, Action, Env, call, raise, qualify
} from './Interpreter'
import {currentSchema, Module} from './Module'
import {NativeFn, Fn} from './NativeFn'
import Chan from './Chan'
import * as Names from './ReservedNames'
import * as _ from 'lodash'
import {expect} from 'chai'
const unicodeLength = require('string-length')


const moduleBase: Module = {
  $schema: currentSchema,
  $module: Names.primitiveModule,
  $version: Names.version,
  $author: 'Adam R. Nelson <adam@nels.onl>',
  $doc: `
    Low-level primitives used to implement the Jaspr standard library.
    Should not be used directly in production code; use the \`jaspr\` module
    instead.
  `.trim().replace(/\s+/gm, ' '),
  $main: null, $import: {}, $export: {},
  value: {}, macro: {}, check: {}, doc: {}, test: {}, qualified: {}
}

const constants: JasprObject = {
  version: Names.version,
  Infinity: Infinity,
  '-Infinity': -Infinity,
  'NaN': NaN,
  scopeKey: null,
  signalHandler: null,
  name: null
}

function wrap(fn: (x: any) => Jaspr): Fn {
  return function(x) { return fn(x) }
}

const functions: {[name: string]: Fn} = {
  typeOf(it) {
    if (it === null) return 'null'
    switch (typeof it) {
      case 'boolean': return 'boolean'
      case 'number': return 'number'
      case 'string': return 'string'
      default: return isArray(it) ? 'array' : 'object'
    }
  },
  'gensym!'(name?) {
    return this.gensym(name ? ''+name : undefined)
  },
  'print!'(str) {
    console.log(str)
    return null
  },
  [Names.apply](fn, args) {
    const d = new Deferred()
    call(this, fn, <any[]>args, d.resolve.bind(d))
    return d
  },
  sleep(ms) {
    const d = new Deferred()
    setTimeout(() => d.resolve(null), ms)
    return d
  },
  bool: wrap(toBool),
  'is?'(a, b) { return a === b },
  'magic?'(it) { return isMagic(it) },
  [Names.assertEquals](a, b) {
    const d = new Deferred()
    resolveFully(a, (err, a) => resolveFully(b, (err, b) => {
      try {
        if (isMagic(a) || isMagic(b)) return d.resolve(a === b)
        expect(a).to.deep.equal(b)
        d.resolve(true)
      } catch (ex) {
        this.testFailure(ex)
        d.resolve(false)
      }
    }))
    return d
  },

  // channels
  'chanMake!'() { return Chan.make() },
  'chan?'(it) { return Chan.isChan(it) },
  'chanSend!'(msg, chan) {
    return this.defer({
      action: Action.Send, inherit: true,
      fn: (env, cb) => (<Chan>(<any>chan)[magicSymbol]).send(msg, cb)
    })
  },
  'chanRecv!'(chan) {
    return this.defer({
      action: Action.Recv, inherit: true,
      fn: (env, cb) => (<Chan>(<any>chan)[magicSymbol]).recv((err, val) => {
        if (err != null) raise(this, err, cb)
        else cb(<Jaspr>val)
      })
    })
  },
  'chanClose!'(chan) {
    return (<Chan>(<any>chan)[magicSymbol]).close()
  },
  'chanClosed?'(chan) {
    return (<Chan>(<any>chan)[magicSymbol]).closed
  },

  // dynamic variables
  'dynamicMake!'(def) { return makeDynamic(def) },
  'dynamic?'(it) { return isDynamic(it) },
  dynamicGet(dyn) {
    const d = new Deferred()
    this.getDynamic(<any>dyn, d.resolve.bind(d))
    return d
  },

  // simple math
  '<'(a, b) { return +(<any>a) < +(<any>b) },
  '<='(a, b) { return +(<any>a) <= +(<any>b) },
  add(a, b) { return +(<any>a) + +(<any>b) },
  subtract(a, b) { return +(<any>a) - +(<any>b) },
  multiply(a, b) { return +(<any>a) * +(<any>b) },
  divide(a, b) { return +(<any>a) / +(<any>b) },
  remainder(a, b) { return +(<any>a) % +(<any>b) },
  modulus(a, b) {
    const x = +(<any>a), y = +(<any>b)
    return (Math.abs(x) * Math.sign(y)) % y
  },
  negate(a) { return -(<any>a) },

  // advanced math
  'random!'() { return Math.random() },
  pow(a, b) { return Math.pow(<any>a, <any>b) },
  sqrt: wrap(Math.sqrt),
  cbrt: wrap(Math.cbrt),
  log: wrap(Math.log),
  log2: wrap(Math.log2),
  log10: wrap(Math.log10),
  floor: wrap(Math.floor),
  ceil: wrap(Math.ceil),
  round: wrap(Math.round),
  abs: wrap(Math.abs),
  sin: wrap(Math.sin),
  cos: wrap(Math.cos),
  tan: wrap(Math.tan),
  asin: wrap(Math.asin),
  acos: wrap(Math.acos),
  atan: wrap(Math.atan),
  sinh: wrap(Math.sinh),
  cosh: wrap(Math.cosh),
  tanh: wrap(Math.tanh),
  asinh: wrap(Math.asinh),
  acosh: wrap(Math.acosh),
  atanh: wrap(Math.atanh),
  atan2(a, b) { return Math.atan2(<any>a, <any>b) },
  hypot(a, b) { return Math.hypot(<any>a, <any>b) },
  'finite?': wrap(isFinite),
  'NaN?': wrap(isNaN),

  // string
  toString(it: Jaspr | Deferred) {
    const d = new Deferred()
    resolveFully(<any>it, (err, it) => d.resolve(toString(it, true)))
    return d
  },
  toJSON(it) { 
    const d = new Deferred()
    resolveFully(<any>it, (err, it) => {
      if (err) raise(this, err, d.resolve.bind(d))
      else d.resolve(JSON.stringify(it))
    }, true)
    return it
  },
  fromJSON(a) { return JSON.parse(''+(<any>a)) },
  stringCompare(x, y) {
    const a = ''+(<any>x), b = ''+(<any>y)
    if (a < b) return -1
    else if (a > b) return 1
    else return 0
  },
  stringConcat(a, b) { return ''+(<any>a) + (<any>b) },
  stringReplace(orig, repl, str) {
    return String.prototype.replace.call(
      ''+(<any>str), ''+(<any>orig), ''+(<any>repl))
  },
  stringNativeIndexOf(needle, haystack, start) {
    return String.prototype.indexOf.call(
      ''+(<any>needle), ''+(<any>haystack), (<any>start)|0)
  },
  stringNativeLastIndexOf(needle, haystack, start) {
    return String.prototype.lastIndexOf.call(
      ''+(<any>needle), ''+(<any>haystack), (<any>start)|0)
  },
  stringNativeLength(str) { return (''+(<any>str)).length },
  stringUnicodeLength(str) { return unicodeLength(str) },
  stringNativeSlice(start, end, str) { 
    return String.prototype.slice.call(
      ''+(<any>str), (<any>start)|0, (<any>end)|0)
  },
  stringUnicodeSlice(start, end, str) { 
    let out = '', index = 0
    const st = (<any>start)|0, ed = (<any>end)|0
    for (let c of ''+(<any>str)) {
      if (index >= ed) break
      else if (index >= st) out += c
      else index++
    }
    return out
  },
  stringNativeCharAt(index, str) {
    return String.prototype.charAt.call(
      ''+(<any>str), (<any>index)|0)
  },
  stringUnicodeCharAt(index, str) {
    let i = (<any>index)|0
    for (let c of ''+(<any>str)) if (i-- <= 0) return c
    return ''
  },
  stringUnicodeCodePointAt(index, str) {
    let i = (<any>index)|0
    for (let c of ''+(<any>str)) {
      if (i-- <= 0) return c.codePointAt(0)
    }
    return null
  },
  stringNativeChars(inStr) {
    let str = ''+(<any>inStr), out = new Array<string>(str.length)
    for (let i = 0; i < out.length; i++) out[i] = str.charAt(i)
    return out
  },
  stringUnicodeChars(str) { return [...''+(<any>str)] },
  stringUnicodeCodePoints(str) {
    return [...''+(<any>str)].map(c => c.codePointAt(0))
  },
  stringNativeFromChars(chars) {
    return Array.prototype.reduce.call(
      <any>chars,
      (a: string, b: string) => a + b, '')
  },
  stringUnicodeFromCodePoints(codePoints) {
    return String.fromCodePoint(...<any>codePoints)
  },
  stringNFC(str) {
    return String.prototype.normalize.call(''+(<any>str), 'NFC')
  },
  stringNFD(str) {
    return String.prototype.normalize.call(''+(<any>str), 'NFD')
  },
  stringNFKC(str) {
    return String.prototype.normalize.call(''+(<any>str), 'NFKC')
  },
  stringNFKD(str) {
    return String.prototype.normalize.call(''+(<any>str), 'NFKD')
  },

  // arrays
  arrayMake(fn, len) {
    const l = (<any>len)|0, f = <any>fn
    const out = new Array<Deferred>(l)
    for (let i = 0; i < l; i++) {
      const ii = i
      out[i] = this.defer({
        action: Action.Eval, code: [f, ii],
        fn: (env, cb) => call(env, f, [ii], cb)
      })
    }
    return out
  },
  [Names.arrayConcat](...args) {
    let out: Jaspr[] = []
    for (let next of args) out = out.concat(<any>next)
    return out
  },
  arrayLength(a) { return (<any>a).length },
  arraySlice(start, end, a) {
    return Array.prototype.slice.call(
      <any>a, (<any>start)|0, (<any>end)|0)
  },

  // objects
  objectMake(fn, keys) {
    const out = Object.create(null), f = <any>fn
    for (let k of <string[]>(<any>keys)) {
      const kk = k
      out[k] = this.defer({
        action: Action.Eval, code: [f, kk],
        fn: (env, cb) => call(env, f, [kk], cb)
      })
    }
    return out
  },
  objectHas(key, obj) {
    return has(<any>obj, ''+(<any>key))
  },
  objectInsert(key, val, obj) {
    const out = Object.create(null), o = <any>obj
    for (let oldKey in o) out[oldKey] = o[oldKey]
    out[''+(<any>key)] = <any>val
    return out
  },
  objectDelete(key, obj) {
    const out = Object.create(null), k = ''+(<any>key), o = <any>obj
    for (let oldKey in o) if (oldKey !== k) out[oldKey] = o[oldKey]
    return out
  },
  objectKeys(obj) { return Object.keys(<any>obj) },
  objectValues(obj) {
    const o = <any>obj
    return Object.keys(o).map(k => o[k])
  }
}

const macros: {[name: string]: string} = {
  closure: Names.closure,
  contextGet: Names.contextGet,
  dynamicLet: Names.dynamicLet,
  eval: Names.eval_,
  'if': Names.if_,
  then: Names.then,
  junction: Names.junction,
  macroexpand: Names.macroexpand
}

moduleBase.$export =
  _([constants, functions, macros])
    .flatMap(_.keys).map(k => [k, k])
    .fromPairs().value()
  
moduleBase.qualified =
  _([constants, functions, macros])
    .flatMap(_.keys)
    .flatMap(k => [
      [k, qualify(moduleBase, k)],
      [`${Names.primitiveModule}.${k}`, qualify(moduleBase, k)]])
    .fromPairs().value()

export default function JasprPrimitive(env: Env): Module {
  const value = _(functions)
    .mapValues((fn: Fn) => new NativeFn(fn).toClosure(env))
    .assign(constants, {
      scopeKey: env.closureName,
      signalHandler: env.signalHandlerVar,
      name: env.nameVar
    }).value()
  const macro = _.mapValues(macros, name =>
    new NativeFn(function(...args) {
      let code: Jaspr[] = [name]
      for (let arg of args) code.push(arg)
      return code
    }).toClosure(env))
  ;[value, macro].forEach(ctx => _.assignIn(ctx,
    _.mapKeys(ctx, (v, k) => `${Names.primitiveModule}.${k}`),
    _.mapKeys(ctx, (v, k) => qualify(moduleBase, k))
  ))
  return _.create(moduleBase, {value, macro})
}
