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
  return function*(x) { return fn(yield x) }
}

const functions: {[name: string]: Fn} = {
  typeOf: function* typeOf(x) {
    const it = yield x
    if (it === null) return 'null'
    switch (typeof it) {
      case 'boolean': return 'boolean'
      case 'number': return 'number'
      case 'string': return 'string'
      default: return isArray(it) ? 'array' : 'object'
    }
  },
  'gensym!': function* gensym(name?) {
    return this.gensym(name ? '' + (yield name) : undefined)
  },
  'print!': function* print(str) {
    console.log(yield str)
    return null
  },
  [Names.apply]: function* apply(fn, args) {
    const d = new Deferred()
    call(this, yield fn, yield args, d.resolve.bind(d))
    return d
  },
  sleep: function* sleep(ms) {
    const d = new Deferred()
    setTimeout(() => d.resolve(null), yield ms)
    return d
  },
  bool: wrap(toBool),
  'is?': function* is(a, b) { return (yield a) === (yield b) },
  'magic?': function* magic(it) { return isMagic(yield it) },
  [Names.assertEquals]: function* assertEquals(lhs, rhs) {
    const d = new Deferred()
    const a = yield lhs, b = yield rhs
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
  'chanMake!': function* chanMake() { return Chan.make() },
  'chan?': function* chan(it) { return Chan.isChan(yield it) },
  'chanSend!': function* chanSend(_msg, _chan) {
    const msg = yield _msg, chan = yield _chan
    return this.defer({
      action: Action.Send, inherit: true,
      fn: (env, cb) => (<Chan>chan[magicSymbol]).send(msg, cb)
    })
  },
  'chanRecv!': function* chanRecv(_chan) {
    const chan = yield _chan
    return this.defer({
      action: Action.Recv, inherit: true,
      fn: (env, cb) => (<Chan>chan[magicSymbol]).recv((err, val) => {
        if (err != null) raise(this, err, cb)
        else cb(<Jaspr>val)
      })
    })
  },
  'chanClose!': function* chanClose(chan) {
    return (<Chan>(yield chan)[magicSymbol]).close()
  },
  'chanClosed?': function* chanClosed(chan) {
    return (<Chan>(yield chan)[magicSymbol]).closed
  },

  // dynamic variables
  'dynamicMake!': function* dynamicMake(def) { return makeDynamic(yield def) },
  'dynamic?': function* dynamic(it) { return isDynamic(yield it) },
  dynamicGet: function* dynamicGet(dyn) {
    const d = new Deferred()
    this.getDynamic(yield dyn, d.resolve.bind(d))
    return d
  },

  // simple math
  '<': function* less(a, b) { return +(yield a) < +(yield b) },
  '<=': function* lessEq(a, b) { return +(yield a) <= +(yield b) },
  add: function* add(a, b) { return +(yield a) + +(yield b) },
  subtract: function* subtract(a, b) { return +(yield a) - +(yield b) },
  multiply: function* multiply(a, b) { return +(yield a) * +(yield b) },
  divide: function* divide(a, b) { return +(yield a) / +(yield b) },
  remainder: function* remainder(a, b) { return +(yield a) % +(yield b) },
  modulus: function* modulus(a, b) {
    const x = +(yield a), y = +(yield b)
    return (Math.abs(x) * Math.sign(y)) % y
  },
  negate: function* negate(a) { return -(yield a) },

  // advanced math
  'random!': function* random() { return Math.random() },
  pow: function* pow(a, b) { return Math.pow(yield a, yield b) },
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
  atan2: function* atan2(a, b) { return Math.atan2(yield a, yield b) },
  hypot: function* hypot(a, b) { return Math.hypot(yield a, yield b) },
  'finite?': wrap(isFinite),
  'NaN?': wrap(isNaN),

  // string
  toString: function*(it: Jaspr | Deferred) {
    const d = new Deferred()
    resolveFully(yield it, (err, it) => d.resolve(toString(it, true)))
    return d
  },
  toJSON: function* toJSON(it) { 
    const d = new Deferred()
    resolveFully(yield it, (err, it) => {
      if (err) raise(this, err, d.resolve.bind(d))
      else d.resolve(JSON.stringify(it))
    }, true)
    return it
  },
  fromJSON: function* fromJSON(a) { return JSON.parse(''+(yield a)) },
  stringCompare: function* stringCompare(x, y) {
    const a = ''+(yield x), b = ''+(yield y)
    if (a < b) return -1
    else if (a > b) return 1
    else return 0
  },
  stringConcat: function* stringConcat(a, b) { return ''+(yield a) + (yield b) },
  stringReplace: function* stringReplace(orig, repl, str) {
    return String.prototype.replace.call(
      ''+(yield str), ''+(yield orig), ''+(yield repl))
  },
  stringNativeIndexOf: function* stringNativeIndexOf(needle, haystack, start) {
    return String.prototype.indexOf.call(
      ''+(yield needle), ''+(yield haystack), (yield start)|0)
  },
  stringNativeLastIndexOf: function* stringNativeLastIndexOf(needle, haystack, start) {
    return String.prototype.lastIndexOf.call(
      ''+(yield needle), ''+(yield haystack), (yield start)|0)
  },
  stringNativeLength: function* stringNativeLength(str) { return (''+(yield str)).length },
  stringUnicodeLength: function* stringUnicodeLength(str) { return unicodeLength(str) },
  stringNativeSlice: function* stringNativeSlice(start, end, str) { 
    return String.prototype.slice.call(
      ''+(yield str), (yield start)|0, (yield end)|0)
  },
  stringUnicodeSlice: function* stringUnicodeSlice(start, end, str) { 
    let out = '', index = 0
    const st = (yield start)|0, ed = (yield end)|0
    for (let c of ''+(yield str)) {
      if (index >= ed) break
      else if (index >= st) out += c
      else index++
    }
    return out
  },
  stringNativeCharAt: function* stringNativeCharAt(index, str) {
    return String.prototype.charAt.call(
      ''+(yield str), (yield index)|0)
  },
  stringUnicodeCharAt: function* stringUnicodeCharAt(index, str) {
    let i = (yield index)|0
    for (let c of ''+(yield str)) if (i-- <= 0) return c
    return ''
  },
  stringUnicodeCodePointAt: function* stringUnicodeCodePointAt(index, str) {
    let i = (yield index)|0
    for (let c of ''+(yield str)) {
      if (i-- <= 0) return c.codePointAt(0)
    }
    return null
  },
  stringNativeChars: function* stringNativeChars(inStr) {
    let str = ''+(yield inStr), out = new Array<string>(str.length)
    for (let i = 0; i < out.length; i++) out[i] = str.charAt(i)
    return out
  },
  stringUnicodeChars: function* stringUnicodeChars(str) { return [...''+(yield str)] },
  stringUnicodeCodePoints: function* stringUnicodeCodePoints(str) {
    return [...''+(yield str)].map(c => c.codePointAt(0))
  },
  stringNativeFromChars: function* stringNativeFromChars(chars) {
    return Array.prototype.reduce.call(
      yield chars,
      (a: string, b: string) => a + b, '')
  },
  stringUnicodeFromCodePoints: function* stringUnicodeFromCodePoints(codePoints) {
    return String.fromCodePoint(...yield codePoints)
  },
  stringNFC: function* stringNFC(str) {
    return String.prototype.normalize.call(''+(yield str), 'NFC')
  },
  stringNFD: function* stringNFD(str) {
    return String.prototype.normalize.call(''+(yield str), 'NFD')
  },
  stringNFKC: function* stringNFKC(str) {
    return String.prototype.normalize.call(''+(yield str), 'NFKC')
  },
  stringNFKD: function* stringNFKD(str) {
    return String.prototype.normalize.call(''+(yield str), 'NFKD')
  },

  // arrays
  arrayMake: function* arrayMake(fn, len) {
    const l = (yield len)|0, f = yield fn
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
  [Names.arrayConcat]: function* arrayConcat(...args) {
    let out: Jaspr[] = []
    for (let next of args) out = out.concat(yield next)
    return out
  },
  arrayLength: function* arrayLength(a) { return (yield a).length },
  arraySlice: function* arraySlice(start, end, a) {
    return Array.prototype.slice.call(
      yield a, (yield start)|0, (yield end)|0)
  },

  // objects
  objectMake: function* objectMake(fn, keys) {
    const out = Object.create(null), f = yield fn
    for (let k of <string[]>(yield keys)) {
      const kk = k
      out[k] = this.defer({
        action: Action.Eval, code: [f, kk],
        fn: (env, cb) => call(env, f, [kk], cb)
      })
    }
    return out
  },
  objectHas: function* objectHas(key, obj) {
    return has(yield obj, ''+(yield key))
  },
  objectInsert: function* objectInsert(key, val, obj) {
    const out = Object.create(null), o = yield obj
    for (let oldKey in o) out[oldKey] = o[oldKey]
    out[''+(yield key)] = yield val
    return out
  },
  objectDelete: function* objectDelete(key, obj) {
    const out = Object.create(null), k = ''+(yield key), o = yield obj
    for (let oldKey in o) if (oldKey !== k) out[oldKey] = o[oldKey]
    return out
  },
  objectKeys: function* objectKeys(obj) { return Object.keys(yield obj) },
  objectValues: function* objectValues(obj) {
    const o = yield obj
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
    new NativeFn(function*(...args) {
      let code = [name]
      for (let arg of args) code.push(yield arg)
      return code
    }).toClosure(env))
  ;[value, macro].forEach(ctx => _.assignIn(ctx,
    _.mapKeys(ctx, (v, k) => `${Names.primitiveModule}.${k}`),
    _.mapKeys(ctx, (v, k) => qualify(moduleBase, k))
  ))
  return _.create(moduleBase, {value, macro})
}
