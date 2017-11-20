import {
  Jaspr, JasprArray, JasprObject, Callback, Deferred, resolveArray, magicSymbol
} from './Jaspr'
import {Env, raise, waitFor} from './Interpreter'
import * as Names from './ReservedNames'

export type Fn = (this: Env, ...args: Jaspr[]) => Jaspr|Deferred

export class NativeFn {
  readonly source: string
  readonly fn: Fn

  constructor(fn: Fn | string, ...rest: string[]) {
    if (typeof fn === 'string') {
      this.source = fn
      this.fn = <Fn>new Function(fn, ...rest)
    } else {
      this.source = fn.toString()
      this.fn = fn
    }
  }

  call(env: Env, args: JasprArray, cb: Callback): void {
    resolveArray(args, args => waitFor(this.fn.apply(env, args), cb))
  }

  toClosure(env: Env): JasprObject {
    return {
      [env.closureName]: {},
      [Names.code]: [`${Names.primitiveModule}.${Names.apply}`,
                     [Names.js, this.source],
                     Names.args],
      [magicSymbol]: this
    }
  }

  toString() {
    return `Native function (${this.source})`
  }
}
