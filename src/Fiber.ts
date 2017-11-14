import {Jaspr, JasprError, JasprDynamic, Deferred, Callback, toString} from './Jaspr'
import {Env, Action, Dynamics, DeferOptions, waitFor} from './Interpreter'
import * as Names from './ReservedNames'
import {uuid} from './BuiltinFunctions'
import Chan from './Chan'

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

abstract class AbstractFiber extends Deferred implements Env {
  readonly dynamics: WeakMap<JasprDynamic, Jaspr | Deferred>
  readonly children = new Set<Fiber>()
  readonly action: Action
  readonly code?: Jaspr | Deferred

  constructor(
    dynamics: WeakMap<JasprDynamic, Jaspr | Deferred> = new WeakMap(),
    action = Action.External,
    code?: Jaspr | Deferred
  ) {
    super()
    this.dynamics = dynamics
    this.action = action
    this.code = code
  }
  
  defer(options: DeferOptions): Fiber {
    const parent =
      options.inherit && this.parent().action !== Action.Junction
      ? this.parent() : this
    const fiber = new Fiber(parent,
      options.dynamics
      ? new InheritWeakMap(options.dynamics, this.dynamics) : this.dynamics,
      options.action, options.code)
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

  abstract root(): RootFiber
  abstract parent(): AbstractFiber
  abstract unhandledError(err: Jaspr, cb: Callback): void
  abstract testFailure(err: Error): void
}

export class RootFiber extends AbstractFiber {
  readonly errorHandler: (root: RootFiber, err: Jaspr, cb: Callback) => void
  readonly testFailureHandler: (err: Error) => void

  constructor(
    errorHandler: (root: RootFiber, err: Jaspr, cb: Callback) => void =
      (root, err, cb) => {
        console.error('⚠ Unhandled Signal ⚠')
        console.error(toString(err))
        root.cancel()
      },
    testFailure: (err: Error) => void =
      err => console.warn('Test assertion used outside of a unit test!')
  ) {
    super()
    this.errorHandler = errorHandler
    this.testFailureHandler = testFailure
  }

  parent() { return this }
  root() { return this }

  unhandledError(err: Jaspr, cb: Callback): void {
    this.errorHandler(this, err, cb)
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
    code?: Jaspr | Deferred
  ) {
    super(dynamics, action, code)
    this._parent = parent
    this._root = parent instanceof RootFiber ? parent : parent.root()

    // Debug information:
    //console.log(this.toString())
    //this.await(v => console.log(toString(<Jaspr>this.code) + ' -> ' + toString(v)))
  }

  parent() { return this._parent }
  root() { return this._root }

  unhandledError(err: Jaspr, cb: Callback) {this._root.unhandledError(err, cb)}
  testFailure(err: Error) {this._root.testFailure(err)}

  toString() {
    if (this.value !== undefined) return '<resolved: ' + toString(this.value) + '>'
    else return '<unresolved: ' + (this.code === undefined ? '?' : toString(<Jaspr>this.code)) + '>'
  }
}

namespace Fiber {
  export function newRoot(
    errorHandler?: (root: RootFiber, err: Jaspr, cb: Callback) => void,
    testFailure?: (err: Error) => void
  ): RootFiber {
    return new RootFiber(errorHandler, testFailure)
  }
}

export default Fiber
