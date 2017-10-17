import * as _ from 'lodash'
import * as async from 'async'
import {magicPrefix, reservedChars} from './Parse'

export const currentSchema = "http://adam.nels.onl/schema/jaspr/module"

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

export interface Scope extends JasprObject {
  value: JasprObject
  macro: JasprObject
  check: JasprObject
  test: JasprObject
  doc: { [name: string]: string }
  qualified: { [name: string]: string }
}
export const emptyScope: Scope =
  {value: {}, macro: {}, check: {}, doc: {}, test: {}, qualified: {}}

/** 
 * A closure, with magic `$closure` property containing the closed-over lexical
 * context. If it is an executable closure (a function), it will also have a
 * `$code` property containing the executable Jaspr code of the function.
 */
export interface JasprClosure extends JasprObject {
  "$closure": Scope
}

export type Callback = (x: Jaspr) => void
export type ErrCallback = (err: JasprObject | null, x: Jaspr) => void

/** 
 * A Deferred object is a lazy value. It is a simplified promise, without
 * chaining, error handling, or any of the other ES2015 Promise features.
 */
export class Deferred {
  value: Jaspr | undefined = undefined
  listeners: Callback[] = []
  canceled: boolean = false

  constructor() {}

  /** 
   * Calls `cb` when the Deferred value is available. May call it immediately
   * (synchronously) if it has already resolved.
   */
  await(cb: Callback): void {
    if (this.canceled) throw new Error(`Cannot resolve ${this}; it is canceled`)
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
}

/** The name of the property that stores a closure's lexical scope */
export const scopeKey = magicPrefix + "closure"
/** The name of the property that stores a closure's executable code */
export const codeKey = magicPrefix + "code"
/** The name of the variable containing the most recent function call's arguments */
export const argsKey = magicPrefix + "args"

export const isArray: (it: Jaspr) => it is JasprArray = Array.isArray
export function isObject(it: Jaspr): it is JasprObject {
  return _.isPlainObject(it)
}
export function isClosure(it: Jaspr): it is JasprClosure {
  return isObject(it) && it.hasOwnProperty(scopeKey)
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
    cb({err: 'array index out of bounds', array, index}, null)
  } else if (it instanceof Deferred) {
    it.await(v => {array[index] = v; cb(null, v)})
  } else cb(null, it)
}

export function getKey(key: string, object: JasprObject, cb: ErrCallback): void {
  const it = object[key]
  if (it === undefined || _.isFunction(it)) {
    cb({err: 'key not found in object', key, object}, null)
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

export function resolveFully(x: Jaspr, cb: ErrCallback, jsonOnly = false): void {
  if (isArray(x)) {
    resolveArray(x, xs => async.each(xs,
      (x, cb: ErrCallback) => resolveFully(x, cb, jsonOnly),
      () => cb(null, xs)))
  } else if (jsonOnly && isClosure(x)) {
    cb({err: "No JSON representation for closure", closure: x}, null)
  } else if (isObject(x)) {
    resolveObject(x, xs => async.eachOf(xs,
      (x: Jaspr, k: string, ecb: ErrorCallback<JasprObject | null>) => {
        if (k === scopeKey) ecb(null)
        else resolveFully(x, ecb, jsonOnly)
      }, () => cb(null, xs)))
  } else cb(null, x)
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
    default: out += c
  }
  return out + '”'
}

export function toString(it: Jaspr, bareString = false): string {
  if (isClosure(it)) {
    return '(closure)'
  } else if (isObject(it)) {
    return `{${_.join(_.toPairs(it).map(([k, v]) => toString(k) + ': ' + toString(v)), ', ')}}`
  } else if (isArray(it)) {
    return `[${_.join(it.map(x => toString(<Jaspr>x)), ', ')}]`
  } else if (typeof it === 'string') {
    if (bareString) return it
    for (let c of it) if (reservedChars.has(it)) return quoteString(it)
    if (it !== it.normalize('NFKC')) return quoteString(it)
    return it
  } else {
    return "" + it
  }
}
