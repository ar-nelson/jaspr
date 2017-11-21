import {
  Jaspr, JasprError, Deferred, Callback, toString, isArray, magicSymbol
} from './Jaspr'
import {
  Env, DeferProperties, JasprDynamic, makeDynamic, waitFor
} from './Interpreter'
import prettyPrint from './PrettyPrint'
import * as Names from './ReservedNames'
import {NativeFn} from './NativeFn'
import Chan from './Chan'
import chalk from 'chalk'

class InheritWeakMap<K extends object, V> extends WeakMap<K, V> {
  readonly parent: WeakMap<K, V>

  constructor(elements: Iterable<[K, V]>, parent: WeakMap<K, V>) {
    super(elements)
    this.parent = parent
  }

  get(key: K): V | undefined {
    const mine = super.get(key)
    if (mine === undefined) return this.parent.get(key)
    else return mine
  }

  has(key: K): boolean {
    return super.has(key) || this.parent.has(key)
  }

  toString(): string {
    return super.toString() + '; ' + this.parent.toString()
  }
}

class Fuse {
  canceled = false
  listeners = new Set<() => void>()
  cancel() {
    if (!this.canceled) {
      this.canceled = true
      for (let listener of this.listeners) listener()
      this.listeners.clear()
    }
  }
  onCancel(listener: () => void) {
    if (!this.canceled) this.listeners.add(listener)
  }
  removeOnCancel(listener: () => void) {
    if (!this.canceled) this.listeners.delete(listener)
  }
  isCanceled() { return this.canceled }
}

class Fiber extends Deferred implements Env {
  readonly root: RootFiber
  readonly parent: Fiber
  readonly dynamics: WeakMap<JasprDynamic, Jaspr | Deferred>
  readonly fuse: Fuse
  readonly props: () => DeferProperties

  constructor(
    parent: Fiber | null,
    fuse: Fuse,
    dynamics: WeakMap<JasprDynamic, Jaspr | Deferred> = new WeakMap(),
    props: () => DeferProperties = () => ({action: 'external'})
  ) {
    super()
    if (parent) {
      this.parent = parent
      this.root = parent.root
    } else if (this instanceof RootFiber) {
      this.parent = this.root = this
    } else {
      throw new Error('Non-root fiber must have a parent fiber')
    }
    this.fuse = fuse
    this.dynamics = dynamics
    this.props = props

    // Debug information:
    //console.log(this.descriptionString())
    //this.await(v => console.log(prettyPrint(<Jaspr>this.code) + ' -> ' + prettyPrint(v)))
  }

  isCanceled() { return this.fuse.canceled }
  
  defer(
    fn: (env: Env, cb: Callback) => void,
    props: () => DeferProperties = () => ({action: 'external'}),
    inherit = false,
    dynamics: [JasprDynamic, Jaspr | Deferred][] = []
  ): Fiber {
    const parent = inherit ? this.parent : this
    const fiber = new Fiber(parent, this.fuse,
      dynamics.length > 0 ? new InheritWeakMap(dynamics, this.dynamics)
                          : this.dynamics,
      props)
    setImmediate(() => fn(fiber, fiber.resolve.bind(fiber)))
    return fiber
  }

  junction(
    fns: ((env: Env, cb: Callback) => void)[],
    props: () => DeferProperties = () => ({action: 'junction'}),
    inherit = false
  ): Fiber {
    const parent = inherit ? this.parent : this
    const junction = new Fiber(parent, this.fuse, this.dynamics, props)
    const branches = fns.map((fn, i): [Fuse, Fiber] => {
      const fuse = new Fuse()
      const fiber = new Fiber(junction, fuse, this.dynamics, () => ({
        action: 'eval',
        code: (() => {
          let {code} = props()
          if (code instanceof Deferred) {
            if (code.value !== undefined) code = code.value
            else return undefined
          }
          return code && isArray(code) ? code[i + 1] : undefined
        })()
      }))
      setImmediate(() => fn(fiber, fiber.resolve.bind(fiber)))

      // Once one branch resolves, the others should be canceled.
      fiber.await(result => {
        branches.forEach(([fuse, _], j) => {if (i !== j) fuse.cancel()})
        junction.resolve(result)
      })

      // Cancellations should cascade to also cancel child junctions, but the
      // listeners that cause these cascading cancelations should be removed as
      // soon as they are unnecessary, to avoid memory leaks.
      const cancel = () => fuse.cancel()
      this.fuse.onCancel(cancel)
      fuse.onCancel(() => this.fuse.removeOnCancel(cancel))
      fiber.await(() => this.fuse.removeOnCancel(cancel))

      return [fuse, fiber]
    })
    return junction
  }

  onCancel(listener: () => void) {
    if (!this.isCanceled() && this.value === undefined) {
      this.fuse.onCancel(listener)
      this.await(() => this.fuse.removeOnCancel(listener))
    }
  }

  getDynamic(dyn: JasprDynamic, cb: Callback): void {
    let val = this.dynamics.get(dyn)
    if (val === undefined) val = dyn.$default
    waitFor(val, cb)
  }

  gensym(name?: string) {
    const id = uuid()
    return name ? name + '$' + id : id
  }

  descriptionString(color = true, history = new Set<Fiber>()): string {
    if (history.has(this)) {
      return color ? chalk.redBright('(CYCLE DETECTED)') : '(CYCLE DETECTED)'
    }
    let {action: str, code, name} = this.props()
    code = code instanceof Deferred && code.value !== undefined
                ? code.value : code
    if (name) str += ` (in ${name})`
    if (code !== undefined) {
      str += ':'
      if (code instanceof Fiber) {
        str += color ? chalk.gray(' waiting on result of…')
                     : ' waiting on result of…'
        str += '\n  '
        history.add(this)
        str += code.descriptionString(color, history).replace(/\n/gm, '\n  ')
      } else if (code instanceof Deferred) {
        str += color ? chalk.gray(` waiting on result of ${code}`)
                     : ` waiting on result of ${code}`
      } else {
        str += ' ' + prettyPrint(code, color)
      }
    }
    if (this.value !== undefined) {
      str += '\n'
      str += color ? chalk.yellowBright('resolved to:') : 'resolved to:'
      str += ' ' + prettyPrint(this.value, color)
    }
    return str
  }

  stackTrace(): Fiber[] {
    return [<Fiber>this].concat(this.parent.stackTrace())
  }

  stackTraceString(color = true): string {
    const trace = this.stackTrace()
    let str = trace[0].descriptionString(color)
    for (let i = 1; i < trace.length; i++) {
      const branch = i === trace.length - 1 ? '└ ' : '├ '
      str += '\n' + (color ? chalk.gray(branch) : branch)
      str += trace[i].descriptionString(color).replace(/\n/gm,
        '\n' + (i === trace.length - 1 ? '  ' : (color ? chalk.gray('│ ') : '│ ')))
    }
    return str
  }
  
  get closureName(): string { return this.root.closureName }
  get signalHandlerVar(): JasprDynamic { return this.root.signalHandlerVar }
  get nameVar(): JasprDynamic { return this.root.nameVar }

  unhandledError(err: Jaspr, cb: Callback) {
    this.root.errorHandler(this.root, err, this, cb)
  }

  toString() {
    if (this.value !== undefined) return `<resolved: ${toString(this.value)}>`
    else {
      const {code} = this.props()
      return `<unresolved: ${code === undefined ? '?' : toString(<Jaspr>code)}>`
    }
  }
}

export type ErrorHandler =
  (root: RootFiber, err: Jaspr, raisedBy: Fiber, cb: Callback) => void

export class RootFiber extends Fiber {
  readonly errorHandler: ErrorHandler

  constructor(
    errorHandler: ErrorHandler =
      (root, err, raisedBy, cb) => {
        console.error(chalk.redBright('⚠ Unhandled Signal ⚠'))
        console.error(prettyPrint(err))
        console.error('\n' + chalk.gray('Stack trace:'))
        console.error(raisedBy.stackTraceString())
        root.fuse.cancel()
      }
  ) {
    super(null, new Fuse(), new WeakMap(), () => ({action: 'root'}))
    this.errorHandler = errorHandler
  }

  cancel() { this.fuse.cancel() }
  deferCancelable(
    fn: (env: Env, cb: Callback) => void,
    dynamics: [JasprDynamic, Jaspr | Deferred][] = []
  ): {fiber: Fiber, cancel: () => void} {
    const fuse = new Fuse()
    const fiber = new Fiber(this, fuse, new WeakMap(dynamics))
    setImmediate(() => fn(fiber, fiber.resolve.bind(fiber)))
    return {fiber, cancel: () => fuse.cancel()}
  }

  descriptionString() { return 'root' }
  stackTrace(): Fiber[] { return [this] }
  unhandledError(err: Jaspr, cb: Callback) {
    this.errorHandler(this, err, <any>this, cb)
  }

  readonly _closureName = this.gensym('closure')
  readonly _signalHandlerVar = makeDynamic(
    new NativeFn(function rootErrorHandler(err) {
      return this.defer(this.unhandledError.bind(this))
    }).toClosure(this))
  readonly _nameVar = makeDynamic(null)
  get closureName() { return this._closureName }
  get signalHandlerVar() { return this._signalHandlerVar }
  get nameVar() { return this._nameVar }
}

namespace Fiber {
  export function newRoot(errorHandler?: ErrorHandler): RootFiber {
    return new RootFiber(errorHandler)
  }
}

// https://gist.github.com/LeverOne/1308368
export function uuid(): string {
  let a: any, b: any
  for(b=a='';a++<36;b+=a*51&52?(a^15?8^Math.random()*(a^20?16:4):4).toString(16):'-');
  return b
}

export default Fiber
