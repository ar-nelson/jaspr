import {
  Jaspr, JasprArray, JasprObject, JasprError, Callback, Deferred, magicSymbol
} from './Jaspr'
import {Env} from './Interpreter'
import * as Names from './ReservedNames'

export type SyncFn = (this: Env, ...args: Jaspr[]) => Jaspr
export type AsyncFn = (this: Env, args: Jaspr[], cb: AsyncResultCallback<Jaspr, JasprError>) => void

export abstract class NativeFn {
  readonly source: string[]
  constructor(source: string[]) {this.source = source}
  abstract call(env: Env, args: Jaspr[], cb: AsyncResultCallback<Jaspr, JasprError>): void
  abstract toClosure(env: Env): JasprObject
  arity() {return this.source.length - 1}
  toString() { return `Native function (${this.source})` }
}

export class NativeSyncFn extends NativeFn {
  readonly fn: SyncFn

  constructor(fn: SyncFn | string, ...rest: string[]) {
    if (typeof fn === 'string') {
      super([fn, ...rest])
      this.fn = <SyncFn>new Function(fn, ...rest)
    } else {
      super([...new Array(fn.length).fill(''), fn.toString()])
      this.fn = fn
    }
  }

  call(env: Env, args: Jaspr[], cb: AsyncResultCallback<Jaspr, JasprError>) {
    let result: Jaspr
    try {result = this.fn.apply(env, args)}
    catch (err) {
      if (err instanceof Error) {
        return cb({err: 'NativeError', why: err.toString()})
      } else return cb(err)
    }
    cb(undefined, result)
  }

  toClosure(env: Env): JasprObject {
    return {
      [env.closureName]: {},
      [Names.code]: [[Names.jsSync, ...this.source],
                     ...new Array(this.arity()).map((v, i) => [i, Names.args])],
      [magicSymbol]: this
    }
  }
}

export class NativeAsyncFn extends NativeFn {
  readonly fn: AsyncFn

  constructor(fn: AsyncFn | string, ...rest: string[]) {
    if (typeof fn === 'string') {
      super([fn, ...rest])
      this.fn = <AsyncFn>new Function(fn, ...rest)
    } else {
      super([...new Array(fn.length).fill(''), fn.toString()])
      this.fn = fn
    }
  }
  
  call(env: Env, args: Jaspr[], cb: AsyncResultCallback<Jaspr, JasprError>) {
    this.fn.call(env, args, cb)
  }

  toClosure(env: Env): JasprObject {
    return {
      [env.closureName]: {},
      [Names.code]: [[Names.jsAsync, ...this.source],
                     ...new Array(this.arity()).map((v, i) => [i, Names.args])],
      [magicSymbol]: this
    }
  }
}
