import {join} from 'lodash'
import {EventEmitter} from 'events'
import {
  Jaspr, JasprArray, JasprObject, Json, Callback, Deferred, toString, isArray,
  isObject, isClosure
} from './Jaspr'

export default class Proc {
  readonly name: string
  readonly parent?: Proc
  readonly children = new Set<Proc>()
  readonly fibers = new Set<Fiber>()
  readonly events = new EventEmitter()
  readonly inbox = new Map<string, Json[]>()
  readonly errorHandler: (err: Jaspr, cb: (err: Jaspr, value?: Jaspr) => void) => boolean

  constructor(
    name: string,
    parent?: Proc,
    errorHandler = (err: Jaspr, cb: (err: Jaspr, value?: Jaspr) => void) => {
      cb(err)
      return false
    }
  ) {
    this.name = name
    this.parent = parent
    if (parent) parent.children.add(parent)
    this.errorHandler = errorHandler
  }

  send(event: string, data: Json): void {
    if (this.events.listenerCount(event) > 0) {
      setImmediate(() => this.events.emit(event, data))
    } else {
      const queue = this.inbox.get(event)
      if (queue === undefined) this.inbox.set(event, [data])
      else queue.push(data)
    }
  }

  receive(event: string, cb: Callback): void {
    const queue = this.inbox.get(event)
    if (queue === undefined || queue.length === 0) this.events.once(event, cb)
    else cb(<Json>queue.shift())    
  }
  
  error(err: Jaspr, cb: Callback): boolean {
    return this.errorHandler(err, (err, resumeValue?) => {
      if (resumeValue !== undefined) cb(resumeValue)
      else this.kill()
    })
  }

  kill(): void {
    for (let child of this.children) child.kill()
    for (let fiber of this.fibers) fiber.cancel()
    for (let event of this.events.eventNames()) {
      this.events.removeAllListeners(event)
    }
    this.children.clear()
    this.fibers.clear()
    this.inbox.clear()
  }

  fiber(info?: FiberInfo, fn?: (cb: Callback, fiber: Fiber) => void): Fiber {
    const fiber = new Fiber(this, info)
    if (fn) fn(fiber.resolve.bind(fiber), fiber)
    return fiber
  }
}

let nextId: number = 0

export class Fiber extends Deferred {
  readonly proc: Proc
  readonly id: number
  info: FiberInfo

  constructor(proc: Proc, info: FiberInfo = FiberInfo.none) {
    super()
    this.id = nextId++
    this.proc = proc
    this.info = info
    proc.fibers.add(this)
  }

  resolve(value: Jaspr): void {
    this.proc.fibers.delete(this)
    super.resolve(value)
  }

  cancel(): void {
    this.proc.fibers.delete(this)
    super.cancel()
  }

  replace(info: FiberInfo): Fiber {
    this.info = info
    return this
  }

  error(err: Jaspr): Fiber {
    this.replace(new FiberInfo.Error(err))
    this.proc.error(err, this.resolve.bind(this))
    return this
  }

  toString() {
    if (this.canceled) return `(canceled ${this.proc.name}:${this.id})`
    else if (this.value === undefined) return `(unresolved ${this.proc.name}:${this.id})`
    else return `(resolved: ${toString(this.value)})`
  }
}

function toDebugString(
  it: Jaspr | Deferred, fibers: (f: Fiber) => number | undefined
): string {
  if (it instanceof Deferred) {
    if (it.value !== undefined) return toDebugString(it.value, fibers)
    const index = fibers(<Fiber>it)
    if (index) return `<${index}>`
    else return it.toString()
  } else if (isArray(it)) {
    return `[${join(it.map(x => toDebugString(x, fibers)), ', ')}]`
  } else if (isObject(it)) {
    if (isClosure(it)) return "(closure)"
    return `{${join(Object.keys(it).map(k =>
      `${toString(k)}: ${toDebugString(it[k], fibers)}`), ', ')}}`
  } else return toString(it)
}

function debugScope(scope: JasprObject): string {
  const keys = []
  for (let key in scope) keys.push(toString(key, true))
  return '{' + join(keys, ', ') + '}'
}

export interface FiberInfo {
  type: string
  toString(fiberMap: (f: Fiber) => number | undefined): string
}

export namespace FiberInfo {
  export const none: FiberInfo = {
    type: "unknown",
    toString() {return "<no data for fiber>"}
  }
  export function def(name: string): FiberInfo {
    return {type: "def", toString() {return "DEF: " + name}}
  }
  export class Eval implements FiberInfo {
    readonly type = "eval"
    readonly scope: JasprObject
    readonly code: Jaspr | Fiber
    constructor(code: Jaspr | Fiber, scope: JasprObject) {
      this.code = code
      this.scope = scope
    }
    toString(fibers: (f: Fiber) => number | undefined = () => undefined): string {
      return `EVAL in scope ${debugScope(this.scope)}\n${toDebugString(this.code, fibers)}`
    }
  }
  export class MacroExpand implements FiberInfo {
    readonly type = "macroexpand"
    readonly macroscope: JasprObject
    readonly code: Jaspr | Fiber
    constructor(code: Jaspr | Fiber, macroscope: JasprObject) {
      this.code = code
      this.macroscope = macroscope
    }
    toString(fibers: (f: Fiber) => number | undefined = () => undefined): string {
      return `MACROEXPAND in scope ${debugScope(this.macroscope)}\n${toDebugString(this.code, fibers)}`
    }
  }
  export class Call implements FiberInfo {
    readonly type = "call"
    readonly callee: Jaspr | Fiber
    readonly args: JasprArray
    constructor(callee: Jaspr | Fiber, args: JasprArray) {
      this.callee = callee
      this.args = args
    }
    toString(fibers: (f: Fiber) => number | undefined = () => undefined): string {
      return `CALL ${toDebugString(this.callee, fibers)} with ${toDebugString(this.args, fibers)}`
    }
  }
  export class Error implements FiberInfo {
    readonly type = "error"
    readonly err: Jaspr | Fiber
    constructor(err: Jaspr | Fiber) {
      this.err = err
    }
    toString(fibers: (f: Fiber) => number | undefined = () => undefined): string {
      return `ERROR ${toDebugString(this.err, fibers)}`
    }
  }
}
