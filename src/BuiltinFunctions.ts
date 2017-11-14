import {
  Jaspr, Callback, Deferred, resolveFully, isArray, isObject, isClosure, toBool,
  toString, isMagic, isDynamic, makeDynamic, magicSymbol
} from './Jaspr'
import {Env, Action, call, raise} from './Interpreter'
import Chan from './Chan'
import * as Names from './ReservedNames'
import {mapKeys} from 'lodash'
import {expect} from 'chai'
const unicodeLength = require('string-length')

export type Builtin = (env: Env, args: any[], cb: Callback) => void
let nextGensym = 0

function wrap(fn: (x: any) => Jaspr): Builtin {
  return (env, [x], cb) => cb(fn(x))
}

export function has(obj: {}, key: string): boolean {
  for (let proto = obj; proto != null; proto = Object.getPrototypeOf(proto)) {
    if (Object.prototype.propertyIsEnumerable.call(proto, key)) return true
  }
  return false
}

// https://gist.github.com/LeverOne/1308368
export function uuid(): string {
  let a: any, b: any
  for(b=a='';a++<36;b+=a*51&52?(a^15?8^Math.random()*(a^20?16:4):4).toString(16):'-');
  return b
}

const fns: {[name: string]: Builtin} = {
  typeOf(env, [it], cb) {
    if (it === null) return cb('null')
    switch (typeof it) {
      case 'boolean': return cb('boolean')
      case 'number': return cb('number')
      case 'string': return cb('string')
      default: cb(isArray(it) ? 'array' : 'object')
    }
  },
  gensym(env, args, cb) {
    if (args.length > 0) cb('' + args[0] + '-' + uuid())
    else cb(uuid())
  },
  print(env, [str], cb) { console.log(str); cb(null) },
  apply(env, [fn, args], cb) { call(env, fn, args, cb) },
  sleep(env, [ms], cb) { setTimeout(cb, ms, null) },
  bool: wrap(toBool),
  equals(env, [a, b], cb) { cb(a === b) },
  isMagic(env, [it], cb) { cb(isMagic(it)) },
  [Names.assertEquals.slice(Names.prefix.length)](env, [a, b], cb) {
    resolveFully(a, (err, a) => resolveFully(b, (err, b) => {
      try {
        if (isMagic(a) || isMagic(b)) return cb(a === b)
        expect(a).to.deep.equal(b)
        cb(true)
      } catch (ex) {
        env.testFailure(ex)
        cb(false)
      }
    }))
  },

  // channels
  chanMake(env, [], cb) { cb(Chan.make()) },
  isChan(env, [it], cb) { cb(Chan.isChan(it)) },
  chanSend(env, [msg, chan], cb) {
    (<Chan>chan[magicSymbol]).send(msg, cb)
  },
  chanRecv(env, [chan], cb) {
    (<Chan>chan[magicSymbol]).recv((err, val) => {
      if (err != null) raise(env, err, cb)
      else cb(<Jaspr>val)
    })
  },
  chanClose(env, [chan], cb) { cb((<Chan>chan[magicSymbol]).close()) },
  chanIsClosed(env, [chan], cb) { cb((<Chan>chan[magicSymbol]).closed) },

  // dynamic variables
  dynamicMake(env, [def], cb) { cb(makeDynamic(def)) },
  isDynamic(env, [it], cb) { cb(isDynamic(it)) },
  dynamicGet(env, [dyn], cb) { env.getDynamic(dyn, cb) },

  // simple math
  less(env, [a, b], cb) { cb(+a < +b) },
  lessOrEqual(env, [a, b], cb) { cb(+a <= +b) },
  add(env, [a, b], cb) { cb(+a + +b) },
  subtract(env, [a, b], cb) { cb(+a - +b) },
  multiply(env, [a, b], cb) { cb(+a * +b) },
  divide(env, [a, b], cb) { cb(+a / +b) },
  remainder(env, [a, b], cb) { cb(+a % +b) },
  modulus(env, [a, b], cb) { cb((Math.abs(a) * Math.sign(b)) % b) },
  negate(env, [a], cb) { cb(-a) },

  // advanced math
  pow(env, [a, b], cb) { cb(Math.pow(a, b)) },
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
  atan2(env, [a, b], cb) { cb(Math.atan2(a, b)) },
  hypot(env, [a, b], cb) { cb(Math.hypot(a, b)) },
  infinity(env, [], cb) { cb(Infinity) },
  NaN(env, [], cb) { cb(NaN) },
  isFinite: wrap(isFinite),
  isNaN: wrap(isNaN),

  // strings
  toString(env: Env, [a]: Jaspr[], cb: Callback) {
    resolveFully(a, (err, x) => cb(toString(x, true)))
  },
  toJSON(env, [a], cb) { 
    resolveFully(a, (err, x) => {
      if (err) raise(env, err, cb)
      else cb(toString(x))
    }, true)
  },
  fromJSON(env, [a], cb) { cb(JSON.parse(a)) },
  stringCompare(env, [a, b], cb) {
    if ('' + a < '' + b) cb(-1)
    else if ('' + a > '' + b) cb(1)
    else cb(0)
  },
  stringConcat(env, [a, b], cb) { cb('' + a + b) },
  stringReplace(env, [orig, repl, str], cb) {
    cb(String.prototype.replace.call(str, orig, repl))
  },
  stringNativeIndexOf(env, [needle, haystack, start], cb) {
    cb(String.prototype.indexOf.call(needle, haystack, start))
  },
  stringNativeLastIndexOf(env, [needle, haystack, start], cb) {
    cb(String.prototype.lastIndexOf.call(needle, haystack, start))
  },
  stringNativeLength(env, [str], cb) { cb(('' + str).length) },
  stringUnicodeLength(env, [str], cb) { unicodeLength(str) },
  stringNativeSlice(env, [start, end, str], cb) { 
    cb(String.prototype.slice.call(str, start, end))
  },
  stringUnicodeSlice(env, [start, end, str], cb) { 
    let out = '', index = 0
    for (let c of '' + str) {
      if (index >= end) break
      else if (index >= start) out += c
      else index++
    }
    cb(out)
  },
  stringNativeCharAt(env, [index, str], cb) {
    cb(String.prototype.charAt.call(str, index))
  },
  stringUnicodeCharAt(env, [index, str], cb) {
    for (let c of '' + str) if (index-- <= 0) return cb(c)
    cb('')
  },
  stringUnicodeCodePointAt(env, [index, str], cb) {
    for (let c of '' + str) if (index-- <= 0) return cb(<any>c.codePointAt(0))
    cb(null)
  },
  stringNativeChars(env, [str], cb) {
    str = '' + str
    let out = new Array<string>(str.length)
    for (let i = 0; i < out.length; i++) out[i] = str.charAt(i)
    cb(out)
  },
  stringUnicodeChars(env, [str], cb) { cb([...str]) },
  stringUnicodeCodePoints(env, [str], cb) {
    cb([...str].map(c => c.codePointAt(0)))
  },
  stringNativeFromChars(env, [chars], cb) {
    cb(Array.prototype.reduce.call(chars, (a: string, b: string) => a + b, ''))
  },
  stringUnicodeFromCodePoints(env, [codePoints], cb) {
    cb(String.fromCodePoint(...codePoints))
  },
  stringNFC(env, [str], cb) {
    cb(String.prototype.normalize.call(str, 'NFC'))
  },
  stringNFD(env, [str], cb) {
    cb(String.prototype.normalize.call(str, 'NFD'))
  },
  stringNFKC(env, [str], cb) {
    cb(String.prototype.normalize.call(str, 'NFKC'))
  },
  stringNFKD(env, [str], cb) {
    cb(String.prototype.normalize.call(str, 'NFKD'))
  },

  // arrays
  arrayMake(env, [fn, len], cb) {
    const out = new Array<Deferred>(len)
    for (let i = 0; i < len; i++) {
      out[i] = env.defer({
        action: Action.Eval, code: [fn, i],
        fn: (env, cb) => call(env, fn, [i], cb)
      })
    }
    cb(out)
  },
  [Names.arrayConcat.slice(Names.prefix.length)](env, args, cb) {
    cb([].concat(...args))
  },
  arrayLength(env, [a], cb) { cb(a.length) },
  arraySlice(env, [start, end, a], cb) {
    cb(Array.prototype.slice.call(a, start, end))
  },

  // objects
  objectMake(env, [fn, keys], cb) {
    const out = Object.create(null)
    for (let k of keys) {
      out[k] = env.defer({
        action: Action.Eval, code: [fn, k],
        fn: (env, cb) => call(env, fn, [k], cb)
      })
    }
    cb(out)
  },
  objectHas(env, [key, obj], cb) { cb(has(obj, key)) },
  objectInsert(env, [key, val, obj], cb) {
    const out = Object.create(null)
    for (let oldKey in obj) out[oldKey] = obj[oldKey]
    out[key] = val
    cb(out)
  },
  objectDelete(env, [key, obj], cb) {
    const out = Object.create(null)
    for (let oldKey in obj) if (oldKey !== key) out[oldKey] = obj[oldKey]
    cb(out)
  },
  objectKeys(env, [obj], cb) { cb(Object.keys(obj)) },
  objectValues(env, [obj], cb) { cb(Object.keys(obj).map(k => obj[k])) }
}

export default mapKeys(fns, (v, k) => Names.prefix + k)
