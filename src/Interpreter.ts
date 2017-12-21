import * as _ from 'lodash'
import * as async from 'async'
import {legalName, number} from './Parser'
import * as Names from './ReservedNames'
import {NativeFn, NativeSyncFn, NativeAsyncFn} from './NativeFn'
import {
  Jaspr, JasprArray, JasprObject, JasprError, isArray, isObject, Deferred,
  Callback, getIndex, getKey, resolveFully, toString, toBool, magicSymbol, has
} from './Jaspr'

import prettyPrint from './PrettyPrint'

export interface Scope extends JasprObject {
  value: JasprObject
  macro: JasprObject
  check: JasprObject
  test: JasprObject
  doc: { [name: string]: string }
  qualified: { [unqualified: string]: string }
}

export const emptyScope: Scope =
  {value: {}, macro: {}, check: {}, doc: {}, test: {}, qualified: {}}

export interface JasprDynamic extends JasprObject {
  $dynamic: true, $default: Jaspr | Deferred
}

export function isDynamic(it: Jaspr): it is JasprDynamic {
  return isObject(it) && it[magicSymbol] === dynamicMarker
}

export function makeDynamic(defaultValue: Jaspr | Deferred): JasprDynamic {
  return <JasprDynamic>{
    [Names.dynamic]: true,
    [Names.default_]: defaultValue,
    [magicSymbol]: dynamicMarker
  }
}

export interface DynamicMap {
  key: JasprDynamic,
  value: Jaspr | Deferred,
  next?: DynamicMap
}

export function isClosure(env: Env, it: Jaspr): it is JasprObject {
  return (isObject(it) && env.closureName in it)
}

export interface Env {
  defer(props?: () => DeferProperties): Deferred
  junction(
    branches: ((env: Env, cb: Callback) => void)[],
    props?: () => DeferProperties
  ): Deferred
  unhandledError(err: Jaspr, cb: Callback): void
  cancel(): void
  onCancel(fn: () => void): void
  gensym(prefix?: string): string
  closureName: string
  signalHandlerVar: JasprDynamic
  nameVar: JasprDynamic
}

export interface DeferProperties {
  action: Action
  code?: Jaspr | Deferred
  name?: string
}

export type Action =
  'root' | 'eval' | 'macroexpand' | 'check' | 'junction' | 'send' | 'recv' |
  'apply' | 'external' 

export function isLegalName(name: string) {
  return name !== 'null' && name !== 'true' && name !== 'false' &&
         legalName.test(name) && !number.test(name)
}

export const topLevelPrefixes = new Set(['value', 'macro', 'check', 'doc', 'test'])

export function waitFor(v: Jaspr | Deferred, cb: Callback): void {
  if (v instanceof Deferred) v.await(cb)
  else cb(v)
}

class DeferredError extends Error {
  readonly waitingOn: Deferred

  constructor(waitingOn: Deferred) {
    super('Deferred value encountered. This exception should have been caught by another function!')
    this.waitingOn = waitingOn
  }
}

function expect<T extends Jaspr>(v: T | Deferred): T {
  if (v instanceof Deferred) {
    if (v.value !== undefined) return <T>v.value
    else throw new DeferredError(v)
  } else return v
}

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

const unexpandedSymbol = Symbol('unexpandedMacros')

export const closureMarker = {}
export const dynamicMarker = {}

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

function macroExpandTop(
  env: Env,
  scope: Scope,
  dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred
): Jaspr | Deferred {
  let recur: Jaspr | Deferred | undefined = undefined
  try {
    code = expect(code)
    if (isArray(code)) {
      if (code.length > 0) {
        let fn = expect(code[0])
        if (fn === Names.syntaxQuote) {
          if (code.length === 2) {
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
                else recur = raise(env, dynamics, e)
              }
          } else return raise(env, dynamics, {
            err: 'BadArgs',
            why: `${Names.syntaxQuote} takes 1 argument, got ${code.length - 1}`,
            fn: Names.syntaxQuote, args: code.slice(1)
          })
        } else if (typeof fn === 'string' && scope.macro[fn] !== undefined) {
          recur = call(env, scope.macro[fn], code.slice(1), dynamics)
        }
      }
    }
  } catch (e) {
    if (e instanceof DeferredError) {
      const deferred = env.defer(() => ({action: 'macroexpand', code}))
      e.waitingOn.await(() =>
        waitFor(macroExpandTop(env, scope, dynamics, code),
          x => deferred.resolve(x)))
      return deferred
    } else throw e
  }
  if (recur === undefined) return code
  else return macroExpandTop(env, scope, dynamics, recur)
}

function isLiteral(code: Jaspr | Deferred) {
  return !code || code === true || typeof code === "number" || _.isEmpty(code)
}

export function macroExpand(
  env: Env,
  scope: Scope,
  dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred
): Jaspr | Deferred {
  try {
    code = expect(code)
    if (isLiteral(code) || typeof code === "string") return code
    if (isArray(code) && code.length > 0 &&
          !(code.length === 2 && expect(code[0]) === '') &&
          !(code.length === 4 && expect(code[0]) === Names.closure)) {
      return then(env, macroExpandTop(env, scope, dynamics, code), postExpand,
        () => ({action: 'macroexpand', code}))
    }
  } catch (e) { return retry(e, () => macroExpand(env, scope, dynamics, code)) }
  return postExpand(code)
  function retry(e: any, fn: () => Jaspr | Deferred): Deferred {
    if (e instanceof DeferredError) {
      const deferred = env.defer(() => ({action: 'macroexpand', code}))
      e.waitingOn.await(() => waitFor(fn(), x => deferred.resolve(x)))
      return deferred
    } else throw e
  }
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
}

const gensymRegex = /^[.]([^.]+)[.]$/

function innerSyntaxQuote(
  env: Env,
  code: Jaspr,
  qualified: Dictionary<string>,
  gensyms: (name: string) => string
): {result: Jaspr, flat: boolean} {
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
        const {result, flat} =
          innerSyntaxQuote(env, expect(x), qualified, gensyms)
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

function syntaxQuote(
  env: Env,
  code: Jaspr | Deferred,
  qualified: Dictionary<string>,
  gensyms: (name: string) => string
): Jaspr | Deferred {
  try {
    const {result, flat} =
      innerSyntaxQuote(env, expect(code), qualified, gensyms)
    if (flat) throw {
      err: 'NotCallable', why: 'encountered ~@ outside of array',
      callee: Names.unquoteSplicing, args: (<any[]>expect(code)).slice(1)
    }
    return result
  } catch (e) {
    if (e instanceof DeferredError) {
      const deferred = env.defer(() => ({action: 'macroexpand', code}))
      e.waitingOn.await(() => waitFor(syntaxQuote(env, code, qualified, gensyms),
        x => deferred.resolve(x)))
      return deferred
    } else throw e
  }
}

function subst(
  code: Jaspr,
  substs: Dictionary<Jaspr>,
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

export interface Namespace {
  $module: string | null,
  $version: string | null
}

export function qualify(ns: Namespace, name: string): string {
  if (ns.$module) return `${ns.$module}.${name}@${ns.$version || ''}`
  else return name
}

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

function then(
  env: Env,
  first: Jaspr | Deferred,
  fn: (x: Jaspr) => Jaspr | Deferred,
  props: () => DeferProperties
): Jaspr | Deferred {
  if (first instanceof Deferred) {
    const d = env.defer(props)
    first.await(x => waitFor(fn(x), y => d.resolve(y)))
    return d
  } else return fn(first)
}

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
      const deferred = env.defer(() => ({action: 'eval', code}))
      e.waitingOn.await(() =>
        waitFor(evalExpr(env, scope, $args, dynamics, code),
          x => deferred.resolve(x)))
      return deferred
    } else throw e
  }
}

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

export function validateNames(
  defs: JasprObject,
  module?: Namespace
): JasprError | null {
  for (let name in defs) {
    let names = name.split('.')
    if (names.length === 2) {
      if (topLevelPrefixes.has(names[0])) {
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
        help: `Legal top-level prefixes are: ${_.join([...topLevelPrefixes])}`
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

export function evalDefs(
  env: Env,
  evalScope: Scope,
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
  const scope = _.create(evalScope, _.mapValues(byContext,
    (obj, ctx) => Object.assign(
      Object.create(<JasprObject>evalScope[ctx] || null), obj)))
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
