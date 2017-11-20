import * as _ from 'lodash'
import * as async from 'async'
import * as Names from './ReservedNames'
import {reservedChar} from './Parser'

/** 
 * JSON data consists of `null`, booleans, numbers, strings, arrays, and objects.
 */
export type Json = null | boolean | number | string | JsonArray | JsonObject
/** An array containing only JSON values */
export interface JsonArray extends Array<Json> {}
/** An object containing only JSON values */
export interface JsonObject { [key: string]: Json }

/**
 * Jaspr data is JSON with one additional case: Deferred values, which are lazy
 * values that have not yet resolved.
 * 
 * Once all of the lazy values in Jaspr data are resolved and replaced with
 * their actual values, it is valid JSON.
 */
export type Jaspr = null | boolean | number | string | JasprArray | JasprObject
/** An array containing only Jaspr values */
export interface JasprArray extends Array<Jaspr | Deferred> {}
/** An object containing only Jaspr values */
export interface JasprObject { [key: string]: Jaspr | Deferred }

/** Magic Jaspr values contain extra data stored in a hidden Symbol property. */
export const magicSymbol = Symbol("magic")

export type Err =
  'NoBinding' | 'NoKey' | 'NoMatch' | 'BadName' | 'BadArgs' | 'BadModule' |
  'BadPattern' | 'NotCallable' | 'NoPrimitive' | 'NotJSON' | 'ChanClosed' |
  'ParseFailed' | 'EvalFailed' | 'ReadFailed' | 'WriteFailed' | 'NativeError' |
  'NotImplemented'

export interface JasprError extends JasprObject {
  err: Err, why: string
}

export type Callback = (x: Jaspr) => void
export type ErrCallback = (err: JasprError | null, x: Jaspr) => void

/** 
 * A Deferred object is a lazy value. It is a simplified promise, without
 * chaining, error handling, or any of the other ES2015 Promise features.
 */
export class Deferred /*implements PromiseLike<Jaspr>*/ {
  value: Jaspr | undefined = undefined
  listeners: Callback[] = []
  canceled: boolean = false

  constructor() {}

  /** 
   * Calls `cb` when the Deferred value is available. May call it immediately
   * (synchronously) if it has already resolved.
   */
  await(cb: Callback): void {
    if (this.canceled) return
    if (this.value === undefined) this.listeners.push(cb)
    else cb(this.value)
  }

  /**
   * Resolves this Deferred value with an actual value. Throws an exception if
   * this Deferred has already been resolved.
   */
  resolve(value: Jaspr): void {
    if (this.canceled) return
    if (this.value === undefined) {
      this.value = value
      for (let listener of this.listeners) listener(value)
      this.listeners = []
    } else throw new Error(
      `Double resolve of Deferred (old: ${toString(this.value)}, new: ${toString(value)})`)
  }

  cancel(): void {
    this.listeners = []
    this.canceled = true
  }

  toString() {
    if (this.canceled) return "(canceled)"
    else if (this.value === undefined) return "(unresolved)"
    else return `(resolved: ${toString(this.value)})`
  }

  /*then<T, E>(
    onFulfilled: (x: Jaspr) => T | PromiseLike<T>,
    onRejected?: (e: Error) => E | PromiseLike<E>
  ) : PromiseLike<T | E> {
    if (this.canceled) {
      const err = new Error(`Cannot resolve ${this}; it is canceled`)
      if (onRejected) return Promise.resolve(onRejected(err))
      else return Promise.reject(err)
    } else return new Promise(resolve =>
      this.await(v => resolve(onFulfilled(v))))
  }*/
}

export const isArray: (it: Jaspr) => it is JasprArray = Array.isArray
export function isObject(it: Jaspr): it is JasprObject {
  return typeof it === 'object' && it != null && !isArray(it) &&
         !(it instanceof Deferred)
}
export function isMagic(it: Jaspr) {
  return isObject(it) && magicSymbol in it
}
export function toBool(a: Jaspr): boolean {
  if (typeof a === 'boolean') return a
  else if (typeof a === 'number') return a !== 0
  else if (typeof a === 'string') return a !== ""
  else if (isArray(a)) return a.length > 0
  else if (isObject(a)) return Object.keys(a).length > 0
  else return !!a
}

export function getIndex(index: number, array: JasprArray, cb: ErrCallback): void {
  const it = array[index]
  if (it === undefined) {
    cb({err: 'NoKey', why: 'array index out of bounds', key: index, in: array,}, null)
  } else if (it instanceof Deferred) {
    it.await(v => {array[index] = v; cb(null, v)})
  } else cb(null, it)
}

export function getKey(key: string, object: JasprObject, cb: ErrCallback): void {
  const it = object[key]
  if (it === undefined || _.isFunction(it)) {
    cb({err: 'NoKey', why: 'key not found in object', key, in: object}, null)
  } else if (it instanceof Deferred) {
    it.await(v => {object[key] = v; cb(null, v)})
  } else cb(null, it)
}

export function resolveArray(array: JasprArray, cb: (x: Jaspr[]) => void): void {
  async.eachOf(array, (x: Jaspr | Deferred, i: number, cb: ErrorCallback<null>) => {
    if (x instanceof Deferred) x.await(v => {array[i] = v; cb(null)})
    else cb(null)
  }, () => cb(<Jaspr[]>array))
}

export function resolveObject(object: JasprObject, cb: (x: {[k: string]: Jaspr}) => void): void {
  async.eachOf(object, (x: Jaspr | Deferred, k: string, cb: ErrorCallback<null>) => {
    if (x instanceof Deferred) x.await(v => {object[k] = v; cb(null)})
    else cb(null)
  }, () => cb(<{[k: string]: Jaspr}>object))
}

export function resolveFully(root: Jaspr, cb: ErrCallback, jsonOnly = false): void {
  let pending = 1, stack: Jaspr[] = [], history = new Set<JasprObject>()
  function loop(toPush: Jaspr) {
    pending--
    stack.push(toPush)
    try {
      while (stack.length > 0) {
        const x = <Jaspr>stack.pop()
        if (isArray(x)) {
          for (let i = 0; i < x.length; i++) {
            const el = x[i]
            if (el instanceof Deferred) {
              pending++
              el.await(resolved => {
                x[i] = resolved
                setImmediate(loop, resolved)
              })
            } else stack.push(el)
          }
        } else if (jsonOnly && isMagic(x)) {
          throw {err: 'NotJSON', why: 'No JSON representation for magic object', value: x}
        } else if (isObject(x) && !history.has(x)) {
          history.add(x)
          for (let k in x) {
            const el = x[k]
            if (el instanceof Deferred) {
              pending++
              el.await(resolved => {
                x[k] = resolved
                setImmediate(loop, resolved)
              })
            } else stack.push(el)
          }
        }
      }
    } catch (ex) {
      if (ex instanceof Error) throw ex
      else return cb(ex, null)
    }
    if (pending <= 0) return cb(null, root)
  }
  loop(root)
}

export function has(obj: {}, key: string): boolean {
  for (let proto = obj; proto != null; proto = Object.getPrototypeOf(proto)) {
    if (Object.prototype.propertyIsEnumerable.call(proto, key)) return true
  }
  return false
}

export function toJson(x: Jaspr, cb: (err: JasprObject | null, json: Json) => void): void {
  return resolveFully(x, cb, true)
}

function quoteString(str: string): string {
  let out = '“'
  for (let c of str) switch (c) {
    case '\n': out += '\\n'; break
    case '\r': out += '\\r'; break
    case '\f': out += '\\f'; break
    case '\v': out += '\\v'; break
    case '“': out += '\\“'; break
    case '”': out += '\\”'; break
    case '\\': out += '\\\\'; break
    default: out += c
  }
  return out + '”'
}

export function toString(it: Jaspr, bareString = false, alwaysQuote = false): string {
  if (isMagic(it)) {
    return '(magic)'
  } else if (isObject(it)) {
    return `{${_.join(_.toPairs(it).map(([k, v]) => toString(k) + ': ' + toString(v)), ', ')}}`
  } else if (isArray(it)) {
    return `[${_.join(it.map(x => toString(<Jaspr>x)), ', ')}]`
  } else if (typeof it === 'string') {
    if (bareString) return it
    if (alwaysQuote || it === '' || reservedChar.test(it) || it !== it.normalize('NFKC')) {
      return quoteString(it)
    } else return it
  } else if (it instanceof Deferred && it.value !== undefined) {
    return toString(it.value)
  } else {
    return '' + it
  }
}
