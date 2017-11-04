import * as _ from 'lodash'
import * as async from 'async'
import {legalName, number} from './Parser'
import builtins from './BuiltinFunctions'
import * as Names from './ReservedNames'
import {
  Jaspr, JasprArray, JasprObject, JasprClosure, Scope, isArray, isObject,
  isClosure, Deferred, Callback, getIndex, getKey, resolveArray, resolveObject,
  resolveFully, toString, toBool, emptyScope
} from './Jaspr'

export interface Env extends Channels, Dynamics {
  defer(options: DeferOptions): Deferred
  unhandledError(err: Jaspr, cb: Callback): void
  processId(): string
}

export type DeferOptions = {
  fn: (env: Env, cb: Callback) => void
  action?: Action
  code?: Jaspr | Deferred
  inherit?: boolean
  junction?: boolean
  dynamics?: [number, Jaspr | Deferred][]
}

export enum Action {
  Eval, MacroExpand, Check, Junction, Send, Recv, External
}

export interface Channels {
  makeChan(cb: (chan: number) => void): void
  send(chan: number, value: Jaspr, cb: (sent: boolean) => void): void
  recv(chan: number, cb: (err?: JasprError, val?: Jaspr) => void): void
  closeChan(chan: number, cb: (closed: boolean) => void): void
  isChanClosed(chan: number, cb: (closed: boolean) => void): void
}

export interface Dynamics {
  makeDynamic(defaultValue: Jaspr, cb: (dyn: number) => void): void
  getDynamic(dyn: number, cb: (err?: JasprError, val?: Jaspr) => void): void
}

export namespace Dynamics {
  export const error = -1
  export const name = -2
  export const module = -3
}

export function isLegalName(name: string) {
  return name !== 'null' && name !== 'true' && name !== 'false' &&
         legalName.test(name) && !number.test(name)
}

export const topLevelPrefixes = new Set(['value', 'macro', 'check', 'doc', 'test'])
export interface JasprError extends JasprObject {
  err: string
}

export function waitFor(v: Jaspr | Deferred, cb: Callback): void {
  if (v instanceof Deferred) v.await(cb)
  else cb(v)
}

export function error(env: Env, error: Jaspr, cb: Callback): void {
  env.getDynamic(Dynamics.error, (err, handler) => {
    if (err == null && handler && isClosure(handler) && Names.code in handler) {
      // Call the error handler. Code borrowed from call(), but with a small
      // modification: the call fiber is not adjacent to the fiber that threw
      // the error.
      resolveObject(handler, ({[Names.code]: code, [Names.closure]: scope}) => {
        const newScope: Scope =
          _.create(scope, {value: _.create(scope.value, {[Names.args]: [error]})})
        env.defer({
          action: Action.Eval, code,
          fn: (env, cb) => evalExpr(env, newScope, code, cb)
        })
      })
    } else {
      // TODO: Call the default error handler here.
      throw new Error("No valid error handler found!")
    }
  })
}

export function macroExpandTop(env: Env, scope: Scope, code: Jaspr, cb: Callback): void {
  if (isArray(code)) {
    if (code.length === 0) cb(code)
    else getIndex(0, code, (err, fn) => {
      if (fn === Names.syntaxQuote) {
        if (code.length === 2) {
          getIndex(1, code, (err, x) => syntaxQuote(x, (err, y) => {
            if (err) error(env, err, cb)
            else env.defer({
              action: Action.MacroExpand,
              code: y,
              fn: (env, cb) => macroExpandTop(env, scope, <Jaspr>y, cb)
            }).await(cb)
          }))
        } else error(env, {
          err: `${Names.syntaxQuote} takes 1 argument, got ${code.length - 1}`,
          code
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
  if (isArray(code) && code.length > 0 && !(code.length === 2 && code[0] === '')) {
    macroExpandTop(env, scope, code, expanded => {
      if (isArray(expanded) && 
          expanded.length > 0 &&
          !(expanded.length === 2 && expanded[0] === '')) {
        getIndex(0, expanded, (err, fn) => {
          if (fn === '') cb(expanded)
          else cb(expanded.map(deferExpand))
        })
      }
      else if (isObject(code)) cb(_.mapValues(code, deferExpand))
      else cb(expanded)
    })
  }
  else if (isObject(code)) cb(_.mapValues(code, deferExpand))
  else cb(code)
}

function innerSyntaxQuote(
  code: Jaspr, cb: (err: JasprError | null, value: Jaspr, isFlattened: boolean) => void
): void {
  const fail = (err: string) => cb({err, code}, null, false)
  if (isArray(code) && code.length > 0) {
    getIndex(0, code, (err, fn) => {
      if (fn === '' || fn === Names.syntaxQuote) {
        return cb(null, ['', code], false)
      }
      resolveArray(code, xs => {
        if (fn === Names.unquote) {
          if (xs.length === 2) cb(null, xs[1], false)
          else fail(`${Names.unquote} takes exactly 1 argument`)
        } else if (fn === Names.unquoteSplicing) {
          if (xs.length === 2) cb(null, xs[1], true)
          else fail(`${Names.unquoteSplicing} takes exactly 1 argument`)
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

function syntaxQuote(code: Jaspr, cb: AsyncResultCallback<Jaspr, JasprObject | null>): void {
  innerSyntaxQuote(code, (err, value, isFlattened) => {
    if (err) cb(err, null)
    else if (isFlattened) cb({err: 'encountered ~@ outside of array', code}, null)
    else cb(null, value)
  })
}

export function call(env: Env, callee: Jaspr, args: JasprArray, cb: Callback): void {
  if (isClosure(callee)) {
    if (Names.code in callee) {
      resolveObject(callee, ({[Names.code]: code, [Names.closure]: scope}) => {
        const newScope: Scope =
          _.create(scope, {value: _.create(scope.value, {[Names.args]: args})})
        env.defer({
          action: Action.Eval, code, inherit: true,
          fn: (env, cb) => evalExpr(env, newScope, code, cb)
        }).await(cb)
      })
    } else {
      error(env, {err: "closure has no code", callee, args}, cb)
    }
  } else if (isArray(callee)) {
    if (callee.length == 0) cb(args)
    else error(env, {err: "cannot call a non-empty array", callee, args}, cb)
  } else if (isObject(callee)) {
    if (_.isEmpty(callee)) {
      if (args.length % 2 != 0) {
        return error(env, {
          err: "{} takes an even number of arguments", callee, args
        }, cb)
      }
      async.parallel(
        _.range(0, args.length, 2).map(i =>
          (cb: (err?: JasprObject, x?: [string, Jaspr | Deferred]) => void) =>
            getIndex(i, args, (err, key) => {
              if (err) cb(err)
              else if (typeof key !== 'string') {
                cb({err: "key is not a string", key, callee, args})
              } else cb(undefined, [key, args[i + 1]])
            })),
        (err, xs) => {
          if (err) error(env, err, cb)
          else cb(_.fromPairs(<any[]>xs))
        })
    } else {
      error(env, {err: "cannot call a non-closure, non-empty object", callee, args}, cb)
    }
  } else if (typeof callee === "number") {
    if (args.length !== 1) {
      error(env, {err: `index takes 1 argument, got ${args.length}`, index: callee}, cb)
    } else {
      getIndex(0, args, (err, receiver) => {
        if (isArray(receiver)) {
          let index = callee < 0 ? receiver.length + callee : callee
          getIndex(index, receiver, (err, x) => {
            if (err) error(env, err, cb)
            else cb(x)
          })
        } else error(env, 
          {err: `numeric index into non-array`, index: callee, in: receiver}, cb)
      })
    }
  } else if (typeof(callee) === "string") {
    if (callee === Names.closure) {
      error(env, {err: `cannot access "${callee}" directly`}, cb)
    } else if (args.length !== 1) {
      error(env, {err: `index takes 1 argument, got ${args.length}`, index: callee}, cb)
    } else {
      getIndex(0, args, (err, receiver) => {
        if (isObject(receiver)) {
          getKey(callee, receiver, (err, x) => {
            if (err) error(env, err, cb)
            else cb(x)
          })
        } else error(env, 
          {err: `string index into non-object`, index: callee, in: receiver}, cb)
      })
    }
  } else error(env, {err: "not callable", callee, args}, cb)
}

export function evalExpr(env: Env, scope: Scope, code: Jaspr, cb: Callback): void {
  function deferEval(code: Jaspr | Deferred, inherit?: boolean): Deferred {
    return env.defer({
      action: Action.Eval, code, inherit,
      fn: (env, cb) => waitFor(code, c => evalExpr(env, scope, c, cb))
    })
  }
  if (typeof code === 'string' && code !== '') {
    if (code.startsWith(Names.prefix) && code !== Names.args) {
      switch (code) {
        case Names.processId:
          return cb(env.processId())
        case Names.error:
          return cb({
            [Names.dynamic]: Dynamics.error,
            [Names.owner]: env.processId()
          })
        case Names.name:
          return cb({
            [Names.dynamic]: Dynamics.name,
            [Names.owner]: env.processId()
          })
        case Names.module:
          return cb({
            [Names.dynamic]: Dynamics.module,
            [Names.owner]: env.processId()
          })
        default:
          return error(env, {
            err: 'no accessible binding for reserved name',
            name: code
          }, cb)
      }
    }
    const variable = scope.value[code]
    if (variable === undefined) {
      return error(env, {err: 'no binding for name', name: code}, cb)
    } else return waitFor(variable, cb)
  } else if (isArray(code) && code.length > 0) getIndex(0, code, (err, fn) => {

      // empty string: quote
      if (fn === '') {
        if (code.length === 2) getIndex(1, code, (err, x) => cb(x))
        else error(env, {
          err: `empty string (quote) takes 1 argument, got ${code.length - 1}`,
          code
        }, cb)
      }

      // "magic" special forms
      else if (typeof fn === "string" && _.startsWith(fn, Names.prefix)) {
        const assertArgs = (len: number) => {
          if (code.length === len + 1) return true
          error(env, {err: `${fn} takes exactly ${len} arguments`, code}, cb)
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
        case Names.closure:
          if (assertArgs(3)) {
            resolveArray(code, ([closure, defs, code, fields]) => {
              if (!isObject(defs)) {
                error(env, {err: 'closure scope must be an object', code}, cb)
              } else if (!isObject(fields)) {
                error(env, {err: 'closure fields must be an object', code}, cb)
              } else {
                const {value, macro, check} = evalDefs(env, scope, defs)
                cb(_.merge({
                  [Names.closure]: _.create(scope, {
                    value: _.isEmpty(value) ? scope.value : _.create(scope.value, value),
                    macro: _.isEmpty(macro) ? scope.macro : _.create(scope.macro, macro),
                    check: _.isEmpty(check) ? scope.check : _.create(scope.check, check)
                  }),
                  [Names.code]: code
                }, fields))
              }
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
        case Names.dynamicLet:
          if (assertArgs(3)) {
            deferEval(code[1]).await(({[Names.dynamic]: dyn}) =>
              env.defer({
                action: Action.Eval, code: code[3],
                dynamics: [[dyn, deferEval(code[2])]],
                fn: (env, cb) => waitFor(code[3], c => evalExpr(env, scope, c, cb))
              }))
          }
          break
        case Names.throw_:
          if (assertArgs(1)) deferEval(code[1]).await(v => error(env, v, cb))
          break
        case Names.unhandledError:
          deferEval(code[1]).await(v => env.unhandledError(v, cb))
          break
        case Names.syntaxQuote:
          error(env, {err: `${fn} cannot be evaluated, must be macroexpanded`, code}, cb)
          break
        case Names.unquote:
        case Names.unquoteSplicing:
          error(env, {err: `${fn} cannot occur outside ${Names.syntaxQuote}`, code}, cb)
          break
        default:
          if (builtins.hasOwnProperty(fn)) {
            resolveArray(code.slice(1).map(x => deferEval(x)), args => {
              try { builtins[fn](env, args, cb) } catch (ex) {
                if (ex.name === 'AssertionError') {
                  throw ex // Let test assertions pass through
                } else if (ex instanceof Error) {
                  error(env, {
                    err: `Uncaught JavaScript exception in ${fn}`,
                    name: ex.name,
                    message: ex.message,
                    stack: ex.stack || null
                  }, cb)
                } else error(env, ex, cb)
              }
            })
          } else error(env, {err: 'no such special form', name: fn, code}, cb)
        }
      }

      // all other calls: functions and indexes
      else {
        const elements = code.map(x => deferEval(x))
        elements[0].await(efn => call(env, efn, elements.slice(1), cb))
      }
    })
  else if (isObject(code)) {
    if (isClosure(code)) error(env, {err: 'cannot eval a closure', code}, cb)
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
      err => error(env, err, cb))
  })
  return env.defer({
    action: Action.Eval, code: expanded,
    dynamics: [[Dynamics.name, name || null], [Dynamics.module, module || null]],
    fn: (env, cb) => scopePromise.then(
      scope => expanded.await(c => evalExpr(env, scope, c, cb)),
      err => error(env, err, cb))
  })
}

export function evalDefs(env: Env, evalScope: Scope, defs: JasprObject, module?: string): Scope {
  function suffix(k: string) {
    const dotIndex = k.lastIndexOf('.')
    if (dotIndex < 0) return k
    else return k.slice(dotIndex + 1)
  }
  const defsByPrefix = _(defs).keys()
    .reject(k => _.startsWith(k, Names.prefix))
    .groupBy(key => {
      const dotIndex = key.lastIndexOf('.')
      if (dotIndex < 0) return 'value'
      const prefix = key.slice(0, dotIndex)
      if (prefix.indexOf('.') !== -1 && !topLevelPrefixes.has(prefix)) {
        // TODO: Throw this error in Jaspr, not JS
        throw new Error('Not a legal top-level prefix: ' + prefix)
      }
      return prefix
    }).value()
  let scope: Scope
  const scopePromise = new Promise<Scope>(resolve => setImmediate(() => resolve({
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
                  .mapKeys((v: Jaspr, k: string) => suffix(k))
                  .mapValues((v: Jaspr, k: string) => module + '.' + k)
                  .value()
        : {}},
    _.mapValues(defsByPrefix, (ks, prefix) => {
      let mapFn: (k: string) => [string, any]
      if (prefix === 'doc') mapFn = k => {
        if (typeof defs[k] === 'string') return [suffix(k), defs[k]]
        else {
          // TODO: Throw this error in Jaspr, not JS
          throw new Error(`${k} must be a literal string; got something else`)
        }
      }
      else if (prefix === 'test') mapFn = k => [suffix(k), defs[k]]
      else mapFn =
        k => [suffix(k), deferExpandEval(env, scopePromise, defs[k], k, module)]
      return _.fromPairs(ks.map(mapFn))
    }))
  return scope
}
