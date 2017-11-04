import {Jaspr, Deferred, Callback, toString} from './Jaspr'
import {Env, Action, Dynamics, DeferOptions, JasprError, waitFor} from './Interpreter'
import * as Names from './ReservedNames'
import {uuid} from './BuiltinFunctions'
import Chan from './Chan'

abstract class AbstractFiber extends Deferred implements Env {
  readonly dynamics: Map<number, Jaspr | Deferred>
  readonly children = new Set<Fiber>()
  readonly action: Action
  readonly code?: Jaspr | Deferred

  constructor(
    dynamics: Map<number, Jaspr | Deferred> = new Map(),
    action = Action.External,
    code?: Jaspr | Deferred
  ) {
    super()
    this.dynamics = dynamics
    this.action = action
    this.code = code
  }
  
  defer(options: DeferOptions): Fiber {
    if (options.inherit) {
      options.inherit = false
      return this.parent().defer(options)
    }
    const dynamics = options.dynamics
      ? new Map<number, Jaspr | Deferred>([...this.dynamics, ...options.dynamics])
      : this.dynamics
    const fiber = new Fiber(this, dynamics, options.action, options.code)
    this.children.add(fiber)
    setImmediate(() => options.fn(fiber, fiber.resolve.bind(fiber)))
    fiber.await(() => this.children.delete(fiber))
    return fiber
  }

  cancel(): void {
    super.cancel()
    for (let child of this.children) child.cancel()
    this.children.clear()
  }

  getDynamic(dyn: number, cb: (err?: JasprError, val?: Jaspr) => void): void {
    let val = this.dynamics.get(dyn)
    if (val === undefined) val = this.root().dynamics.get(dyn)
    if (val !== undefined) waitFor(val, x => cb(undefined, x))
    else cb({err: 'undefined dynamic variable', dynamic: dyn})
  }

  abstract root(): RootFiber
  abstract parent(): AbstractFiber
  abstract unhandledError(err: Jaspr, cb: Callback): void
  abstract processId(): string
  abstract makeChan(cb: (chan: number) => void): void
  abstract send(chan: number, value: Jaspr, cb: (sent: boolean) => void): void
  abstract recv(chan: number, cb: (err?: JasprError, val?: Jaspr) => void): void
  abstract closeChan(chan: number, cb: (closed: boolean) => void): void
  abstract isChanClosed(chan: number, cb: (closed: boolean) => void): void
  abstract makeDynamic(defaultValue: Jaspr, cb: (dyn: number) => void): void
}

export class RootFiber extends AbstractFiber {
  nextDynamic = 0
  nextChannel = 0
  readonly channels = new Map<number, Chan>()
  readonly id = uuid()
  readonly errorHandler: (root: RootFiber, err: Jaspr, cb: Callback) => void

  constructor(
    errorHandler: (root: RootFiber, err: Jaspr, cb: Callback) => void =
      (root, err, cb) => {
        console.error('⚠ Unhandled Exception ⚠')
        console.error(toString(err))
        root.cancel()
      }
  ) {
    super(new Map<number, Jaspr>([
      [Dynamics.error, {
        [Names.closure]: {},
        [Names.code]: [Names.unhandledError, [0, Names.args]]
      }]
    ]))
    this.errorHandler = errorHandler
  }

  parent() { return this }
  root() { return this }

  unhandledError(err: Jaspr, cb: Callback): void {
    this.errorHandler(this, err, cb)
  }
  
  processId() { return this.id }

  makeChan(cb: (chan: number) => void): void {
    const n = this.nextChannel++
    this.channels.set(n, new Chan())
    cb(n)
  }

  send(chan: number, value: Jaspr, cb: (sent: boolean) => void): void {
    const c = this.channels.get(chan)
    if (c) c.send(value, cb)
    else cb(false)
  }

  recv(chan: number, cb: (err?: JasprError, val?: Jaspr) => void): void {
    const c = this.channels.get(chan)
    if (c) c.recv(cb)
    else cb({err: 'channel closed'})
  }

  closeChan(chan: number, cb: (closed: boolean) => void): void {
    const c = this.channels.get(chan)
    if (c) c.close()
    cb(this.channels.delete(chan))
  }

  isChanClosed(chan: number, cb: (closed: boolean) => void): void {
    const c = this.channels.get(chan)
    cb(c ? c.closed : false)
  }

  makeDynamic(defaultValue: Jaspr, cb: (dyn: number) => void): void {
    const n = this.nextDynamic++
    this.dynamics.set(n, defaultValue)
    cb(n)
  }
}

class Fiber extends AbstractFiber {
  _parent: AbstractFiber
  _root: RootFiber

  constructor(
    parent: AbstractFiber,
    dynamics: Map<number, Jaspr | Deferred> = new Map(),
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

  unhandledError(err: Jaspr, cb: Callback): void {
    this._root.unhandledError(err, cb)
  }
  
  processId() { return this._root.processId() }

  makeChan(cb: (chan: number) => void) { this._root.makeChan(cb) }

  send(chan: number, value: Jaspr, cb: (sent: boolean) => void) {
    this._root.send(chan, value, cb)
  }

  recv(chan: number, cb: (err?: JasprError, val?: Jaspr) => void) {
    this._root.recv(chan, cb)
  }

  closeChan(chan: number, cb: (closed: boolean) => void) {
    this._root.closeChan(chan, cb)
  }

  isChanClosed(chan: number, cb: (closed: boolean) => void): void {
    this._root.isChanClosed(chan, cb)
  }

  makeDynamic(defaultValue: Jaspr, cb: (dyn: number) => void): void {
    this._root.makeDynamic(defaultValue, cb)
  }

  toString() {
    if (this.value !== undefined) return '<resolved: ' + toString(this.value) + '>'
    else return '<unresolved: ' + (this.code === undefined ? '?' : toString(<Jaspr>this.code)) + '>'
  }
}

namespace Fiber {
  export function newRoot(
    errorHandler?: (root: RootFiber, err: Jaspr, cb: Callback) => void
  ): RootFiber {
    return new RootFiber(errorHandler)
  }
}

export default Fiber
