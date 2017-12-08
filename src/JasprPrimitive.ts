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
import {isDynamic, makeDynamic, Env, qualify} from './Interpreter'
import {currentSchema, Module} from './Module'
import {NativeFn, NativeSyncFn, NativeAsyncFn} from './NativeFn'
import Chan from './Chan'
import * as Names from './ReservedNames'
import * as _ from 'lodash'
import {expect, AssertionError} from 'chai'
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

function wrap(fn: (x: any) => Jaspr): NativeFn {
  return new NativeSyncFn(function(x) { return fn(x) })
}

const functions: {[name: string]: NativeFn} = {
  typeOf: new NativeSyncFn(function(it) {
    if (it === null) return 'null'
    switch (typeof it) {
      case 'boolean': return 'boolean'
      case 'number': return 'number'
      case 'string': return 'string'
      default: return isArray(it) ? 'array' : 'object'
    }
  }),
  'gensym!': new NativeSyncFn(function(name?) {
    return this.gensym(name ? ''+name : undefined)
  }),
  'print!': new NativeAsyncFn(function([str], cb) {
    console.log(str)
    cb(undefined, null)
  }),
  sleep: new NativeAsyncFn(function([ms], cb) {
    setTimeout(cb, ms, null)
  }),
  bool: wrap(toBool),
  'is?': new NativeSyncFn(function(a, b) { return a === b }),
  'magic?': new NativeSyncFn(function(it) { return isMagic(it) }),
  [Names.assertEquals]: new NativeAsyncFn(function([a, b], cb) {
    resolveFully(a, (err, a) => resolveFully(b, (err, b) => {
      try {
        if (isMagic(a) || isMagic(b)) return cb(undefined, a === b)
        expect(a).to.deep.equal(b)
        cb(undefined, true)
      } catch (err) {
        if (err instanceof AssertionError) cb(<any>{
          err: 'AssertFailed', why: err.message,
          [magicSymbol]: err
        })
        else cb(err)
      }
    }))
  }),

  // channels
  'chanMake!': new NativeSyncFn(function() { return Chan.make() }),
  'chan?': new NativeSyncFn(function(it) { return Chan.isChan(it) }),
  'chanSend!': new NativeAsyncFn(function([msg, chan], cb) {
    resolveFully(msg, (err, msg) => {
      const cancel =
        (<Chan>(<any>chan)[magicSymbol]).send(msg, x => cb(undefined, x))
      if (cancel) this.onCancel(cancel)
    })
  }),
  'chanRecv!': new NativeAsyncFn(function([chan], cb) {
    const cancel = (<Chan>(<any>chan)[magicSymbol]).recv(cb)
    if (cancel) this.onCancel(cancel)
  }),
  'chanClose!': new NativeSyncFn(function(chan) {
    return (<Chan>(<any>chan)[magicSymbol]).close()
  }),
  'chanClosed?': new NativeSyncFn(function(chan) {
    return (<Chan>(<any>chan)[magicSymbol]).closed
  }),

  // dynamic variables
  'dynamicMake!': new NativeSyncFn(function(def) { return makeDynamic(def) }),
  'dynamic?': new NativeSyncFn(function(it) { return isDynamic(it) }),

  // simple math
  '<': new NativeSyncFn(function(a, b) { return +(<any>a) < +(<any>b) }),
  '<=': new NativeSyncFn(function(a, b) { return +(<any>a) <= +(<any>b) }),
  add: new NativeSyncFn(function(a, b) { return +(<any>a) + +(<any>b) }),
  subtract: new NativeSyncFn(function(a, b) { return +(<any>a) - +(<any>b) }),
  multiply: new NativeSyncFn(function(a, b) { return +(<any>a) * +(<any>b) }),
  divide: new NativeSyncFn(function(a, b) { return +(<any>a) / +(<any>b) }),
  remainder: new NativeSyncFn(function(a, b) { return +(<any>a) % +(<any>b) }),
  modulus: new NativeSyncFn(function(a, b) {
    const x = +(<any>a), y = +(<any>b)
    return (Math.abs(x) * Math.sign(y)) % y
  }),
  negate: new NativeSyncFn(function(a) { return -(<any>a) }),

  // advanced math
  'random!': new NativeSyncFn(function() { return Math.random() }),
  pow: new NativeSyncFn(function(a, b) { return Math.pow(<any>a, <any>b) }),
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
  atan2: new NativeSyncFn(function(a, b) { return Math.atan2(<any>a, <any>b) }),
  hypot: new NativeSyncFn(function(a, b) { return Math.hypot(<any>a, <any>b) }),
  'finite?': wrap(isFinite),
  'NaN?': wrap(isNaN),

  // string
  toString: new NativeAsyncFn(function([it], cb) {
    resolveFully(<any>it, (err, it) => cb(undefined, toString(it, true)))
  }),
  toJSON: new NativeAsyncFn(function([it], cb) {
    resolveFully(<any>it, (err, it) => {
      if (err) cb(err)
      else cb(undefined, JSON.stringify(it))
    })
  }),
  fromJSON: new NativeSyncFn(function(a) { return JSON.parse(''+(<any>a)) }),
  stringCompare: new NativeSyncFn(function(x, y) {
    const a = ''+(<any>x), b = ''+(<any>y)
    if (a < b) return -1
    else if (a > b) return 1
    else return 0
  }),
  stringConcat: new NativeSyncFn(function(a, b) { return '' + a + b }),
  stringReplace: new NativeSyncFn(function(orig, repl, str) {
    return String.prototype.replace.call(
      ''+(<any>str), ''+(<any>orig), ''+(<any>repl))
  }),
  stringNativeIndexOf: new NativeSyncFn(function(needle, haystack, start) {
    return String.prototype.indexOf.call(
      ''+(<any>needle), ''+(<any>haystack), (<any>start)|0)
  }),
  stringNativeLastIndexOf: new NativeSyncFn(function(needle, haystack, start) {
    return String.prototype.lastIndexOf.call(
      ''+(<any>needle), ''+(<any>haystack), (<any>start)|0)
  }),
  stringNativeLength: new NativeSyncFn(function(str) { return (''+(<any>str)).length }),
  stringUnicodeLength: new NativeSyncFn(function(str) { return unicodeLength(str) }),
  stringNativeSlice: new NativeSyncFn(function(start, end, str) { 
    return String.prototype.slice.call(
      ''+(<any>str), (<any>start)|0, (<any>end)|0)
  }),
  stringUnicodeSlice: new NativeSyncFn(function(start, end, str) { 
    let out = '', index = 0
    const st = (<any>start)|0, ed = (<any>end)|0
    for (let c of ''+(<any>str)) {
      if (index >= ed) break
      else if (index >= st) out += c
      else index++
    }
    return out
  }),
  stringNativeCharAt: new NativeSyncFn(function(index, str) {
    return String.prototype.charAt.call(
      ''+(<any>str), (<any>index)|0)
  }),
  stringUnicodeCharAt: new NativeSyncFn(function(index, str) {
    let i = (<any>index)|0
    for (let c of ''+(<any>str)) if (i-- <= 0) return c
    return ''
  }),
  stringUnicodeCodePointAt: new NativeSyncFn(function(index, str) {
    let i = (<any>index)|0
    for (let c of ''+(<any>str)) {
      if (i-- <= 0) return <number>c.codePointAt(0)
    }
    return null
  }),
  stringNativeChars: new NativeSyncFn(function(inStr) {
    let str = ''+(<any>inStr), out = new Array<string>(str.length)
    for (let i = 0; i < out.length; i++) out[i] = str.charAt(i)
    return out
  }),
  stringUnicodeChars: new NativeSyncFn(function(str) { return [...''+(<any>str)] }),
  stringUnicodeCodePoints: new NativeSyncFn(function(str) {
    return [...''+(<any>str)].map(c => <number>c.codePointAt(0))
  }),
  stringNativeFromChars: new NativeSyncFn(function(chars) {
    return Array.prototype.reduce.call(
      <any>chars,
      (a: string, b: string) => a + b, '')
  }),
  stringUnicodeFromCodePoints: new NativeSyncFn(function(codePoints) {
    return String.fromCodePoint(...<any>codePoints)
  }),
  stringNFC: new NativeSyncFn(function(str) {
    return String.prototype.normalize.call(''+(<any>str), 'NFC')
  }),
  stringNFD: new NativeSyncFn(function(str) {
    return String.prototype.normalize.call(''+(<any>str), 'NFD')
  }),
  stringNFKC: new NativeSyncFn(function(str) {
    return String.prototype.normalize.call(''+(<any>str), 'NFKC')
  }),
  stringNFKD: new NativeSyncFn(function(str) {
    return String.prototype.normalize.call(''+(<any>str), 'NFKD')
  }),

  // arrays
  [Names.arrayConcat]: new NativeSyncFn(function(...args) {
    let out: Jaspr[] = []
    for (let next of args) out = out.concat(<any>next)
    return out
  }),
  arrayLength: new NativeSyncFn(function(a) { return (<any>a).length }),
  arraySlice: new NativeSyncFn(function(start, end, a) {
    return Array.prototype.slice.call(
      <any>a, (<any>start)|0, (<any>end)|0)
  }),

  // objects
  objectHas: new NativeSyncFn(function(key, obj) {
    return has(<any>obj, ''+(<any>key))
  }),
  objectInsert: new NativeSyncFn(function(key, val, obj) {
    const out = Object.create(null), o = <any>obj
    for (let oldKey in o) out[oldKey] = o[oldKey]
    out[''+(<any>key)] = <any>val
    return out
  }),
  objectDelete: new NativeSyncFn(function(key, obj) {
    const out = Object.create(null), k = ''+(<any>key), o = <any>obj
    for (let oldKey in o) if (oldKey !== k) out[oldKey] = o[oldKey]
    return out
  }),
  objectKeys: new NativeSyncFn(function(obj) { return Object.keys(<any>obj) }),
  objectValues: new NativeSyncFn(function(obj) {
    const o = <any>obj
    return Object.keys(o).map(k => o[k])
  })
}

const macros: {[name: string]: string} = {
  apply: Names.apply,
  arrayMake: Names.arrayMake,
  closure: Names.closure,
  contextGet: Names.contextGet,
  dynamicGet: Names.dynamicGet,
  dynamicLet: Names.dynamicLet,
  eval: Names.eval_,
  'if': Names.if_,
  junction: Names.junction,
  macroexpand: Names.macroexpand,
  objectMake: Names.objectMake,
  then: Names.then
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
    .mapValues((fn: NativeFn) => fn.toClosure(env))
    .assign(constants, {
      scopeKey: env.closureName,
      signalHandler: env.signalHandlerVar,
      name: env.nameVar
    }).value()
  const macro = _.mapValues(macros, name =>
    new NativeSyncFn(function(...args) {
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
