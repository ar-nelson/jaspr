import * as _ from 'lodash'
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

/** Well-known error types */
export type Err =
  'NoBinding' | 'NoKey' | 'NoMatch' | 'BadName' | 'BadArgs' | 'BadModule' |
  'BadPattern' | 'NotCallable' | 'NoPrimitive' | 'NotJSON' | 'ParseFailed' |
  'EvalFailed' | 'ReadFailed' | 'WriteFailed' | 'NativeError' |
  'NotImplemented' | 'AssertFailed'

/** An error signal object */
export interface JasprError extends JasprObject {
  /** The error type */
  err: Err
  /** The error message */
  why: string
}

/** A basic Jaspr callback, with no error argument */
export type Callback = (x: Jaspr) => void

/** A Node-style callback with an error argument */
export type ErrCallback<T> = (err: JasprError | null, x: T | null) => void

/** 
 * A Deferred object is a lazy value. It is a simplified promise, without
 * chaining, error handling, or any of the other ES2015 Promise features.
 */
export abstract class Deferred {
  value: Jaspr | undefined = undefined
  listeners: Callback[] = []

  abstract isCanceled(): boolean

  /** 
   * Calls `cb` when the Deferred value is available. May call it immediately
   * (synchronously) if it has already resolved.
   */
  await(cb: Callback): void {
    if (this.isCanceled()) {
      this.listeners = []
      return
    }
    if (this.value === undefined) this.listeners.push(cb)
    else cb(this.value)
  }

  /**
   * Resolves this Deferred value with an actual value. Throws an exception if
   * this Deferred has already been resolved.
   */
  resolve(value: Jaspr): void {
    if (this.isCanceled()) {
      this.listeners = []
      return
    }
    if (this.value === undefined) {
      this.value = value
      for (let listener of this.listeners) listener(value)
      this.listeners = []
    } else throw new Error(
      `Double resolve of Deferred (old: ${toString(this.value)}, new: ${toString(value)})`)
  }

  toString() {
    if (this.value === undefined) return "(unresolved)"
    else return `(resolved: ${toString(this.value)})`
  }
}

/** Tests whether a Jaspr value is an array */
export const isArray: (it: Jaspr) => it is JasprArray = Array.isArray

/** Tests whether a Jaspr value is an object */
export function isObject(it: Jaspr): it is JasprObject {
  return typeof it === 'object' && it != null && !isArray(it) &&
         !(it instanceof Deferred)
}

/** Tests whether a Jaspr value is a magic object */
export function isMagic(it: Jaspr) {
  return isObject(it) && magicSymbol in it
}

/**
 * Returns the boolean value (_truthiness_) of a Jaspr value. `null`, `false`,
 * `0`, `NaN`. `""`, `[]`, and `{}` are _falsy_; all other values are _truthy_.
 */
export function toBool(it: Jaspr): boolean {
  if (typeof it === 'boolean') return it
  else if (typeof it === 'number') return it !== 0 && !isNaN(it)
  else if (typeof it === 'string') return it !== ""
  else if (isArray(it)) return it.length > 0
  else if (isObject(it)) return Object.keys(it).length > 0
  else return !!it
}

/**
 * Deeply searches `root` for {@link Deferred} values and waits for all of them
 * to resolve, then passes the fully-resolved `root` to the callback `cb`.
 * 
 * @param root The value to resolve.
 * @param cb Callback that will be called when `root` has fully resolved. If
 *   `jsonOnly` is `true`, `cb` may be called with an error instead.
 * @param jsonOnly If true, `cb` will be called with an error if `root` contains
 *   any magic objects that are not valid JSON.
 */
export function resolveFully(root: Jaspr, cb: ErrCallback<Jaspr>, jsonOnly = false): void {
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

/**
 * Tests whether `key` is a Jaspr-accessible key in `obj` (that is, an
 * enumerable key in `obj` or any of its prototypes).
 * 
 * This is needed because Jaspr uses prototypes to merge objects in some cases,
 * such as extending scopes with new definitions.
 * 
 * @param obj The object that may contain `key`.
 * @param key The key to test for.
 */
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

/**
 * Returns a string representation of `it`.
 * 
 * The returned string will be *mostly* valid Jaspr, except for unparseable
 * string representations of magic objects or unresolved {@link Deferred}
 * values.
 * 
 * @param it The Jaspr value to return the string representation of.
 * @param bareString If true, if `it` is a string then the returned string will
 *   just be `it`, unchanged. Useful for print functions.
 * @param alwaysQuote If true, strings in the returned string will always be
 *   quoted. By default, `toString` only quotes strings if it is syntactically
 *   necessary.
 */
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
