import {Jaspr, JasprError, Deferred, Callback, toString, magicSymbol} from './Jaspr'
import {Env, Action, JasprDynamic, makeDynamic, DeferOptions, waitFor} from './Interpreter'
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

function actionToString(action: Action): string {
  switch (action) {
    case Action.Eval: return 'eval'
    case Action.MacroExpand: return 'macroexpand'
    case Action.Check: return 'check'
    case Action.Junction: return 'junction'
    case Action.Send: return 'send'
    case Action.Recv: return 'recv'
    case Action.External: return 'external'
  }
}

export type ErrorHandler =
  (root: RootFiber, err: Jaspr, raisedBy: Fiber, cb: Callback) => void

abstract class AbstractFiber extends Deferred implements Env {
  readonly dynamics: WeakMap<JasprDynamic, Jaspr | Deferred>
  readonly children = new Set<Fiber>()
  readonly action: Action
  readonly name?: string
  readonly code?: Jaspr | Deferred
  readonly closureName: string
  readonly signalHandlerVar: JasprDynamic
  readonly nameVar: JasprDynamic

  constructor(
    dynamics: WeakMap<JasprDynamic, Jaspr | Deferred> = new WeakMap(),
    action = Action.External,
    name?: string,
    code?: Jaspr | Deferred
  ) {
    super()
    this.dynamics = dynamics
    this.action = action
    this.name = name,
    this.code = code
  }
  
  defer(options: DeferOptions): Fiber {
    const parent =
      options.inherit && this.parent().action !== Action.Junction
      ? this.parent() : this
    const fiber = new Fiber(parent,
      options.dynamics
      ? new InheritWeakMap(options.dynamics, this.dynamics) : this.dynamics,
      options.action, options.name || this.name, options.code)
    parent.children.add(fiber)
    setImmediate(() => options.fn(fiber, fiber.resolve.bind(fiber)))
    fiber.await(() => parent.children.delete(fiber))
    return fiber
  }

  cancel(): void {
    super.cancel()
    for (let child of this.children) child.cancel()
    this.children.clear()
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

  descriptionString(color = true, history = new Set<AbstractFiber>()): string {
    if (history.has(this)) {
      return color ? chalk.redBright('(CYCLE DETECTED)') : '(CYCLE DETECTED)'
    }
    let str = actionToString(this.action)
    if (this.name) str += ` (in ${this.name})`
    const code = this.code instanceof Deferred && this.code.value !== undefined
                 ? this.code.value : this.code
    if (code !== undefined) {
      str += ':'
      if (code instanceof AbstractFiber) {
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

  stackTrace(): AbstractFiber[] {
    return [<AbstractFiber>this].concat(this.parent().stackTrace())
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

  abstract root(): RootFiber
  abstract parent(): AbstractFiber
  abstract unhandledError(err: Jaspr, cb: Callback): void
  abstract testFailure(err: Error): void
}

export class RootFiber extends AbstractFiber {
  readonly errorHandler: ErrorHandler
  readonly testFailureHandler: (err: Error) => void
  readonly closureName = this.gensym('closure')
  readonly signalHandlerVar = makeDynamic(
    new NativeFn(function rootErrorHandler(err) {
      const d = new Deferred()
      this.unhandledError(err, x => d.resolve(x))
      return d
    }).toClosure(this))
  readonly nameVar = makeDynamic(null)

  constructor(
    errorHandler: ErrorHandler =
      (root, err, raisedBy, cb) => {
        console.error(chalk.redBright('⚠ Unhandled Signal ⚠'))
        console.error(prettyPrint(err))
        console.error('\n' + chalk.gray('Stack trace:'))
        console.error(raisedBy.stackTraceString())
        root.cancel()
      },
    testFailure: (err: Error) => void =
      err => console.warn('Test assertion used outside of a unit test!')
  ) {
    super()
    this.errorHandler = errorHandler
    this.testFailureHandler = testFailure
  }
  
  descriptionString() { return 'root' }
  stackTrace(): AbstractFiber[] { return [this] }
  parent() { return this }
  root() { return this }
  unhandledError(err: Jaspr, cb: Callback) {
    this.errorHandler(this, err, <any>this, cb)
  }
  testFailure(err: Error): void { this.testFailureHandler(err) }
}

class Fiber extends AbstractFiber {
  _parent: AbstractFiber
  _root: RootFiber

  constructor(
    parent: AbstractFiber,
    dynamics: WeakMap<JasprDynamic, Jaspr | Deferred> = new WeakMap(),
    action = Action.External,
    name?: string,
    code?: Jaspr | Deferred
  ) {
    super(dynamics, action, name, code)
    this._parent = parent
    this._root = parent instanceof RootFiber ? parent : parent.root()

    // Debug information:
    //console.log(this.descriptionString())
    //this.await(v => console.log(prettyPrint(<Jaspr>this.code) + ' -> ' + prettyPrint(v)))
  }

  parent() { return this._parent }
  root() { return this._root }
  unhandledError(err: Jaspr, cb: Callback) {
    this._root.errorHandler(this._root, err, this, cb)
  }
  testFailure(err: Error) {this._root.testFailure(err)}

  toString() {
    if (this.value !== undefined) return `<resolved: ${toString(this.value)}>`
    else return `<unresolved: ${this.code === undefined ? '?' : toString(<Jaspr>this.code)}>`
  }

  get closureName() { return this._root.closureName }
  get signalHandlerVar() { return this._root.signalHandlerVar }
  get nameVar() { return this._root.nameVar }
}

namespace Fiber {
  export function newRoot(
    errorHandler?: ErrorHandler,
    testFailure?: (err: Error) => void
  ): RootFiber {
    return new RootFiber(errorHandler, testFailure)
  }
}

// https://gist.github.com/LeverOne/1308368
export function uuid(): string {
  let a: any, b: any
  for(b=a='';a++<36;b+=a*51&52?(a^15?8^Math.random()*(a^20?16:4):4).toString(16):'-');
  return b
}

export default Fiber
