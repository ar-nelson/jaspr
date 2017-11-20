import {Jaspr, JasprArray, JasprObject, Callback, Deferred, magicSymbol} from './Jaspr'
import {Env, raise, waitFor} from './Interpreter'
import * as Names from './ReservedNames'

const GeneratorFunction = Object.getPrototypeOf(function*():any{}).constructor

export type Fn = (this: Env, ...args: (Jaspr|Deferred)[]) => IterableIterator<Jaspr|Deferred>

export class NativeFn {
  readonly source: string
  readonly fn: Fn

  constructor(fn: Fn | string, ...rest: string[]) {
    if (typeof fn === 'string') {
      this.source = fn
      this.fn = <Fn>new GeneratorFunction(fn, ...rest)
    } else {
      this.source = fn.toString()
      this.fn = fn
    }
  }

  call(env: Env, args: JasprArray, cb: Callback): void {
    const iter: IterableIterator<Jaspr | Deferred> = this.fn.apply(env, args)
    function onYield({value, done}: IteratorResult<Jaspr | Deferred>) {
      waitFor(value, resolved => {
        if (done) return cb(resolved)
        let result: IteratorResult<Jaspr | Deferred>
        try {result = iter.next(resolved)} catch (err) {
          return raise(env, err instanceof Error ? {
            err: 'NativeError', why: `${err.name}: ${err.message}`,
            args, stack: err.stack
          } : err, cb)
        }
        onYield(result)
      })
    }
    onYield(iter.next())
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
