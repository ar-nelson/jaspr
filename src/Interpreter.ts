import * as _ from 'lodash'
import {legalName, number} from './Parser'
import * as Names from './ReservedNames'
import {NativeFn, NativeSyncFn, NativeAsyncFn} from './NativeFn'
import {
  Jaspr, JasprArray, JasprObject, JasprError, isArray, isObject, Deferred,
  Callback, resolveFully, toString, toBool, magicSymbol, has
} from './Jaspr'

import prettyPrint from './PrettyPrint'

/**
 * A Jaspr scope is made up of _contexts_, which map names to values:
 * 
 * - `value` is the default context, containing runtime values and functions.
 *   The majority of Jaspr code is only concerned with this context.
 * - `macro` contains macro functions.
 * - `check` is for check macros, a planned feature (not yet implemented)
 * - `test` is for unit tests
 * - `doc` is for documentation strings
 * 
 * These built-in context names are listed in {@link topLevelContexts}.
 * 
 * A scope may contain additional user-defined contexts, but they must be
 * prefixed with a module name and contain at least one `.`.
 */
export interface Scope extends JasprObject {
  /** The `value` context, containing runtime values and functions */
  value: JasprObject
  /** The `macro` context, containing macro functions */
  macro: JasprObject
  /** The `check` context, currently not used (planned future feature) */
  check: JasprObject
  /** The `test` context, containing unit tests */
  test: JasprObject
  /** The `doc` context, containing documentation strings */
  doc: { [name: string]: string }
  /** `qualified` is not a context. It maps unqualified names in the scope to
   *  fully-qualified names; it is used by `syntaxQuote` to qualify names. */
  qualified: { [unqualified: string]: string }
}

/** The empty scope */
export const emptyScope: Scope =
  {value: {}, macro: {}, check: {}, doc: {}, test: {}, qualified: {}}

/** 
 * The set of built-in context names. These are the only legal context names
 * that do not contain `.`. They are also the required properties of the
 * {@link Scope} interface.
 */
export const topLevelContexts = new Set(['value', 'macro', 'check', 'doc', 'test'])

/**
 * A Jaspr object that is a dynamic variable reference. Although TypeScript
 * cannot specify this requirement, all dynamic variable references must be
 * magic objects (have the symbol property {@link magicSymbol} with the value
 * {@link dynamicMarker}).
 */
export interface JasprDynamic extends JasprObject {
  /** Marker field for dynamic variable references */
  $dynamic: true
  /** The default value of this dynamic variable */
  $default: Jaspr | Deferred
}

/** Tests whether `it` is a magic dynamic variable reference. */
export function isDynamic(it: Jaspr): it is JasprDynamic {
  return isObject(it) && it[magicSymbol] === dynamicMarker
}

/**
 * Creates a new dynamic variable reference.
 * 
 * @param defaultValue The default value of the dynamic variable
 */
export function makeDynamic(defaultValue: Jaspr | Deferred): JasprDynamic {
  return <JasprDynamic>{
    [Names.dynamic]: true,
    [Names.default_]: defaultValue,
    [magicSymbol]: dynamicMarker
  }
}

/**
 * An associative linked list that maps dynamic value references to their
 * values. New entries can be added by appending to the front of the list.
 */
export interface DynamicMap {
  /** The dynamic variable reference */
  key: JasprDynamic
  /** The value of the dynamic variable `key` */
  value: Jaspr | Deferred
  /** The next cell in the linked list */
  next?: DynamicMap
}

/**
 * Tests whether `it` is a closure.
 * 
 * @param env The environment in which `it` may be a closure. Necessary because
 *   the `closureName` key is different in each environment.
 * @param it The value that may be a closure.
 */
export function isClosure(env: Env, it: Jaspr): it is JasprObject {
  return (isObject(it) && env.closureName in it)
}

/**
 * Tests whether `it` evaluates to itself. This is true if `it` is `null`, a
 * boolean, a number, `""`, `[],` or `{}`.
 * 
 * @param it The value to test.
 */
function isLiteral(it: Jaspr | Deferred) {
  return !it || it === true || typeof it === "number" || _.isEmpty(it)
}

/**
 * A Jaspr environment, the context in which Jaspr code in evaluated. Contains
 * all context information that is _not_ contained in either the scope or the
 * dynamic variables, including:
 * 
 * - Current fiber
 * - Current junction branch and cancellation handlers
 * - Instance-specific variables, such as `closureName`
 */
export interface Env {
  /**
   * Spawns a new fiber that is part of this environment's current junction
   * branch.
   * 
   * @param desc A function that generates a description of the fiber, for
   *   debugging purposes. Will not be called unless this debug information is
   *   viewed.
   */
  defer(desc?: () => FiberDescriptor): Deferred

  /**
   * Creates a new choice junction that is a child of this environment's current
   * junction branch. A branch is created for each function in the array
   * `branches`, and, once the callback passed to one of the branch functions is
   * called, the other branches are canceled.
   * 
   * @param branches An array of functions that execute each of the branches of
   *   the junction. Each function is passed two arguments: an environment that
   *   is inside the branch, and a callback that resolves the branch and cancels
   *   the others.
   * @param desc A function that generates a description of the fiber, for
   *   debugging purposes. Will not be called unless this debug information is
   *   viewed.
   */
  junction(
    branches: ((env: Env, cb: Callback) => void)[],
    desc?: () => FiberDescriptor
  ): Deferred

  /**
   * Called when a signal is raised but no signal handler is available to handle
   * it.
   * 
   * @param err The raised signal.
   * @param cb Callback that is called with a resume value, if one is provided.
   */
  unhandledError(err: Jaspr, cb: Callback): void

  /** Cancels this environment's current junction branch. */
  cancel(): void

  /**
   * Registers `fn` as a cancel event handler for this environment's current
   * junction branch. Does nothing if the branch is already canceled.
   * 
   * @param fn The function to call when the branch is canceled.
   */
  onCancel(fn: () => void): void

  /**
   * Generates a new string that is (probabilistically) guaranteed to be unique.
   * 
   * @param prefix If present, this string will be appended to the front of the
   *   generated string.
   */
  gensym(prefix?: string): string

  /** A unique, random string used as the key that contains a closure object's
   *  scope. */
  closureName: string

  /** Dynamic variable that contains the current signal handler, with a default
   *  value that calls `unhandledError`. */
  signalHandlerVar: JasprDynamic

  /** Dynamic variable that contains the fully-qualified name of the value
   *  currently being evaluated. Its default value is `null`. */
  nameVar: JasprDynamic
}

/**
 * Debug information for a fiber. Describes the kind of action the fiber is
 * performing, the code it is evaluating, and the name of the top-level value
 * the evaluated code is contained in.
 */
export interface FiberDescriptor {
  action: Action
  code?: Jaspr | Deferred
  name?: string
}

/**
 * Action type used by {@link DeferProperties}. Enumerates the types of named
 * actions that a fiber can perform.
 */
export type Action =
  'root' | 'eval' | 'macroexpand' | 'check' | 'junction' | 'send' | 'recv' |
  'apply' | 'external' 

/**
 * Tests whether `name` is a legal top-level Jaspr identifier. Legal
 * identifiers cannot contain reserved characters or `.`, cannot start with `$`,
 * and cannot be one of the reserved words `null`, `true`, or `false`.
 */
export function isLegalName(name: string) {
  return name !== 'null' && name !== 'true' && name !== 'false' &&
         legalName.test(name) && !number.test(name)
}

/**
 * Waits for the possibly-deferred value `v` to resolve, then calls `cb` with
 * `v`'s resolved value.
 * 
 * @param v The possibly-deferred value to wait on.
 * @param cb The callback to call when `v` resolves.
 */
export function waitFor(v: Jaspr | Deferred, cb: Callback): void {
  if (v instanceof Deferred) v.await(cb)
  else cb(v)
}

/**
 * Waits for `first` to resolve, then calls `fn` with the resulting value.
 * Returns a value that resolves to the return value of `fn`. May spawn a fiber
 * to wait on `first` or `fn`.
 * 
 * @param env The environment used to spawn a fiber, if necessary.
 * @param first The value to wait on before calling `fn`.
 * @param fn Callback that takes the resolved value of `first`, then returns a
 *   (possibly deferred) value that becomes the return value of `then`.
 * @param desc Function that returns a debug descriptor for the fiber that may
 *   be spawned to wait on `first`/`fn`.
 */
function then(
  env: Env,
  first: Jaspr | Deferred,
  fn: (x: Jaspr) => Jaspr | Deferred,
  desc: () => FiberDescriptor
): Jaspr | Deferred {
  if (first instanceof Deferred) {
    const d = env.defer(desc)
    first.await(x => waitFor(fn(x), y => d.resolve(y)))
    return d
  } else return fn(first)
}

/**
 * Internal error type used to stop synchronous code execution when a deferred
 * value is encountered. When this error is thrown during evaluation, the
 * current evaluation step returns a {@link Deferred} value and moves on to the
 * next piece of code that can be evaluated synchronously.
 */
class DeferredError extends Error {
  readonly waitingOn: Deferred

  constructor(waitingOn: Deferred) {
    super('Deferred value encountered. This exception should have been caught by another function!')
    this.waitingOn = waitingOn
  }
}

/** Throws {@link DeferredError} if `v` is not immediately available. */
function expect<T extends Jaspr>(v: T | Deferred): T {
  if (v instanceof Deferred) {
    if (v.value !== undefined) return <T>v.value
    else throw new DeferredError(v)
  } else return v
}

/**
 * Creates a new scope that is the right-biased merge of every scope in
 * `scopes`.
 * 
 * @param env An environment in which to perform the merge. This is necessary
 *   because merging deferred values may require the creation of new fibers.
 * @param scopes The scopes to merge. Values in later scopes may override values
 *   with the same name and context in earlier scopes.
 */
export function mergeScopes(env: Env, ...scopes: Scope[]): Scope {
  return scopes.reduce((l, r) => _.assignInWith(l, r,
    (l: Jaspr | Deferred, r: Jaspr | Deferred, name: string): Jaspr | Deferred => {
      if (r === undefined || name.startsWith('$')) return l
      if (l === undefined) return r
      if (l instanceof Deferred || r instanceof Deferred) {
        const d = env.defer()
        waitFor(l, l => waitFor(r, r => d.resolve(
          isObject(l) && isObject(r) ? _.assignIn({}, l, r) : l)))
        return d
      } else {
        return isObject(l) && isObject(r) ? _.assignIn({}, l, r) : l
      }
    }), {value: {}, macro: {}, check: {}, doc: {}, test: {}, qualified: {}})
}

/** Any object that contains a module name and a version. */
export interface Namespace {
  $module: string | null,
  $version: string | null
}

/** Returns the fully-qualified version of `name` in namespace `ns`. */
export function qualify(ns: Namespace, name: string): string {
  if (ns.$module) return `${ns.$module}.${name}@${ns.$version || ''}`
  else return name
}

/** 
 * Marker symbol for `$closure` calls that weren't expanded at macro expansion
 * time due to runtime macro definitions. Expressions marked with this symbol
 * will be macroexpanded again before they are evaluated.
 */
const unexpandedSymbol = Symbol('unexpandedMacros')

/** 
 * A unique object that, when stored in the {@link magicSymbol} property of a
 * {@link JasprObject}, marks that object as a magic closure which may contain
 * self-references.
 */
export const closureMarker = {}

/**
 * A unique object that, when stored in the {@link magicSymbol} property of a
 * {@link JasprObject}, marks that object as a dynamic variable.
 */
export const dynamicMarker = {}

/**
 * Raises an error signal in the given environment and dynamic variable context.
 * The signal may be caught by a signal handler in a dynamic variable, or it may
 * be handled by the environment's default signal handler.
 * 
 * Returns a value that resolves with the resume value provided by the signal
 * handler, if/when one is provided.
 * 
 * @param env The environment to raise the signal in.
 * @param dynamics A map from dynamic variables to values, which may contain a
 *   signal handler.
 * @param error The error signal to raise.
 */
export function raise(
  env: Env,
  dynamics: DynamicMap | undefined,
  error: JasprError
): Jaspr | Deferred {
  let ds = dynamics
  for (; ds; ds = ds.next) {
    if (ds.key === env.signalHandlerVar) {
      return call(env, ds.value, [error], dynamics)
    }
  }
  const d = env.defer(() => ({action: 'external'}))
  env.unhandledError(error, x => d.resolve(x))
  return d
}

/**
 * Recursively performs macro application. As long as `code` is an array whose
 * first element is the name of a macro function in `scope`'s `macro` context,
 * `macroExpandTop` will call that macro function, then recursively expand the
 * result. All other values are returned unchanged.
 * 
 * This function also handles `$syntaxQuote` (which is sort of a macro function)
 * by calling {@link syntaxQuote}.
 * 
 * @param env The environment in which to perform the macro expansion.
 * @param scope The lexical bindings available to the macro expansion.
 * @param dynamics The dynamic variable bindings available to the macro
 *   expansion.
 * @param code The code to expand.
 */
function macroApply(
  env: Env,
  scope: Scope,
  dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred
): Jaspr | Deferred {
  let recur: Jaspr | Deferred | undefined = undefined
  try {
    code = expect(code)
    if (isArray(code) && code.length > 0) {
      let fn = expect(code[0])
      if (fn === Names.syntaxQuote) {
        if (code.length !== 2) return raise(env, dynamics, {
          err: 'BadArgs',
          why: `${Names.syntaxQuote} takes 1 argument, got ${code.length - 1}`,
          fn: Names.syntaxQuote, args: code.slice(1)
        })
        try {
          const syms = new Map<string, string>()
          recur = syntaxQuote(env, code[1], scope.qualified,
            function gensyms(name: string): string {
              let sym = syms.get(name)
              if (!sym) {
                sym = env.gensym(name)
                syms.set(name, sym)
              }
              return sym
            })
        } catch (e) {
          if (e instanceof Error) throw e
          // syntaxQuote throws when it raises a signal
          else recur = raise(env, dynamics, e)
        }
      } else if (typeof fn === 'string' && scope.macro[fn] !== undefined) {
        recur = call(env, scope.macro[fn], code.slice(1), dynamics)
      }
    }
  } catch (e) {
    if (e instanceof DeferredError) {
      // If a DeferredError was thrown, execution can't continue synchronously.
      // Wait for the deferred value to resolve, then try again.
      const deferred = env.defer(() => ({action: 'macroexpand', code}))
      e.waitingOn.await(() =>
        waitFor(macroApply(env, scope, dynamics, code),
          x => deferred.resolve(x)))
      return deferred
    } else throw e
  }
  if (recur === undefined) return code
  else return macroApply(env, scope, dynamics, recur)
}

/**
 * Recursively performs macro expansion on `code`, using the macro definitions
 * in the `macro` context of `scope`. Arrays that represent applications of
 * macro functions will be replaced with the result of applying those functions.
 * 
 * Macro expansion continues recursively into the elements of arrays and the
 * values of objects. Quoted values are not expanded. Closure bodies and defs
 * are expanded if the defs do not contain any macro definitions.
 * 
 * Macro expansion is idempotent: it recurs until a fixed point is reached, then
 * calling `macroExpand` on the output should result in the same output.
 * 
 * @param env The environment in which to perform the macro expansion.
 * @param scope The lexical bindings available to the macro expansion.
 * @param dynamics The dynamic variable bindings available to the macro
 *   expansion.
 * @param code The code to expand.
 */
export function macroExpand(
  env: Env,
  scope: Scope,
  dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred
): Jaspr | Deferred {

  // Step 1: Apply macro functions
  try {
    code = expect(code)
    if (isLiteral(code) || typeof code === "string") return code
    if (isArray(code) && code.length > 0 &&
          !(code.length === 2 && expect(code[0]) === '') &&
          !(code.length === 4 && expect(code[0]) === Names.closure)) {
      return then(env, macroApply(env, scope, dynamics, code), postExpand,
        () => ({action: 'macroexpand', code}))
    }
  } catch (e) { return retry(e, () => macroExpand(env, scope, dynamics, code)) }
  return postExpand(code)

  // Step 2: Recur into elements of arrays/objects
  function postExpand(code: Jaspr): Jaspr | Deferred {
    try {
      if (isObject(code)) {
        const out: JasprObject = Object.create(null)
        for (let key in code) {
          const value = macroExpand(env, scope, dynamics, code[key])
          out[key] = value
          if (value instanceof Deferred) value.await(v => out[key] = v)
        }
        return out
      } else if (isArray(code)) {
        if (code.length === 2 && expect(code[0]) === '') return code
        const out = new Array<Jaspr | Deferred>(code.length)
        // Special case: closures
        // Only recur into closures if they do not define any new macros
        if (code.length === 4 && expect(code[0]) === Names.closure &&
            isObject(expect(code[1]))) {
          const [fn, defs, body, fields] = code
          const nameError = validateNames(<JasprObject>defs)
          if (nameError != null) return raise(env, dynamics, nameError)
          out[0] = fn
          out[3] = macroExpand(env, scope, dynamics, fields)
          if (out[3] instanceof Deferred) (<Deferred>out[3]).await(v => out[3] = v)
          if (_.some(Object.keys(<JasprObject>expect(defs)),
                    k => k.startsWith('macro.'))) {
            out[1] = defs
            out[2] = body
            out[<any>unexpandedSymbol] = true
          } else {
            out[2] = macroExpand(env, scope, dynamics, body)
            if (out[2] instanceof Deferred) (<Deferred>out[2]).await(v => out[2] = v)
            const outDefs = Object.create(null)
            out[1] = outDefs
            for (let name in <JasprObject>defs) {
              const value = macroExpand(env, scope, {
                  key: env.nameVar, value: name, next: dynamics
                }, (<any>defs)[name])
              outDefs[name] = value
              if (value instanceof Deferred) value.await(v => outDefs[name] = v)
            }
          }
        } else {
          for (let i = 0; i < code.length; i++) {
            const value = macroExpand(env, scope, dynamics, code[i])
            out[i] = value
            if (value instanceof Deferred) value.await(v => out[i] = v)
          }
        }
        return optimize(out)
      } else return code
    } catch (e) { return retry(e, () => postExpand(code)) }
  }

  // Step 3: Perform simple optimizations to remove redundant bindings
  function optimize(code: JasprArray): Jaspr | Deferred {
    try {
      if (code.length === 1) {
        let fn = expect(code[0])
        if (isArray(fn) && fn.length === 4 && expect(fn[0]) === Names.closure) {
          const defs = expect(fn[1]), fields = expect(fn[3])
          if (isObject(defs) && isObject(fields) && _.isEmpty(fields)) {
            const body = expect(fn[2]), names = Object.keys(defs)
            // Redundant case #1: Bind one value, then immediately return it
            if (names.length === 1 && body === names[0] && isLegalName(names[0])) {
              return defs[names[0]]
            }
            // Redundant case #2: Bind only constants and preexisting names
            else if (_.every(names, k => isLegalName(k) &&
                (isLiteral(defs[k]) || typeof defs[k] === 'string') &&
                !(''+defs[k] in defs))) {
              // Inline the bindings, removing the redundant closure
              return subst(body, <any>defs)
            }
          }
        }
      }
      return code
    } catch (e) {
      // subst may throw false if it encounters something that can't be inlined
      if (e === false) return code
      else return retry(e, () => optimize(code))
    }
  }

  // If a DeferredError was thrown, execution can't continue synchronously.
  // Wait for the deferred value to resolve, then try again.
  function retry(e: any, fn: () => Jaspr | Deferred): Deferred {
    if (e instanceof DeferredError) {
      const deferred = env.defer(() => ({action: 'macroexpand', code}))
      e.waitingOn.await(() => waitFor(fn(), x => deferred.resolve(x)))
      return deferred
    } else throw e
  }
}

const gensymRegex = /^[.]([^.]+)[.]$/

/** Utility function used by {@link macroApply} to perform syntax quoting */
function syntaxQuote(
  env: Env,
  code: Jaspr | Deferred,
  qualified: {[unqualified: string]: string},
  gensyms: (name: string) => string
): Jaspr | Deferred {
  try {
    const {result, flat} = innerSyntaxQuote(expect(code))
    if (flat) throw {
      err: 'NotCallable', why: 'encountered ~@ outside of array',
      callee: Names.unquoteSplicing, args: (<any[]>expect(code)).slice(1)
    }
    return result
  } catch (e) {
    if (e instanceof DeferredError) {
      // If a DeferredError was thrown, execution can't continue synchronously.
      // Wait for the deferred value to resolve, then try again.
      const deferred = env.defer(() => ({action: 'macroexpand', code}))
      e.waitingOn.await(() => waitFor(syntaxQuote(env, code, qualified, gensyms),
        x => deferred.resolve(x)))
      return deferred
    } else throw e
  }

  function innerSyntaxQuote(code: Jaspr): {result: Jaspr, flat: boolean} {
    if (isArray(code) && code.length > 0) {
      let fn = expect(code[0])
      if (fn === '' || fn === Names.syntaxQuote) {
        return {result: ['', code], flat: false}
      } else if (fn === Names.unquote) {
        if (code.length === 2) return {result: expect(code[1]), flat: false}
        else throw {
          err: 'BadArgs', why: `${Names.unquote} takes exactly 1 argument`,
          fn: Names.unquote, args: code.slice(1)
        }
      } else if (fn === Names.unquoteSplicing) {
        if (code.length === 2) return {result: expect(code[1]), flat: true}
        else throw {
          err: 'BadArgs', why: `${Names.unquoteSplicing} takes exactly 1 argument`,
          fn: Names.unquoteSplicing, args: code.slice(1)
        }
      } else {
        let toConcat: Jaspr[] = [], currentArray: Jaspr[] = []
        for (let x of code) {
          const {result, flat} = innerSyntaxQuote(expect(x))
          if (flat) {
            if (currentArray.length > 0) {
              toConcat.push([[], ...currentArray])
              currentArray = []
            }
            toConcat.push(result)
          } else currentArray.push(result)
        }
        if (toConcat.length === 0) {
          return {result: [[], ...currentArray], flat: false}
        } else {
          if (currentArray.length > 0) toConcat.push([[], ...currentArray])
          return {result: [Names.arrayConcatQualified, ...toConcat], flat: false}
        }
      }
    } else if (isObject(code)) {
      const out: JasprObject = Object.create(null)
      for (let key in code) {
        const gensymMatch = gensymRegex.exec(key)
        const setKey = gensymMatch ? gensyms(gensymMatch[1]) : key
        const value = syntaxQuote(env, code[key], qualified, gensyms)
        out[setKey] = value
        if (value instanceof Deferred) value.await(v => out[setKey] = v)
      }
      return {result: out, flat: false}
    } else if (typeof code === 'string') {
      const gensymMatch = gensymRegex.exec(code)
      return {
        result: ['',
          gensymMatch ? gensyms(gensymMatch[1]) :
          typeof qualified[code] === 'string' ? qualified[code] : code],
        flat: false
      }
    } else return {result: code, flat: false}
  }
}

/** Utility function used by {@link macroExpand} for optimization */
function subst(
  code: Jaspr,
  substs: {[original: string]: string},
  nested: boolean = false
): Jaspr {
  if (isArray(code) && code.length > 0) {
    const fn = expect(code[0])
    if (code.length === 2 && fn === '') return code
    else if (code.length === 4 && fn === Names.closure) {
      const [fn, defs, body, fields] = code.map(expect)
      const shadowed = Object.keys(defs || {})
        .map(k => k.startsWith('macro.') ? k.slice(6) : k)
        .filter(k => k.indexOf('.') === -1)
      const newSubsts: any = _.omit(substs, ...shadowed)
      return [
        fn, subst(defs, newSubsts, true),
        subst(body, newSubsts, true), subst(fields, substs, nested)
      ]
    } else return code.map(x => subst(expect(x), substs, nested))
  } else if (isObject(code)) {
    return _.mapValues(code, x => subst(expect(x), substs, nested))
  } else if (typeof code === 'string' && substs[code] !== undefined) {
    if (nested && substs[code] === Names.args) throw false
    return substs[code]
  } else if (code === Names.eval_ || code === Names.macroexpand) {
    throw false
  } else return code
}

/**
 * Calls the Jaspr value `callee` with the arguments `args` and the given
 * environment and bindings.
 * 
 * Calling a number or a string uses the callee as an index into the first
 * argument.
 * 
 * Calling `[]` or `{}` generates a new array or object from the arguments.
 * 
 * Calling a closure evaluates the closure's body with `args` bound to the
 * special variable `$args`.
 * 
 * All other values are not callable, and will raise an error signal.
 * 
 * @param env The environment in which to perform the call.
 * @param callee The value to call.
 * @param args The argument of the call.
 * @param dynamics The dynamic variable bindings available to the call.
 */
export function call(
  env: Env,
  callee: Jaspr | Deferred,
  args: JasprArray,
  dynamics: DynamicMap | undefined
): Jaspr | Deferred {
  const badArgs = (why: string, extras = {}) =>
    raise(env, dynamics, 
      <any>Object.assign({err: 'BadArgs', why, fn: callee, args}, extras))
  const notCallable = (why: string) =>
    raise(env, dynamics, {err: 'NotCallable', why, callee, args})
  try {
    callee = expect(callee)
    if (isClosure(env, callee)) {
      const {
        [env.closureName]: scope,
        [Names.code]: code,
        [magicSymbol]: magic
      } = callee
      if (magic instanceof NativeFn) {
        args = args.map(expect)
        if (magic instanceof NativeSyncFn) {
          try {return magic.fn.apply(env, args)}
          catch (e) {return raise(env, dynamics, e)}
        } else {
          const d = env.defer(() => ({
            action: 'external',
            code: [['', callee]].concat(args.map(a => isLiteral(a) ? a : ['', a]))
          }))
          magic.call(env, <Jaspr[]>args, (err, v) => {
            if (err) {
              const resume = raise(env, dynamics, err)
              if (resume instanceof Deferred) resume.await(v => d.resolve(v))
              else d.resolve(resume)
            } else d.resolve(<Jaspr>v)
          })
          return d
        }
      } else if (code !== undefined) {
        return evalExpr(env, <Scope>expect(scope), args, dynamics, code)
      } else return notCallable('closure has no code')
    } else if (isArray(callee)) {
      if (callee.length === 0) return args
      else return notCallable('cannot call a non-empty array')
    } else if (isObject(callee)) {
      if (!_.isEmpty(callee)) {
        return notCallable('cannot call non-closure, non-empty object')
      } else if (args.length % 2 === 1) {
        return badArgs('{} takes an even number of arguments')
      }
      const out: JasprObject = Object.create(null)
      for (let i = 0; i < args.length; i += 2) {
        const key = expect(args[i]), value = args[i + 1]
        if (typeof key === 'string') out[key] = value
        else return badArgs('key is not a string', {key})
      }
      return out
    } else if (typeof callee === 'number') {
      if (args.length !== 1) {
        return badArgs(`index takes 1 argument, got ${args.length}`)
      }
      const receiver = expect(args[0])
      if (isArray(receiver)) {
        const index = callee < 0 ? receiver.length + callee : callee
        const el = receiver[index]
        if (el !== undefined) return el
        else return raise(env, dynamics, {
          err: 'NoKey', why: 'index not found in array',
          key: index, in: receiver
        })
      } else return badArgs('numeric index into non-array')
    } else if (typeof callee === "string") {
      if (args.length !== 1) {
        return badArgs(`index takes 1 argument, got ${args.length}`)
      }
      let receiver = expect(args[0])
      if (isObject(receiver)) {
        const el = receiver[callee]
        if (el !== undefined && typeof el !== 'function') return el
        else return raise(env, dynamics, {
          err: 'NoKey', why: 'key not found in object',
          key: callee, in: receiver
        })
      } else return badArgs('string index into non-object')
    } else return notCallable('not closure, number, string, [], or {}')
  } catch (e) {
    if (e instanceof DeferredError) {
      // If a DeferredError was thrown, execution can't continue synchronously.
      // Wait for the deferred value to resolve, then try again.
      const deferred = env.defer(() => ({
        action: 'eval',
        code: [['', callee]].concat(args.map(a => isLiteral(a) ? a : ['', a]))
      }))
      e.waitingOn.await(() =>
        waitFor(call(env, callee, args, dynamics), x => deferred.resolve(x)))
      return deferred
    } else throw e
  }
}

/**
 * Evaluates the Jaspr expression `code` with the given environment and
 * bindings.
 * 
 * @param env The environment in which to evaluate `code`.
 * @param scope Lexical bindings used when evaluating `code`.
 * @param $args Binding for the special variable `$args`, the arguments passed
 *   to the innermost closure.
 * @param dynamics Dynamic variable bindings used when evaluating `code`.
 * @param code The Jaspr code to evaluate.
 */
export function evalExpr(
  env: Env,
  scope: Scope,
  $args: JasprArray,
  dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred
): Jaspr | Deferred {
  try {
    code = expect(code)
    if (isLiteral(code)) return code
    else if (code === Names.args) return $args
    else if (typeof code === 'string') {
      if (code.startsWith(Names.prefix)) return raise(env, dynamics, {
        err: 'NoBinding', why: 'no accessible binding for reserved name',
        name: code
      })
      else {
        const value =
          (isObject(scope.value) ? scope.value : Object.create(null))[code]
        if (value === undefined || typeof value === 'function') {
          return raise(env, dynamics,
            {err: 'NoBinding', why: 'name not defined', name: code})
        } else return value
      }
    } else if (isArray(code)) {
      const hd = expect(code[0])
      if (hd === '') {
        if (code.length === 2) return code[1]
        else return raise(env, dynamics, {
          err: 'BadArgs',
          why: `empty string (quote) takes 1 argument, got ${code.length - 1}`,
          fn: '', args: code.slice(1)
        })
      } else if (typeof hd === 'string' && hd.charAt(0) === Names.prefix) {
        // special forms
        switch (hd) {
        case Names.if_: {
          const [_, pr, th, el] = code
          return then(env, evalExpr(env, scope, $args, dynamics, pr),
            bool => evalExpr(
              env, scope, $args, dynamics, toBool(bool) ? th : el),
            () => ({action: 'eval', code}))
        }
        case Names.then: {
          const [_, fst, snd] = code
          return then(env, evalExpr(env, scope, $args, dynamics, fst),
            () => evalExpr(env, scope, $args, dynamics, snd),
            () => ({action: 'eval', code}))
        }
        case Names.closure: {
          const defs = <JasprObject>expect(code[1])
          const newScope = evalDefs(env, scope, $args, dynamics, defs)
          let closureCode = code[2]
          if (code[<any>unexpandedSymbol]) {
            closureCode = macroExpand(env, newScope, dynamics, closureCode)
          }
          const fields = evalExpr(env, scope, $args, dynamics, code[3])
          if (fields instanceof Deferred) {
            const d = env.defer(() => ({action: 'eval', code}))
            fields.await(fields => Object.assign({
              [env.closureName]: newScope,
              [Names.code]: closureCode,
              [magicSymbol]: closureMarker
            }, fields))
            return d
          }
          return Object.assign({
            [env.closureName]: newScope,
            [Names.code]: closureCode,
            [magicSymbol]: closureMarker
          }, fields)
        }
        case Names.apply: {
          const [_, callee, args] = code
          return then(env, evalExpr(env, scope, $args, dynamics, args),
            args => call(env, evalExpr(env, scope, $args, dynamics, callee),
              <JasprArray>args, dynamics),
            () => ({action: 'eval', code}))
        } 
        case Names.dynamicGet:
          return then(env, evalExpr(env, scope, $args, dynamics, code[1]),
            dyn => {
              for (let ds = dynamics; ds !== undefined; ds = ds.next) {
                if (ds.key === dyn) return ds.value
              }
              return (<JasprDynamic>dyn).$default
            }, () => ({action: 'eval', code}))
        case Names.dynamicLet: {
          const [_, dyn, value, body] = code
          return then(env, evalExpr(env, scope, $args, dynamics, dyn),
            dyn => {
              const newDynamics: DynamicMap = {
                key: <JasprDynamic>dyn,
                value: evalExpr(env, scope, $args, dynamics, value),
                next: dynamics
              }
              if (newDynamics.value instanceof Deferred) {
                (<Deferred>newDynamics.value).await(value =>
                  newDynamics.value = value)
              }
              return evalExpr(env, scope, $args, newDynamics, body)
            }, () => ({action: 'eval', code}))
        }
        case Names.contextGet: {
          const ctx = '' + expect(code[1]), name = '' + expect(code[2])
          const bindings = expect(scope[ctx])
          if (isObject(bindings) && bindings[name] !== undefined &&
              typeof bindings[name] !== 'function') {
            return bindings[name]
          } else return raise(env, dynamics, {
            err: 'NoBinding', why: 'name not defined in context',
            name, context: ctx
          })
        }
        case Names.junction:
          return env.junction(
            code.slice(1).map(expr => (env: Env, cb: Callback) =>
              waitFor(evalExpr(env, scope, $args, dynamics, expr), cb)),
            () => ({action: 'junction', code}))
        case Names.eval_:
          return then(env, evalExpr(env, scope, $args, dynamics, code[1]),
            expr => evalExpr(env, scope, $args, dynamics, expr),
            () => ({action: 'eval', code}))
        case Names.macroexpand:
          return then(env, evalExpr(env, scope, $args, dynamics, code[1]),
            expr => macroExpand(env, scope, dynamics, expr),
            () => ({action: 'eval', code}))
        case Names.arrayMake: {
          const [_, fn, len] = code
          return then(env, evalExpr(env, scope, $args, dynamics, fn),
            fn => then(env, evalExpr(env, scope, $args, dynamics, len),
              len => {
                const out = new Array<Jaspr | Deferred>(+<any>len)
                for (let i = 0; i < out.length; i++) {
                  const value = call(env, fn, [i], dynamics)
                  out[i] = value
                  if (value instanceof Deferred) value.await(v => out[i] = v)
                }
                return out
              }, () => ({action: 'eval', code})),
            () => ({action: 'eval', code}))
        } 
        case Names.objectMake: {
          const [_, fn, keys] = code
          return then(env, evalExpr(env, scope, $args, dynamics, fn),
            fn => then(env, evalExpr(env, scope, $args, dynamics, keys),
              keys => {
                const out: JasprObject = Object.create(null)
                for (let key of <JasprArray>keys) {
                  const value = call(env, fn, [''+key], dynamics)
                  out[''+key] = value
                  if (value instanceof Deferred) value.await(v => out[''+key] = v)
                }
                return out
              }, () => ({action: 'eval', code})),
            () => ({action: 'eval', code}))
        }
        case Names.syntaxQuote:
          return raise(env, dynamics, {
            err: 'NoPrimitive', why: `${hd} cannot be evaluated, must be macroexpanded`,
            callee: hd, code
          })
        case Names.unquote:
        case Names.unquoteSplicing:
          return raise(env, dynamics, {
            err: 'NoPrimitive', why: `${hd} cannot occur outside ${Names.syntaxQuote}`,
            callee: hd, code
          })
        default:
          return raise(env, dynamics, {
            err: 'NoPrimitive', why: 'no such primitive operation', callee: hd, code
          })
        }
      }
  
      // define
      else if (
        isArray(hd) && hd.length === 4 && code.length === 1 &&
        expect(hd[0]) === Names.closure && isObject(expect(hd[1])) &&
        (x => isObject(x) && _.isEmpty(x))(expect(hd[3]))
      ) {
        const newScope =
          evalDefs(env, scope, $args, dynamics, <JasprObject>expect(hd[1]))
        const body = hd[<any>unexpandedSymbol]
          ? macroExpand(env, newScope, dynamics, hd[2]): hd[2]
        return evalExpr(env, newScope, [], dynamics, body)
      }
  
      // calls
      else {
        const form = code
        return then(env, evalExpr(env, scope, $args, dynamics, form[0]),
          callee => {
            const args = new Array<Jaspr | Deferred>(form.length - 1)
            for (let i = 1; i < form.length; i++) {
              const arg = evalExpr(env, scope, $args, dynamics, form[i])
              args[i - 1] = arg
              if (arg instanceof Deferred) arg.await(v => args[i - 1] = v)
            }
            return call(env, callee, args, dynamics)
          }, () => ({action: 'eval', code}))
      }
    } else /* object */ {
      const out: JasprObject = Object.create(null)
      for (let key in <JasprObject>code) {
        const value =
          evalExpr(env, scope, $args, dynamics, (<JasprObject>code)[key])
        out[key] = value
        if (value instanceof Deferred) value.await(v => out[key] = v)
      }
      return out
    }
  } catch (e) {
    if (e instanceof DeferredError) {
      // If a DeferredError was thrown, execution can't continue synchronously.
      // Wait for the deferred value to resolve, then try again.
      const deferred = env.defer(() => ({action: 'eval', code}))
      e.waitingOn.await(() =>
        waitFor(evalExpr(env, scope, $args, dynamics, code),
          x => deferred.resolve(x)))
      return deferred
    } else throw e
  }
}

/**
 * Performs macro expansion, then evaluation, on the same Jaspr code in the same
 * environment and scope. This is the default Jaspr evaluation process.
 * 
 * @param env The environment in which to expand and evaluate `code`.
 * @param scope Lexical bindings used when expanding and evaluating `code`.
 * @param $args Binding for the special variable `$args`, the arguments passed
 *   to the innermost closure.
 * @param dynamics Dynamic variable bindings used when expanding and evaluating
 *   `code`.
 * @param code The Jaspr code to expand and evaluate.
 */
export function expandAndEval(
  env: Env,
  scope: Scope,
  $args: JasprArray,
  dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred
): Jaspr | Deferred {
  return then(env, macroExpand(env, scope, dynamics, code),
    expanded => evalExpr(env, scope, $args, dynamics, expanded),
    () => ({action: 'eval', code}))
}

/**
 * Tests whether all of the keys in `defs` are valid context-prefixed names.
 * Returns `null` if all of the names are valid, or a {@link JasprError} if any
 * are invalid.
 * 
 * @param defs The object whose keys should be verified.
 * @param module Optional namespace information to include in the returned
 *   error object.
 */
export function validateNames(
  defs: JasprObject,
  module?: Namespace
): JasprError | null {
  for (let name in defs) {
    let names = name.split('.')
    if (names.length === 2) {
      if (topLevelContexts.has(names[0])) {
        if (!module && (names[0] === 'doc' || names[0] === 'test')) return {
          err: 'BadName', why: 'prefix only allowed at module toplevel',
          prefix: names[0], name,
          help: 'Documentation and tests cannot be defined using “let”.'
        }
        if (names[0] == 'doc' && typeof defs[name] !== 'string') return {
          err: 'BadModule', why: 'doc is not a string', name, value: defs[name],
          help: 'Documentation must be a literal string, not an expression.'
        }
        names = names.slice(1)
      } else return <any>Object.assign({
        err: 'BadName', why: 'not a legal top-level prefix',
        prefix: names[0], name,
        help: `Legal top-level prefixes are: ${_.join([...topLevelContexts])}`
      }, module ? {module: module.$module, version: module.$version} : {})
    }
    if (names.length === 0 || !_.every(names, isLegalName)) {
      return <any>Object.assign({
        err: 'BadName', why: 'not a legal identifier', name,
        help: `
          Names may not contain reserved characters (whitespace or anything that
          is part of Jaspr syntax); may not have leading, trailing, or
          consecutive “.”; may not have leading “$”; and may not be empty.
        `.trim().replace(/\s+/gm, ' ')
        }, module ? {module: module.$module, version: module.$version} : {})
    }
  }
  return null
}

/**
 * Macroexpands and evaluates all of the values of the _definitions object_
 * `defs`, then returns a scope created by extending `baseScope` with the
 * resulting definitions. This extended scope is also the scope in which every
 * value in `defs` is evaluated; this makes recursion possible.
 * 
 * A definitions object is an object whose keys are context-prefixed names
 * (names which may begin with a context name followed by `.`). Unprefixed names
 * have the default context `value`.
 * 
 * If `namespace` is provided, the new scope will include fully-qualified names
 * for the new definitions.
 * 
 * @param env The environment in which to evaluate the definitions.
 * @param baseScope The scope (lexical bindings) to extend with the new
 *   definitions. This scope's bindings will be available when evaluating the
 *   values of `defs`, and will be included in the returned scope.
 * @param $args Binding for the special variable `$args`, the arguments passed
 *   to the innermost closure.
 * @param dynamics Dynamic variable bindings used when expanding and evaluating
 *   the values of `defs`.
 * @param defs The definitions object to evaluate.
 * @param namespace Optional namespace for the new definitions. If present,
 *   fully-qualified versions of each name in `defs` will be included in the
 *   returned scope.
 */
export function evalDefs(
  env: Env,
  baseScope: Scope,
  $args: JasprArray,
  dynamics: DynamicMap | undefined,
  defs: JasprObject,
  namespace?: Namespace
): Scope {
  const byContext: {[ctx: string]: JasprObject} = {}
  const names: [string, string, string[]][] = []
  for (let name in defs) {
    const lastDot = name.lastIndexOf('.')
    const ctx = lastDot > -1 ? name.slice(0, lastDot) : 'value'
    const ident = lastDot > -1 ? name.slice(lastDot + 1) : name
    const qualified = namespace && ctx !== 'test'
      ? [ident, `${namespace.$module}.${ident}`, qualify(namespace, ident)]
      : [ident]
    if (!(ctx in byContext)) byContext[ctx] = {}
    if (ctx === 'test' || ctx === 'doc') {
      for (let k of qualified) byContext[ctx][k] = defs[name]
    } else {
      const d = env.defer(() => ({
        action: 'eval', code: defs[name]
      }))
      for (let k of qualified) byContext[ctx][k] = d
      names.push([name, ctx, qualified])
    }
  }
  const scope = _.create(baseScope, _.mapValues(byContext,
    (obj, ctx) => Object.assign(
      Object.create(<JasprObject>baseScope[ctx] || null), obj)))
  if (namespace) {
    scope.qualified = _.create(scope.qualified,
      _(defs).keys().filter(k => !/^test[.][^.]+$/.test(k)).flatMap(name => {
        const lastDot = name.lastIndexOf('.')
        const ident = lastDot > -1 ? name.slice(lastDot + 1) : name
        const qualified = qualify(namespace, ident)
        return [[ident, qualified], [`${namespace.$module}.${ident}`, qualified]]
      }).fromPairs().value())
  }
  for (let [name, ctx, idents] of names) {
    const body = defs[name]
    const deferred = byContext[ctx][idents[0]]
    const value = expandAndEval(env, scope, $args, {
        key: env.nameVar, value: <string>_.last(idents),
        next: dynamics
      }, body)
    if (deferred instanceof Deferred) waitFor(value, v => deferred.resolve(v))
    for (let ident of idents) scope[ctx][ident] = value
    if (value instanceof Deferred) value.await(v => {
      for (let ident of idents) scope[ctx][ident] = v
    })
  }
  return scope
}
