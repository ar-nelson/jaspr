import {
  Jaspr, JasprError, Deferred, Callback, toString, isArray, magicSymbol
} from './Jaspr'
import {
  Env, DeferProperties, JasprDynamic, makeDynamic, waitFor
} from './Interpreter'
import prettyPrint from './PrettyPrint'
import * as Names from './ReservedNames'
import {NativeAsyncFn} from './NativeFn'
import Chan from './Chan'
import chalk from 'chalk'
import {randomBytes} from 'crypto'

export class Branch implements Env {
  readonly root: Root
  readonly parent: Branch
  readonly junctionBranches: Branch[]
  canceled = false
  readonly listeners = new Set<() => void>()

  constructor(root?: Root, parent?: Branch, junction?: Branch[]) {
    if (root && parent) {
      this.root = root
      this.parent = parent
    } else if (this instanceof Root) {
      this.root = this
      this.parent = this
    } else {
      throw new Error('non-root branch must have a parent')
    }
    this.junctionBranches = junction || [this]
  }

  isCanceled(): boolean {
    if (this.canceled) return true
    if (this.parent.isCanceled()) {
      this.canceled = true
      return true
    }
    return false
  }

  cancel() {
    if (!this.isCanceled()) {
      this.canceled = true
      for (let listener of this.listeners) {
        listener()
        this.parent.removeOnCancel(listener)
      }
      this.listeners.clear()
    }
  }
  onCancel(listener: () => void) {
    if (!this.isCanceled() && !this.listeners.has(listener)) {
      this.listeners.add(listener)
      this.parent.onCancel(listener)
    }
  }
  removeOnCancel(listener: () => void) {
    if (!this.isCanceled()) {
      if (this.listeners.delete(listener)) {
        this.parent.removeOnCancel(listener)
      }
    }
  }

  defer(
    props: () => DeferProperties = () => ({action: 'external'})
  ): Fiber {
    return new Fiber(this, props)
  }

  junction(
    fns: ((env: Env, cb: Callback) => void)[],
    props: () => DeferProperties = () => ({action: 'junction'})
  ): Fiber {
    const junction = new Fiber(this, props)
    const branches = new Array<Branch>(fns.length)
    let done = false
    for(let i = 0; i < branches.length; i++) {
      branches[i] = new Branch(this.root, this, branches)
    }
    fns.forEach((fn, i) => setImmediate(() => fn(branches[i], result => {
      if (!done) {
        done = true
        branches.forEach((b, j) => {if (i !== j) b.cancel()})
        junction.resolve(result)
      }
    })))
    return junction
  }
  
  gensym(name?: string) {
    const id = randomBytes(15).toString('base64')
    return name ? name + '_' + id : id
  }

  get closureName(): string { return this.root.closureName }
  get signalHandlerVar(): JasprDynamic { return this.root.signalHandlerVar }
  get nameVar(): JasprDynamic { return this.root.nameVar }

  unhandledError(err: Jaspr, cb: Callback) {
    this.root.errorHandler(this.root, err, this, cb)
  }
}

export class Fiber extends Deferred {
  readonly branch: Branch
  readonly props: () => DeferProperties

  constructor(
    branch: Branch,
    props: () => DeferProperties = () => ({action: 'external'})
  ) {
    super()
    this.branch = branch
    this.props = props

    // Debug information:
    //console.log(this.descriptionString())
    //this.await(v => console.log(prettyPrint(<Jaspr>this.code) + ' -> ' + prettyPrint(v)))
  }

  isCanceled() { return this.branch.isCanceled() }

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

  /*stackTrace(): Fiber[] {
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
  }*/
  
  toString() {
    if (this.value !== undefined) return `<resolved: ${toString(this.value)}>`
    else {
      const {code} = this.props()
      return `<unresolved: ${code === undefined ? '?' : toString(<Jaspr>code)}>`
    }
  }
}

export type ErrorHandler =
  (root: Root, err: Jaspr, raisedIn: Branch, cb: Callback) => void

export class Root extends Branch {
  readonly errorHandler: ErrorHandler

  constructor(
    errorHandler: ErrorHandler =
      (root, err, raisedBy, cb) => {
        console.error(chalk.redBright('⚠ Unhandled Signal ⚠'))
        console.error(prettyPrint(err))
        //console.error('\n' + chalk.gray('Stack trace:'))
        //console.error(raisedBy.stackTraceString())
        root.cancel()
      }
  ) {
    super()
    this.errorHandler = errorHandler
  }

  isCanceled() { return this.canceled }

  deferCancelable(
    fn: (env: Env, cb: Callback) => void,
    dynamics: [JasprDynamic, Jaspr | Deferred][] = []
  ): {fiber: Fiber, cancel: () => void} {
    const branch = new Branch(this, this)
    const fiber = new Fiber(branch)
    setImmediate(() => fn(branch, fiber.resolve.bind(fiber)))
    return {fiber, cancel: () => branch.cancel()}
  }

  unhandledError(err: Jaspr, cb: Callback) {
    this.errorHandler(this, err, this, cb)
  }

  readonly _closureName = this.gensym('closure')
  readonly _signalHandlerVar = makeDynamic(
    new NativeAsyncFn(function rootErrorHandler([err], cb) {
      this.unhandledError(err, v => cb(null, v))
    }).toClosure(this))
  readonly _nameVar = makeDynamic(null)
  get closureName() { return this._closureName }
  get signalHandlerVar() { return this._signalHandlerVar }
  get nameVar() { return this._nameVar }
}
