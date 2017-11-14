import * as _ from 'lodash'
import * as async from 'async'
import {legalName, number} from './Parser'
import builtins from './BuiltinFunctions'
import * as Names from './ReservedNames'
import {
  Jaspr, JasprArray, JasprObject, JasprClosure, JasprError, JasprDynamic, Scope,
  isArray, isObject, isClosure, isDynamic, Deferred, Callback, getIndex, getKey,
  resolveArray, resolveObject, resolveFully, toString, toBool, emptyScope,
  magicSymbol, closureMarker, makeDynamic,
} from './Jaspr'

export interface Env {
  defer(options: DeferOptions): Deferred
  unhandledError(err: Jaspr, cb: Callback): void
  getDynamic(dyn: JasprDynamic, cb: Callback): void
  testFailure(err: Error): void
}

export type DeferOptions = {
  fn: (env: Env, cb: Callback) => void
  action?: Action
  code?: Jaspr | Deferred
  inherit?: boolean
  junction?: boolean
  dynamics?: [JasprDynamic, Jaspr | Deferred][]
}

export enum Action {
  Eval, MacroExpand, Check, Junction, Send, Recv, External
}

export namespace Dynamics {
  export const signalHandler =
    makeDynamic({
      [Names.closure]: {},
      [Names.code]: [Names.unhandledError, [0, Names.args]]
    })
  export const name = makeDynamic(null)
  export const module = makeDynamic(null)
}

export function isLegalName(name: string) {
  return name !== 'null' && name !== 'true' && name !== 'false' &&
         legalName.test(name) && !number.test(name)
}

export const topLevelPrefixes = new Set(['value', 'macro', 'check', 'doc', 'test'])

export function waitFor(v: Jaspr | Deferred, cb: Callback): void {
  if (v instanceof Deferred) v.await(cb)
  else cb(v)
}

const unexpandedSymbol = Symbol('unexpandedMacros')

export function raise(env: Env, error: JasprError, cb: Callback): void {
  env.getDynamic(Dynamics.signalHandler, handler => {
    if (handler && isClosure(handler) && Names.code in handler) {
      // Call the error handler. Code borrowed from call(), but with a small
      // modification: the call fiber is not adjacent to the fiber that threw
      // the error.
      resolveObject(handler, ({[Names.code]: code, [Names.closure]: scope}) => {
        const newScope: Scope =
          _.create(scope, {value: _.create(scope.value, {[Names.args]: [error]})})
        env.defer({
          action: Action.Eval, code,
          fn: (env, cb) => evalExpr(env, newScope, code, cb)
        }).await(cb)
      })
    } else env.unhandledError(error, cb)
  })
}

export function macroExpandTop(env: Env, scope: Scope, code: Jaspr, cb: Callback): void {
  if (isArray(code)) {
    if (code.length === 0) cb(code)
    else getIndex(0, code, (err, fn) => {
      if (fn === Names.syntaxQuote) {
        if (code.length === 2) {
          getIndex(1, code, (err, x) => syntaxQuote(x, (err, y) => {
            if (err) raise(env, err, cb)
            else env.defer({
              action: Action.MacroExpand,
              code: y,
              fn: (env, cb) => macroExpandTop(env, scope, <Jaspr>y, cb)
            }).await(cb)
          }))
        } else raise(env, {
          err: 'BadArgs',
          why: `${Names.syntaxQuote} takes 1 argument, got ${code.length - 1}`,
          fn: Names.syntaxQuote, args: code.slice(1)
        }, cb)
      } else if (typeof fn === 'string' && scope.macro[fn] !== undefined) {
        getKey(fn, scope.macro, (err, macro) => {
          const args = code.slice(1)
          call(env, macro, args, expanded => env.defer({
            action: Action.MacroExpand,
            code: expanded,
            fn: (env, cb) => macroExpandTop(env, scope, expanded, cb)
          }).await(cb))
        })
      } else cb(code)
    })
  } else cb(code)
}

export function macroExpand(env: Env, scope: Scope, code: Jaspr, cb: Callback): void {
  function deferExpand(code: Jaspr | Deferred, k: number | string): Jaspr | Deferred {
    if (!code || code === true || typeof code === "number" ||
        typeof code === "string" || k === Names.closure) {
      return code
    }
    return env.defer({
      action: Action.MacroExpand, code, inherit: true,
      fn: (env, cb) => waitFor(code, c => macroExpand(env, scope, c, cb))
    })
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
              _.mapValues(defs, (code, name) => env.defer({
                action: Action.MacroExpand, code, inherit: true,
                dynamics: [[Dynamics.name, name], [Dynamics.module, null]],
                fn: (env, cb) => waitFor(code, c => macroExpand(env, scope, c, cb))
              })),
              deferExpand(code[2], 2),
              _.mapValues(fields, deferExpand)
            ])
          })
        })
      } else cb(code.map(deferExpand))
    } else cb(code)
  })
}

function innerSyntaxQuote(
  code: Jaspr, cb: (err: JasprError | null, value: Jaspr, isFlattened: boolean) => void
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
            (x, cb) => innerSyntaxQuote(x, (err, v, flat) => {
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
                cb(null, [Names.arrayConcat, ...toConcat], false)
              }
            })
        }
      })
    })
  } else if (isObject(code)) {
    resolveObject(code, obj =>
      async.mapValues<Jaspr, Jaspr, JasprError | null>(obj,
        (v, k, cb) => syntaxQuote(v, cb),
        (err, res) => cb(<JasprError|null>err, <JasprObject>res, false)))
  } else cb(null, ['', code], false)
}

function syntaxQuote(code: Jaspr, cb: AsyncResultCallback<Jaspr, JasprError | null>): void {
  innerSyntaxQuote(code, (err, value, isFlattened) => {
    if (err) cb(err, null)
    else if (isFlattened) cb({
      err: 'NotCallable', why: 'encountered ~@ outside of array',
      callee: Names.unquoteSplicing, args: (<any[]>code).slice(1)
    }, null)
    else cb(null, value)
  })
}

export function call(env: Env, callee: Jaspr, args: JasprArray, cb: Callback): void {
  if (isClosure(callee)) {
    if (Names.code in callee) resolveObject(callee,
      ({[Names.code]: code, [Names.closure]: scope}) => {
        const newScope: Scope =
          _.create(scope, {value: _.create(scope.value, {[Names.args]: args})})
        env.defer({
          action: Action.Eval, code, inherit: true,
          fn: (env, cb) => evalExpr(env, newScope, code, cb)
        }).await(cb)
      })
    else raise(env, {
      err: 'NotCallable', why: 'closure has no code', callee, args
    }, cb)
  } else if (isArray(callee)) {
    if (callee.length == 0) cb(args)
    else raise(env, {
      err: 'NotCallable', why: 'cannot call a non-empty array', callee, args
    }, cb)
  } else if (isObject(callee)) {
    if (_.isEmpty(callee)) {
      if (args.length % 2 != 0) raise(env, {
        err: 'BadArgs', why: '{} takes an even number of arguments',
        fn: callee, args
      }, cb)
      else async.parallel(
        _.range(0, args.length, 2).map(i =>
          (cb: (err?: JasprError, x?: [string, Jaspr | Deferred]) => void) =>
            getIndex(i, args, (err, key) => {
              if (err) cb(err)
              else if (typeof key !== 'string') {
                cb({ err: 'BadArgs', why: 'key is not a string',
                     key, fn: callee, args })
              } else cb(undefined, [key, args[i + 1]])
            })),
        (err, xs) => {
          if (err) raise(env, err, cb)
          else cb(_.fromPairs(<any[]>xs))
        })
    } else raise(env, {
      err: 'NotCallable', why: 'cannot call non-closure, non-empty object',
      callee, args
    }, cb)
  } else if (typeof callee === "number") {
    if (args.length !== 1) raise(env, {
      err: 'BadArgs', why: `index takes 1 argument, got ${args.length}`,
      fn: callee, args
    }, cb)
    else getIndex(0, args, (err, receiver) => {
      if (isArray(receiver)) {
        let index = callee < 0 ? receiver.length + callee : callee
        getIndex(index, receiver, (err, x) => {
          if (err) raise(env, err, cb)
          else cb(x)
        })
      } else raise(env, {
        err: 'BadArgs', why: 'numeric index into non-array',
        fn: callee, args: [receiver]
      }, cb)
    })
  } else if (typeof(callee) === "string") {
    if (args.length !== 1) raise(env, {
      err: 'BadArgs', why: `index takes 1 argument, got ${args.length}`,
      fn: callee, args
    }, cb)
    else getIndex(0, args, (err, receiver) => {
      if (isObject(receiver)) getKey(callee, receiver, (err, x) => {
        if (err) raise(env, err, cb)
        else cb(x)
      })
      else raise(env, {
        err: 'BadArgs', why: 'string index into non-object',
        fn: callee, args: [receiver]
      }, cb)
    })
  } else raise(env, {
    err: 'NotCallable', why: 'not closure, number, string, [], or {}',
    callee, args
  }, cb)
}

export function evalExpr(env: Env, scope: Scope, code: Jaspr, cb: Callback, context: Jaspr = code): void {
  function deferEval(code2: Jaspr | Deferred, inherit?: boolean): Deferred {
    return env.defer({
      action: Action.Eval, code: code2, inherit,
      fn: (env, cb) => waitFor(code2, c => evalExpr(env, scope, c, cb, code))
    })
  }
  if (typeof code === 'string' && code !== '') {
    if (code.startsWith(Names.prefix) && code !== Names.args) {
      switch (code) {
        case Names.signalHandler: return cb(Dynamics.signalHandler)
        case Names.name: return cb(Dynamics.name)
        case Names.module: return cb(Dynamics.module)
        default:
          return raise(env, {
            err: 'NoBinding', why: 'no accessible binding for reserved name',
            name: code, context
          }, cb)
      }
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
            deferEval(code[1]).await(b =>
              deferEval(code[toBool(b) ? 2 : 3], true).await(cb))
          }
          break
        case Names.then:
          if (assertArgs(2)) {
            deferEval(code[1]).await(() => deferEval(code[2], true).await(cb))
          }
          break
        case Names.junction:
          env.defer({
            action: Action.Junction, code, fn: (env, cb) => {
              const branches = code.slice(1).map((x, i) => {
                const branch = deferEval(x)
                branch.await(v => {
                  for (let j = 0; j < branches.length; j++) {
                    if (j !== i) branches[j].cancel()
                  }
                  cb(v)
                })
                return branch
              })
            }
          }).await(cb)
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
                else cb(_.merge({
                  [Names.closure]: cScope,
                  [Names.code]: unexpandedMacros
                    ? env.defer({
                      action: Action.MacroExpand, code,
                      fn: (env, cb) => macroExpand(env, <Scope>cScope, code, cb)
                    }) : code,
                  [magicSymbol]: closureMarker
                }, fields))
              }))
            })
          }
          break
        case Names.eval_:
          if (assertArgs(1)) {
            getIndex(1, code, (err, v) => 
              deferEval(v).await(v => deferEval(v).await(cb)))
          }
          break
        case Names.macroexpand:
          if (assertArgs(1)) {
            getIndex(1, code, (err, v) =>
              deferEval(v).await(code => env.defer({
                action: Action.MacroExpand, code,
                fn: (env, cb) => macroExpand(env, scope, code, cb)
              }).await(cb)))
          }
          break
        case Names.contextGet:
          if (assertArgs(2)) {
            getIndex(1, code, (err, contextName) =>
              deferEval(code[2]).await(name => {
                if (typeof name !== 'string') raise(env, {
                  err: 'BadArgs', why: 'name must evaluate to a string',
                  fn, args: [contextName, name]
                }, cb)
                else getKey('' + contextName, scope, (err, context) => {
                  if (err || !isObject(context)) raise(env, {
                    err: 'NoBinding', why: 'context does not exist in scope',
                    context: '' + contextName
                  }, cb)
                  else getKey(name, context, (err, val) => {
                    if (err) raise(env, {
                      err: 'NoBinding', why: 'name not defined in context',
                      context: '' + contextName, name
                    }, cb)
                    else cb(val)
                  })
                })
              }))
          }
          break
        case Names.dynamicLet:
          if (assertArgs(3)) {
            deferEval(code[1]).await((dyn: JasprDynamic) => {
              env.defer({
                action: Action.Eval, code: code[3],
                dynamics: [[dyn, deferEval(code[2])]],
                fn: (env, cb) => waitFor(code[3], c => evalExpr(env, scope, c, cb, code))
              }).await(cb)
            })
          }
          break
        case Names.unhandledError:
          deferEval(code[1]).await(v => env.unhandledError(v, cb))
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
          if (builtins.hasOwnProperty(fn)) {
            resolveArray(code.slice(1).map(x => deferEval(x)), args => {
              try { builtins[fn](env, args, cb) } catch (ex) {
                if (ex.name === 'AssertionError') {
                  throw ex // Let test assertions pass through
                } else if (ex instanceof Error) {
                  raise(env, {
                    err: 'NativeError',
                    why: `uncaught JavaScript exception in ${fn}`,
                    name: ex.name,
                    message: ex.message,
                    stack: ex.stack || null
                  }, cb)
                } else raise(env, ex, cb)
              }
            })
          } else raise(env, {
            err: 'NoPrimitive', why: 'no such special form', callee: fn, code
          }, cb)
        }
      }

      // all other calls: functions and indexes
      else {
        const elements = code.map(x => deferEval(x))
        elements[0].await(efn => call(env, efn, elements.slice(1), cb))
      }
    })
  else if (isObject(code)) {
    if (isClosure(code)) raise(env, {
      err: 'EvalFailed', why: 'cannot eval a closure', code
    }, cb)
    else cb(_.mapValues(code, x => deferEval(x)))
  } else cb(code)
}

export function deferExpandEval(
  env: Env, scope: Scope | PromiseLike<Scope>, code: Jaspr | Deferred,
  name?: string, module?: string
): Deferred {
  const scopePromise = Promise.resolve(scope)
  const expanded = env.defer({
    action: Action.MacroExpand, code,
    dynamics: [[Dynamics.name, name || null], [Dynamics.module, module || null]],
    fn: (env, cb) => scopePromise.then(
      scope => waitFor(code, c => macroExpand(env, scope, c, cb)),
      err => raise(env, err, cb))
  })
  return env.defer({
    action: Action.Eval, code: expanded,
    dynamics: [[Dynamics.name, name || null], [Dynamics.module, module || null]],
    fn: (env, cb) => scopePromise.then(
      scope => expanded.await(c => evalExpr(env, scope, c, cb)),
      err => raise(env, err, cb))
  })
}

export function evalDefs(
  env: Env,
  module: string | null | undefined,
  evalScope: Scope,
  defs: JasprObject,
  cb: AsyncResultCallback<Scope, JasprError>
): void {

  // Validate all names
  for (let name in defs) {
    let names = name.split('.')
    if (names.length === 2) {
      if (topLevelPrefixes.has(names[0])) {
        if (module === undefined && (names[0] === 'doc' || names[0] === 'test')) return cb({
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
      else return cb({
        err: 'BadName', why: 'not a legal top-level prefix',
        prefix: names[0], name, module: module || null,
        help: `Legal top-level prefixes are: ${_.join([...topLevelPrefixes])}`
      })
    }
    if (names.length === 0 || !_.every(names, isLegalName)) return cb({
      err: 'BadName', why: 'not a legal identifier', name,  module: module || null,
      help: `
        Names may not contain reserved characters (whitespace or anything that
        is part of Jaspr syntax); may not have leading, trailing, or
        consecutive “.”; may not have leading “$”; and may not be empty.
      `.trim().replace(/\s+/gm, ' ')
    })
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
  scope = _.merge({value: {}, macro: {}, check: {}, doc: {}, test: {},
      qualified: module
        ? _(defs).omitBy(k => _.startsWith(k, Names.prefix))
                 .mapKeys((v: Jaspr, k: string) => splitName(k)[1])
                 .mapValues((v: Jaspr, k: string) => module + '.' + k)
                 .value()
        : {}},
    _.mapValues(defsByPrefix, (ks, prefix) => {
      const mapFn: (k: string) => any =
        (prefix === 'doc' || prefix === 'test') ? k => defs[k]
        : k => deferExpandEval(env, out, defs[k], splitName(k)[1], module || undefined)
      return _.fromPairs(
        (module && prefix !== 'test')
        ? _.flatMap(ks, k => {
            const name = splitName(k)[1], value = mapFn(k)
            return [[name, value], [module + '.' + name, value]]
          })
        : ks.map(k => [splitName(k)[1], mapFn(k)]))
    }))
  out.then(s => cb(undefined, s))
}
