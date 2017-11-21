import * as _ from 'lodash'
import * as async from 'async'
import {legalName, number} from './Parser'
import * as Names from './ReservedNames'
import {NativeFn} from './NativeFn'
import {
  Jaspr, JasprArray, JasprObject, JasprError, isArray, isObject, Deferred,
  Callback, getIndex, getKey, resolveArray, resolveObject, resolveFully,
  toString, toBool, magicSymbol
} from './Jaspr'

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

export function isClosure(env: Env, it: Jaspr): it is JasprObject {
  return (isObject(it) && env.closureName in it)
}

export interface Env {
  defer(
    fn: (env: Env, cb: Callback) => void,
    props?: () => DeferProperties,
    inherit?: boolean,
    dynamics?: [JasprDynamic, Jaspr | Deferred][]
  ): Deferred
  junction(
    branches: ((env: Env, cb: Callback) => void)[],
    props?: () => DeferProperties,
    inherit?: boolean
  ): Deferred
  unhandledError(err: Jaspr, cb: Callback): void
  getDynamic(dyn: JasprDynamic, cb: Callback): void
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

export function mergeScopes(env: Env, ...scopes: Scope[]): Scope {
  return scopes.reduce((l, r) => _.assignInWith(l, r,
    (l: Jaspr | Deferred, r: Jaspr | Deferred, name: string): Jaspr | Deferred => {
      if (r === undefined || name.startsWith('$')) return l
      if (l === undefined) return r
      if (l instanceof Deferred || r instanceof Deferred) {
        return env.defer((env, cb) =>
          waitFor(l, l => waitFor(r, r => cb(
            isObject(l) && isObject(r) ? _.assignIn({}, l, r) : l))))
      } else {
        return isObject(l) && isObject(r) ? _.assignIn({}, l, r) : l
      }
    }), {value: {}, macro: {}, check: {}, doc: {}, test: {}, qualified: {}})
}

const unexpandedSymbol = Symbol('unexpandedMacros')

export const closureMarker = {}
export const dynamicMarker = {}

function callClosure(
  env: Env, closure: JasprObject, args: JasprArray, inherit: boolean, cb: Callback
): void {
  resolveObject(closure,
    ({[Names.code]: code, [env.closureName]: scope, [magicSymbol]: magic}) => {
      if (magic instanceof NativeFn) magic.call(env, args, cb)
      else {
        const newScope: Scope =
          _.create(scope, {value: _.create(scope.value, {[Names.args]: args})})
        env.defer(
          (env, cb) => evalExpr(env, newScope, code, cb),
          () => ({action: 'eval', code,
                  name: magic ? (magic.name || undefined) : undefined}),
          inherit).await(cb)
      }
    })
}

export function raise(env: Env, error: JasprError, cb: Callback): void {
  env.getDynamic(env.signalHandlerVar, handler => {
    if (handler && isClosure(env, handler) && Names.code in handler) {
      callClosure(env, handler, [error], false, cb)
    } else env.unhandledError(error, cb)
  })
}

export function macroExpandTop(env: Env, scope: Scope, code: Jaspr, cb: Callback): void {
  if (isArray(code)) {
    if (code.length === 0) cb(code)
    else getIndex(0, code, (err, fn) => {
      if (fn === Names.syntaxQuote) {
        if (code.length === 2) {
          const syms = new Map<string, string>()
          function gensyms(name: string): string {
            let sym = syms.get(name)
            if (!sym) {
              sym = env.gensym(name)
              syms.set(name, sym)
            }
            return sym
          }
          getIndex(1, code, (err, x) =>
            syntaxQuote(x, scope.qualified, gensyms, (err, y) => {
            if (err) raise(env, err, cb)
            else env.defer(
              (env, cb) => macroExpandTop(env, scope, <Jaspr>y, cb),
              () => ({action: 'macroexpand', code: y})
            ).await(cb)
          }))
        } else raise(env, {
          err: 'BadArgs',
          why: `${Names.syntaxQuote} takes 1 argument, got ${code.length - 1}`,
          fn: Names.syntaxQuote, args: code.slice(1)
        }, cb)
      } else if (typeof fn === 'string' && scope.macro[fn] !== undefined) {
        getKey(fn, scope.macro, (err, macro) => {
          const args = code.slice(1)
          call(env, macro, args, expanded => env.defer(
            (env, cb) => macroExpandTop(env, scope, expanded, cb),
            () => ({action: 'macroexpand', code: expanded})
          ).await(cb))
        })
      } else cb(code)
    })
  } else cb(code)
}

function isLiteral(code: Jaspr | Deferred) {
  return !code || code === true || typeof code === "number" || _.isEmpty(code)
}

export function macroExpand(env: Env, scope: Scope, code: Jaspr, cb: Callback): void {
  function deferExpand(code: Jaspr | Deferred, k: number | string): Jaspr | Deferred {
    if (isLiteral(code) || typeof code === "string") return code
    else return env.defer(
      (env, cb) => waitFor(code, c => macroExpand(env, scope, c, cb)),
      () => ({action: 'macroexpand', code}))
  }
  (cb => {
    if (isArray(code) && code.length > 0 &&
          !(code.length === 2 && code[0] === '') &&
          !(code.length === 4 && code[0] === Names.closure)) {
      macroExpandTop(env, scope, code, cb)
    } else cb(code)
  })((code: Jaspr) => {
    if (isObject(code)) cb(_.mapValues(code, deferExpand))
    else if (isArray(code)) {
      if (code.length === 2 && code[0] === '') cb(code)
      else if (code.length === 4 && code[0] === Names.closure) {
        getIndex(1, code, (err, defs) => {
          const notObject = (x: string) => raise(env, {
            err: 'BadArgs', why: `closure ${x} must be an object`,
            fn: Names.closure, args: code.slice(1)
          }, replacement => macroExpand(env, scope, replacement, cb))
          if (!isObject(defs)) notObject('defs')
          else getIndex(3, code, (err, fields) => {
            if (!isObject(fields)) notObject('fields')
            else if (_.some(Object.keys(defs), k => k.startsWith('macro.'))) {
              const out =
                [Names.closure, defs, code[2], _.mapValues(fields, deferExpand)]
              out[<any>unexpandedSymbol] = true
              cb(out)
            } else cb([Names.closure,
              _.mapValues(defs, (code, name) => env.defer(
                (env, cb) => waitFor(code, c => macroExpand(env, scope, c, cb)),
                () => ({action: 'macroexpand', code}),
                true, [[env.nameVar, name]])),
              deferExpand(code[2], 2),
              _.mapValues(fields, deferExpand)
            ])
          })
        })
      } else cb(code.map(deferExpand))
    } else cb(code)
  })
}

const gensymRegex = /^[.]([^.]+)[.]$/

function innerSyntaxQuote(
  code: Jaspr,
  qualified: Dictionary<string>,
  gensyms: (name: string) => string,
  cb: (err: JasprError | null, value: Jaspr, isFlattened: boolean) => void
): void {
  if (isArray(code) && code.length > 0) {
    getIndex(0, code, (err, fn) => {
      if (fn === '' || fn === Names.syntaxQuote) {
        return cb(null, ['', code], false)
      }
      resolveArray(code, xs => {
        if (fn === Names.unquote) {
          if (xs.length === 2) cb(null, xs[1], false)
          else cb({
            err: 'BadArgs', why: `${Names.unquote} takes exactly 1 argument`,
            fn: Names.unquote, args: xs.slice(1)
          }, null, false)
        } else if (fn === Names.unquoteSplicing) {
          if (xs.length === 2) cb(null, xs[1], true)
          else cb({
            err: 'BadArgs', why: `${Names.unquote} takes exactly 1 argument`,
            fn: Names.unquote, args: xs.slice(1)
          }, null, false)
        } else {
          let toConcat: Jaspr[] = [], currentArray: Jaspr[] = []
          async.eachSeries<Jaspr, JasprError | null>(xs,
            (x, cb) => innerSyntaxQuote(x, qualified, gensyms, (err, v, flat) => {
              if (err) return cb(err)
              if (flat) {
                if (currentArray.length > 0) {
                  toConcat.push([[], ...currentArray])
                  currentArray = []
                }
                toConcat.push(v)
              } else currentArray.push(v)
              cb(null)
            }), (err) => {
              if (err) cb(err, null, false)
              else if (toConcat.length === 0) cb(null, [[], ...currentArray], false)
              else {
                if (currentArray.length > 0) toConcat.push([[], ...currentArray])
                cb(null, [Names.arrayConcatQualified, ...toConcat], false)
              }
            })
        }
      })
    })
  } else if (isObject(code)) {
    resolveObject(code, obj =>
      async.mapValues<Jaspr, Jaspr, JasprError | null>(obj,
        (v, k, cb) => syntaxQuote(v, qualified, gensyms, cb),
        (err, res) =>
          cb(err || null, <Jaspr>_.mapKeys(res || {}, (v, k) => {
            const gensymMatch = gensymRegex.exec(k)
            return gensymMatch ? gensyms(gensymMatch[1]) : k
          }), false)))
  } else if (typeof code === 'string') {
    const gensymMatch = gensymRegex.exec(code)
    cb(null, ['',
      gensymMatch ? gensyms(gensymMatch[1]) :
      typeof qualified[code] === 'string' ? qualified[code] : code], false)
  } else cb(null, code, false)
}

function syntaxQuote(
  code: Jaspr,
  qualified: Dictionary<string>,
  gensyms: (name: string) => string,
  cb: AsyncResultCallback<Jaspr, JasprError | null>,
): void {
  innerSyntaxQuote(code, qualified, gensyms, (err, value, isFlattened) => {
    if (err) cb(err, null)
    else if (isFlattened) cb({
      err: 'NotCallable', why: 'encountered ~@ outside of array',
      callee: Names.unquoteSplicing, args: (<any[]>code).slice(1)
    }, null)
    else cb(null, value)
  })
}

export function call(
  env: Env, callee: Jaspr, args: JasprArray, cb: Callback, inherit = true
): void {
  const badArgs = (why: string, extras = {}) =>
    raise(env, <any>_.assign({err: 'BadArgs', why, fn: callee, args}, extras), cb)
  const notCallable = (why: string) =>
    raise(env, {err: 'NotCallable', why, callee, args}, cb)
  if (isClosure(env, callee)) {
    if (Names.code in callee) callClosure(env, callee, args, true, cb)
    else notCallable('closure has no code')
  } else if (isArray(callee)) {
    if (callee.length === 0) cb(args)
    else notCallable('cannot call a non-empty array')
  } else if (isObject(callee)) {
    if (_.isEmpty(callee)) {
      if (args.length % 2 !== 0) badArgs('{} takes an even number of arguments')
      else async.parallel(
        _.range(0, args.length, 2).map(i =>
          (cb: (err?: JasprError, x?: [string, Jaspr | Deferred]) => void) =>
            getIndex(i, args, (err, key) => {
              if (err) cb(err)
              else if (typeof key !== 'string') {
                badArgs('key is not a string', {key})
              } else cb(undefined, [key, args[i + 1]])
            })),
        (err, xs) => {
          if (err) raise(env, err, cb)
          else cb(_.fromPairs(<any[]>xs))
        })
    } else notCallable('cannot call non-closure, non-empty object')
  } else if (typeof callee === "number") {
    if (args.length !== 1) badArgs(`index takes 1 argument, got ${args.length}`)
    else getIndex(0, args, (err, receiver) => {
      if (isArray(receiver)) {
        let index = callee < 0 ? receiver.length + callee : callee
        getIndex(index, receiver, (err, x) => err ? raise(env, err, cb) : cb(x))
      } else badArgs('numeric index into non-array')
    })
  } else if (typeof(callee) === "string") {
    if (args.length !== 1) badArgs(`index takes 1 argument, got ${args.length}`)
    else getIndex(0, args, (err, receiver) => {
      if (isObject(receiver)) {
        getKey(callee, receiver, (err, x) => err ? raise(env, err, cb) : cb(x))
      } else badArgs('string index into non-object')
    })
  } else notCallable('not closure, number, string, [], or {}')
}

export function evalExpr(env: Env, scope: Scope, code: Jaspr, cb: Callback, context: Jaspr = code): void {
  function deferEval(code2: Jaspr | Deferred, inherit?: boolean): Jaspr | Deferred {
    if (isLiteral(code2)) return code2
    else return env.defer(
      (env, cb) => waitFor(code2, c => evalExpr(env, scope, c, cb, code)),
      () => ({action: 'eval', code: code2}),
      inherit)
  }
  if (typeof code === 'string' && code !== '') {
    if (code.startsWith(Names.prefix) && code !== Names.args) {
          return raise(env, {
            err: 'NoBinding', why: 'no accessible binding for reserved name',
            name: code, context
          }, cb)
      }
    const variable = scope.value[code]
    if (variable === undefined) {
      return raise(env,
        {err: 'NoBinding', why: 'name not defined', name: code, context}, cb)
    } else return waitFor(variable, cb)
  } else if (isArray(code) && code.length > 0) getIndex(0, code, (err, fn) => {

      // empty string: quote
      if (fn === '') {
        if (code.length === 2) getIndex(1, code, (err, x) => cb(x))
        else raise(env, {
          err: 'BadArgs',
          why: `empty string (quote) takes 1 argument, got ${code.length - 1}`,
          fn: '', args: code.slice(1)
        }, cb)
      }

      // "magic" special forms
      else if (typeof fn === "string" && _.startsWith(fn, Names.prefix)) {
        const assertArgs = (len: number) => {
          if (code.length === len + 1) return true
          raise(env, {
            err: 'BadArgs', why: `${fn} takes exactly ${len} arguments`,
            fn, args: code.slice(1)
          }, cb)
          return false
        }
        switch (fn) {
        case Names.if_:
          if (assertArgs(3)) {
            waitFor(deferEval(code[1]), b =>
              waitFor(deferEval(code[toBool(b) ? 2 : 3], true), cb))
          }
          break
        case Names.then:
          if (assertArgs(2)) {
            waitFor(deferEval(code[1]), () => waitFor(deferEval(code[2], true), cb))
          }
          break
        case Names.junction:
          env.junction(
            code.slice(1).map(code => (env: Env, cb: Callback) =>
              waitFor(code, c => evalExpr(env, scope, c, cb))),
            () => ({action: 'junction', code}),
            true).await(cb)
          break
        case Names.closure:
          if (assertArgs(3)) {
            const unexpandedMacros = !!code[<any>unexpandedSymbol]
            resolveArray(code, ([closure, defs, code, fields]) => {
              if (!isObject(defs)) raise(env, {
                err: 'BadArgs', why: 'closure scope must be an object',
                fn, args: [defs, code, fields]
              }, cb)
              else if (!isObject(fields)) raise(env, {
                err: 'BadArgs', why: 'closure fields must be an object',
                fn, args: [defs, code, fields]
              }, cb)
              else evalDefs(env, undefined, scope, defs, ((err, cScope) => {
                if (err) raise(env, err, cb)
                else env.getDynamic(env.nameVar, name => cb(_.assignIn({
                  [env.closureName]: cScope,
                  [Names.code]: unexpandedMacros
                    ? env.defer(
                        (env, cb) => macroExpand(env, <Scope>cScope, code, cb),
                        () => ({action: 'macroexpand', code})) : code,
                  [magicSymbol]: {name}
                }, fields)))
              }))
            })
          }
          break
        case Names.eval_:
          if (assertArgs(1)) {
            getIndex(1, code, (err, v) => 
              waitFor(deferEval(v), v => waitFor(deferEval(v), cb)))
          }
          break
        case Names.macroexpand:
          if (assertArgs(1)) {
            getIndex(1, code, (err, v) =>
              waitFor(deferEval(v), code => env.defer(
                (env, cb) => macroExpand(env, scope, code, cb),
                () => ({action: 'macroexpand', code})
              ).await(cb)))
          }
          break
        case Names.contextGet:
          if (assertArgs(2)) {
            getIndex(1, code, (err, ctx) => getIndex(2, code, (err, name) => {
                if (typeof name !== 'string') raise(env, {
                err: 'BadArgs', why: 'name must be a string',
                fn, args: [ctx, name]
                }, cb)
              else getKey('' + ctx, scope, (err, context) => {
                  if (err || !isObject(context)) raise(env, {
                    err: 'NoBinding', why: 'context does not exist in scope',
                  context: '' + ctx
                  }, cb)
                  else getKey(name, context, (err, val) => {
                    if (err) raise(env, {
                      err: 'NoBinding', why: 'name not defined in context',
                    context: '' + ctx, name
                    }, cb)
                    else cb(val)
                  })
                })
              }))
          }
          break
        case Names.dynamicLet:
          if (assertArgs(3)) {
            waitFor(deferEval(code[1]), (dyn: JasprDynamic) => {
              env.defer(
                (env, cb) => waitFor(code[3], c => evalExpr(env, scope, c, cb, code)),
                () => ({action: 'eval', code: code[3]}),
                false, [[dyn, deferEval(code[2])]]
              ).await(cb)
            })
          }
          break
        case Names.syntaxQuote:
          raise(env, {
            err: 'NoPrimitive', why: `${fn} cannot be evaluated, must be macroexpanded`,
            callee: fn, code
          }, cb)
          break
        case Names.unquote:
        case Names.unquoteSplicing:
          raise(env, {
            err: 'NoPrimitive', why: `${fn} cannot occur outside ${Names.syntaxQuote}`,
            callee: fn, code
          }, cb)
          break
        default:
          raise(env, {
            err: 'NoPrimitive', why: 'no such special form', callee: fn, code
          }, cb)
        }
      }

      // all other calls: functions and indexes
      else {
        const elements = code.map(x => deferEval(x))
        waitFor(elements[0], efn => call(env, efn, elements.slice(1), cb))
      }
    })
  else if (isObject(code)) {
    if (isClosure(env, code)) raise(env, {
      err: 'EvalFailed', why: 'cannot eval a closure', code
    }, cb)
    else cb(_.mapValues(code, x => deferEval(<any>x)))
  } else cb(code)
}

export function deferExpandEval(
  env: Env, scope: Scope | PromiseLike<Scope>, code: Jaspr | Deferred,
  name?: string
): Deferred {
  const scopePromise = Promise.resolve(scope)
  const expanded = env.defer(
    (env, cb) => scopePromise.then(
      scope => waitFor(code, c => macroExpand(env, scope, c, cb)),
      err => raise(env, err, cb)),
    () => ({action: 'macroexpand', code, name}),
    false, name ? [[env.nameVar, name]] : [])
  return env.defer(
    (env, cb) => scopePromise.then(
      scope => expanded.await(c => evalExpr(env, scope, c, cb)),
      err => raise(env, err, cb)),
    () => ({action: 'eval', code: expanded, name}),
    false, name ? [[env.nameVar, name]] : [])
}

export interface Namespace {
  $module: string | null,
  $version: string | null
}

export function qualify(ns: Namespace, name: string): string {
  if (ns.$module) return `${ns.$module}.${name}@${ns.$version || ''}`
  else return name
}

export function evalDefs(
  env: Env,
  module: Namespace | null | undefined,
  evalScope: Scope,
  defs: JasprObject,
  cb: AsyncResultCallback<Scope, JasprError>
): void {

  // Validate all names
  for (let name in defs) {
    let names = name.split('.')
    if (names.length === 2) {
      if (topLevelPrefixes.has(names[0])) {
        if (!module && (names[0] === 'doc' || names[0] === 'test')) return cb({
          err: 'BadName', why: 'prefix only allowed at module toplevel',
          prefix: names[0], name,
          help: 'Documentation and tests cannot be defined using “let”.'
        })
        if (names[0] == 'doc' && typeof defs[name] !== 'string') return cb({
          err: 'BadModule', why: 'doc is not a string', name, value: defs[name],
          help: 'Documentation must be a literal string, not an expression.'
        })
        names = names.slice(1)
      }
      else return cb(<any>_.assign({
        err: 'BadName', why: 'not a legal top-level prefix',
        prefix: names[0], name,
        help: `Legal top-level prefixes are: ${_.join([...topLevelPrefixes])}`
      }, module ? {module: module.$module, version: module.$version} : {}))
    }
    if (names.length === 0 || !_.every(names, isLegalName)) return cb(
      <any>_.assign({
        err: 'BadName', why: 'not a legal identifier', name,
      help: `
        Names may not contain reserved characters (whitespace or anything that
        is part of Jaspr syntax); may not have leading, trailing, or
        consecutive “.”; may not have leading “$”; and may not be empty.
      `.trim().replace(/\s+/gm, ' ')
      }, module ? {module: module.$module, version: module.$version} : {}))
  }

  function splitName(k: string): [string, string] {
    const dotIndex = k.lastIndexOf('.')
    return dotIndex < 0
      ? ['value', k]
      : [k.slice(0, dotIndex), k.slice(dotIndex + 1)]
  }
  const defsByPrefix = _(defs).keys()
    .reject(k => _.startsWith(k, Names.prefix))
    .groupBy(key => splitName(key)[0])
    .value()
  let scope: Scope
  const out = new Promise<Scope>(resolve => setImmediate(() => resolve({
    value: _.create(evalScope.value, scope.value),
    macro: _.create(evalScope.macro, scope.macro),
    check: _.create(evalScope.check, scope.check),
    doc: _.create(evalScope.doc, scope.doc),
    test: _.create(evalScope.test, scope.test),
    qualified: _.create(evalScope.qualified, scope.qualified),
  })))
  scope = _.assignIn(
    {value: {}, macro: {}, check: {}, doc: {}, test: {},
     qualified: _(defsByPrefix).omit('test').values().flatten()
        .map((k: string) => splitName(k)[1]).uniq()
        .flatMap(module && module.$module
                 ? k => [[k, qualify(module, k)],
                         [`${module.$module}.${k}`, qualify(module, k)]]
                 : k => [[k, k]])
        .fromPairs().value()
    }, _.mapValues(defsByPrefix, (ks, prefix) => {
      const mapFn: (k: string) => any =
        (prefix === 'doc' || prefix === 'test') ? k => defs[k]
        : k => deferExpandEval(env, out, defs[k],
            module ? qualify(module, splitName(k)[1]) : splitName(k)[1])
      return _.fromPairs(
        (module && module.$module && prefix !== 'test')
        ? _.flatMap(ks, k => {
            const name = splitName(k)[1], value = mapFn(k)
            return [
              [name, value],
              [`${module.$module}.${name}`, value],
              [qualify(module, name), value]
            ]
          })
        : ks.map(k => [splitName(k)[1], mapFn(k)]))
    }))
  out.then(s => cb(undefined, s))
}
