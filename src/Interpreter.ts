import {EventEmitter} from 'events'
import * as _ from 'lodash'
import * as async from 'async'
import Proc from './Proc'
import {Fiber, FiberInfo} from './Proc'
import {magicPrefix} from './Parse'
import {
  Jaspr, JasprArray, JasprObject, JasprClosure, Scope, isArray, isObject,
  isClosure, Deferred, Callback, getIndex, getKey, scopeKey, codeKey, argsKey,
  resolveArray, resolveObject, resolveFully, toString, toBool, emptyScope
} from './Jaspr'

export default class Interpreter {
  procs = new Set<Proc>()

  spawn(
    name: string = "<proc>",
    parent?: Proc,
    errorHandler?: (err: Jaspr, cb: (err: Jaspr, value?: Jaspr) => void) => boolean 
  ): Context {
    const proc = new Proc(name, parent, errorHandler)
    this.procs.add(proc)
    return new InterpreterContext(proc, this)
  }
}

function waitFor(v: Jaspr | Deferred, cb: Callback): void {
  if (v instanceof Deferred) v.await(cb)
  else cb(v)
}

export interface Context {
  proc(): Proc
  fiber(info?: FiberInfo, fn?: (cb: Callback, fiber: Fiber) => void): Fiber
  macroExpand(scope: Scope, code: Jaspr): Jaspr | Deferred
  eval(scope: Scope, code: Jaspr): Jaspr | Deferred
  call(callee: Jaspr, args: JasprArray, fiber: Fiber, cb: Callback): void
  evalModule(
    module: JasprObject,
    cb: (err: {err: string, module: JasprObject} | null, m?: Module) => void,
    evalScope?: Scope
  ): void
  //spawn(scope: JasprObject, macros: JasprObject, code: Jaspr): Proc
}

export interface Module extends Scope {
  $schema: string
  $module: string | null
  $doc: string | null
  $author: string | null
  $main: Jaspr
  $export: { [exportedName: string]: string }
}

class InterpreterContext implements Context {
  readonly _proc: Proc
  readonly interpreter: Interpreter
  indent = ''

  constructor(proc: Proc, interpreter: Interpreter) {
    this._proc = proc
    this.interpreter = interpreter
  }

  proc(): Proc { return this._proc }
  fiber(info?: FiberInfo, fn?: (cb: Callback, fiber: Fiber) => void) {
    return this._proc.fiber(info, fn)
  }
  error(err: Jaspr, cb: Callback): boolean { return this._proc.error(err, cb) }

  macroExpandTop(scope: Scope, code: Jaspr, fiber: Fiber, cb: Callback): void {
    if (isArray(code)) {
      if (code.length === 0) cb(code)
      else getIndex(0, code, (err, fn) => {
        if (fn === magicPrefix + 'syntax-quote') {
          if (code.length === 2) {
            getIndex(1, code, (err, x) => syntaxQuote(x, (err, y) => {
              if (err) fiber.error(err)
              else this.macroExpandTop(scope, <Jaspr>y,
                fiber.replace(new FiberInfo.MacroExpand(<Jaspr>y, scope)),
                cb)
            }))
          } else fiber.error({
            err: `${magicPrefix}syntax-quote takes 1 argument, got ${code.length - 1}`,
            code
          })
        } else if (typeof fn === 'string' && scope.macro[fn] !== undefined) {
          getKey(fn, scope.macro, (err, macro) => {
            const args = code.slice(1)
            this.fiber(
              new FiberInfo.Call(macro, args),
              (cb, fiber) => this.call(macro, args, fiber, cb)
            ).await(expanded =>
              this.macroExpandTop(scope, expanded, 
                fiber.replace(new FiberInfo.MacroExpand(expanded, scope)),
                cb))
          })
        } else cb(code)
      })
    } else cb(code)
  }

  macroExpand(scope: Scope, code: Jaspr): Jaspr | Fiber {
    const reexpand = (it: Jaspr | Deferred, k: number | string): Jaspr | Fiber => {
      if (k === scopeKey) return <Jaspr|Fiber>it
      else if (it instanceof Deferred) {
        return this.fiber(new FiberInfo.MacroExpand(<Fiber>it, scope),
          cb => it.await(v => waitFor(this.macroExpand(scope, v), cb)))
      } else return this.macroExpand(scope, it)
    }
    if (isArray(code) && code.length > 0 && !(code.length === 2 && code[0] === '')) {
      return this.fiber(new FiberInfo.MacroExpand(code, scope), (cb, fiber) =>
        this.macroExpandTop(scope, code, fiber, expanded => {
          if (isArray(expanded) && 
              expanded.length > 0 &&
              !(expanded.length === 2 && expanded[0] === '')) {
            getIndex(0, expanded, (err, fn) => {
              if (fn === null) cb(expanded)
              else cb(expanded.map(reexpand))
            })
          }
          else if (isObject(code)) cb(_.mapValues(code, reexpand))
          else cb(expanded)
        }))
    }
    else if (isObject(code)) return _.mapValues(code, reexpand)
    else return code
  }

  call(callee: Jaspr, args: JasprArray, fiber: Fiber, cb: Callback): void {
    if (isClosure(callee)) {
      if (callee.hasOwnProperty(codeKey)) {
        resolveObject(callee, ({[codeKey]: code, [scopeKey]: scope}) => {
          const newScope: Scope =
            _.create(scope, {value: _.create(scope.value, {[argsKey]: args})})
          waitFor(this.eval(newScope, code), cb)
        })
      } else {
        fiber.error({err: "closure has no code", callee, args})
      }
    } else if (isArray(callee)) {
      if (callee.length == 0) cb(args)
      else fiber.error({err: "cannot call a non-empty array", callee, args})
    } else if (isObject(callee)) {
      if (_.isEmpty(callee)) {
        fiber.error({err: "empty-object builder not yet implemented", callee, args})
      } else {
        fiber.error({err: "cannot call a non-closure, non-empty object", callee, args})
      }
    } else if (typeof callee === "number") {
      if (args.length !== 1) {
        fiber.error({err: `index takes 1 argument, got ${args.length}`, index: callee})
      } else {
        getIndex(0, args, (err, receiver) => {
          if (isArray(receiver)) {
            let index = callee < 0 ? receiver.length + callee : callee
            getIndex(index, receiver, (err, x) => {
              if (err) fiber.error(err)
              else cb(x)
            })
          } else fiber.error(
            {err: `numeric index into non-array`, index: callee, in: receiver})
        })
      }
    } else if (typeof(callee) === "string") {
      if (callee === scopeKey) {
        fiber.error({err: `cannot access "${callee}" directly`})
      } else if (args.length !== 1) {
        fiber.error({err: `index takes 1 argument, got ${args.length}`, index: callee})
      } else {
        getIndex(0, args, (err, receiver) => {
          if (isObject(receiver)) {
            getKey(callee, receiver, (err, x) => {
              if (err) fiber.error(err)
              else cb(x)
            })
          } else fiber.error(
            {err: `string index into non-object`, index: callee, in: receiver})
        })
      }
    } else fiber.error({err: "not callable", callee, args})
  }

  eval(scope: Scope, code: Jaspr): Jaspr | Fiber {
    const reeval = (it: Jaspr | Deferred, k: number | string): Jaspr | Fiber => {
      if (k === scopeKey) return <Jaspr|Fiber>it
      else if (it instanceof Deferred) {
        return this.fiber(new FiberInfo.Eval(<Fiber>it, scope),
          cb => it.await(v => waitFor(this.eval(scope, v), cb)))
      } else return this.eval(scope, it)
    }
    if (typeof code === "string") {
      const variable = scope.value[code]
      if (variable === undefined) {
        return this.fiber().error({err: 'no binding for name', name: code})
      } else return <Jaspr|Fiber>variable
    } else if (isArray(code) && code.length > 0) return this.fiber(
      new FiberInfo.Eval(code, scope),
      (cb, fiber) => getIndex(0, code, (err, fn) => {

        // empty string: quote
        if (fn === '') {
          if (code.length === 2) getIndex(1, code, (err, x) => cb(x))
          else fiber.error({
            err: `empty string (quote) takes 1 argument, got ${code.length - 1}`,
            code
          })
        }

        // "magic" special forms
        else if (typeof fn === "string" && _.startsWith(fn, magicPrefix)) {
          const magic = fn.slice(magicPrefix.length)
          switch (magic) {
          case "if":
            if (code.length !== 4) fiber.error(
              {err: 'if takes exactly 3 arguments', code})
            resolveArray(code, form =>
              waitFor(this.eval(scope, form[1]), b => {
                const branch = form[toBool(b) ? 2 : 3]
                // TODO: This is a tail call, and should replace the current fiber
                waitFor(this.eval(scope, branch), cb)
              }))
            break
          case "closure":
            if (code.length !== 4) fiber.error(
              {err: 'closure takes exactly 3 arguments', code})
            resolveArray(code, ([closure, defs, code, fields]) => {
              if (!isObject(defs)) {
                fiber.error({err: 'closure scope must be an object', code})
              } else if (!isObject(fields)) {
                fiber.error({err: 'closure fields must be an object', code})
              } else {
                const {value, macro, check} = this.evalDefs(scope, defs)
                cb(_.merge({
                  [scopeKey]: _.create(scope, {
                    value: _.isEmpty(value) ? scope.value : _.create(scope.value, value),
                    macro: _.isEmpty(macro) ? scope.macro : _.create(scope.macro, macro),
                    check: _.isEmpty(check) ? scope.check : _.create(scope.check, check)
                  }),
                  [codeKey]: code
                }, fields))
              }
            })
            break
          case "macroget":
            if (code.length !== 2) fiber.error(
              {err: 'macroget takes exactly 1 argument', code})
            getIndex(1, code, (err, v) =>
              waitFor(this.eval(scope, v), v => {
                if (typeof v !== 'string') fiber.error(
                  {err: 'macroget argument must be a string', args: [v]})
                else getKey(v, scope.macro, (err, macro) => {
                  if (err) fiber.error({err: 'macro not defined', macro})
                  else cb(macro)
                })
              }))
            break
          case "macroexpand":
            if (code.length !== 2) fiber.error(
              {err: 'macroexpand takes exactly 1 argument', code})
            getIndex(1, code, (err, v) =>
              waitFor(this.eval(scope, v), v =>
                waitFor(this.macroExpand(scope, v), cb)))
            break
          case "syntax-quote":
            fiber.error({err: 'syntax-quote cannot be evaluated, must be macroexpanded', code})
            break
          case "unquote":
          case "unquote-splicing":
            fiber.error({err: 'unquote cannot occur outside syntax-quote', code})
            break
          default: if (magicFns.hasOwnProperty(magic)) {
            resolveArray(code, form => resolveArray(
              form.slice(1).map(arg => this.eval(scope, arg)),
              args => {
                try { magicFns[magic](this, args, cb) } catch (ex) {
                  if (ex instanceof Error) {
                    fiber.error({
                      err: `Uncaught JavaScript exception in ${magicPrefix}${magic}`,
                      name: ex.name,
                      message: ex.message,
                      stack: ex.stack || null
                    })
                  } else fiber.error(ex)
                }
              }))
            }
          }
        }

        // all other calls: functions and indexes
        else {
          waitFor(this.eval(scope, fn), efn => {
            const args = code.slice(1).map(reeval)
            this.call(efn, args, fiber.replace(new FiberInfo.Call(efn, args)), cb)
          })
        }
      }))
    else if (isObject(code)) {
      if (isClosure(code)) {
        return this.fiber().error({err: "cannot eval a closure", code})
      } else return _.mapValues(code, reeval)
    } else return code
  }
  
  evalDefs(evalScope: Scope, defs: JasprObject, module?: string): Scope {
    function suffix(k: string) {
      const dotIndex = k.lastIndexOf('.')
      if (dotIndex < 0) return k
      else return k.slice(dotIndex + 1)
    }
    const defsByPrefix = _(defs).keys()
      .reject(k => _.startsWith(k, magicPrefix))
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
    const evalEntry = (code: Jaspr | Deferred, name: string): Fiber =>
      this.fiber(FiberInfo.def(name), (cb, fiber) =>
        scopePromise.then(scope =>
          waitFor(code, code =>
            waitFor(this.macroExpand(scope, code), expanded =>
              waitFor(this.eval(scope, expanded), cb))),
          err => fiber.error(<any>fiber)))
    scope = _.merge({value: {}, macro: {}, check: {}, doc: {}, test: {},
        qualified: module
          ? _(defs).omitBy(k => _.startsWith(k, magicPrefix))
                   .mapKeys((v: Jaspr, k: string) => suffix(k))
                   .mapValues((v: Jaspr, k: string) => module + '.' + k)
                   .value()
          : {}},
      _.mapValues(defsByPrefix, (ks, prefix) => {
        if (prefix === 'doc') return _.fromPairs(ks.map(k => {
          if (typeof defs[k] === 'string') return [suffix(k), defs[k]]
          else {
            // TODO: Throw this error in Jaspr, not JS
            throw new Error(`${k} must be a literal string; got something else`)
          }
        }))
        else return _.fromPairs(ks.map(k => [suffix(k), evalEntry(defs[k], k)]))
      }))
    return scope
  }
  
  evalModule(
    module: JasprObject,
    cb: (err: {err: string, module: JasprObject} | null, m?: Module) => void,
    evalScope: Scope = emptyScope
  ): void {
    resolveObject(module, m => {
      const {$schema, $module, $export, $doc, $author} = m
      if (typeof $schema !== 'string') {
        cb({err: 'module.$schema must be a string', module})
      } else if (typeof $module !== 'string') {
        cb({err: 'module.$module must be a string', module})
      } else if ($doc != null && typeof $doc !== 'string') {
        cb({err: 'module.$doc must be a string', module})
      } else if ($author != null && typeof $author !== 'string') {
        cb({err: 'module.$author must be a string', module})
      } else {
        resolveFully($export || {}, (err, exports) => {
          if (err) return cb(<any>err)
          if (isArray(exports)) {
            if (!_.every(exports, _.isString)) {
              return cb({err: 'module.$export must contain only strings', module})
            }
            exports = _.fromPairs(exports.map(k => [k, k]))
          }
          if (!isObject(exports)) {
            return cb({err: `module.$export must be an array or object, got ${exports}`, module})
          }
          const out = this.evalDefs(evalScope, m, $module)
          for (let k in exports) {
            if (k.indexOf('.') < 0 && !k.startsWith(magicPrefix)) {
              const v = exports[k]
              if (typeof v !== 'string') {
                return cb({err: 'module.$export values must be strings', module})
              }
              if (!out.value.hasOwnProperty(v) && !out.macro.hasOwnProperty(v)) {
                return cb({err: `exported name not defined: ${v}`, module})
              }
            } else return cb({err: `illegal export name: ${k}`, module})
          }
          const $export = <{ [exportedName: string]: string }>exports
          function makeExports<T>(sc: {[k: string]: T}) {
            const sc2 = _.mapValues($export, k => sc[k])
            return _.merge(sc2, _.mapKeys(sc2, (v, k) => $module + "." + k))
          }
          cb(null, {
            $schema, $module, $export,
            $doc: $doc || null, $author: $author || null,
            $main: null, // TODO: Support scripts
            value: makeExports(out.value),
            macro: makeExports(out.macro),
            check: makeExports(out.check),
            doc: makeExports(out.doc),
            test: out.test,
            qualified: _.fromPairs(_.keys($export).map(k => [k, $module + '.' + k])),
          })
        }, true)
      }
    })
  }
}

export const topLevelPrefixes = new Set(['value', 'macro', 'check', 'doc', 'test'])

function innerSyntaxQuote(
  code: Jaspr, cb: (err: JasprObject | null, value: Jaspr, isFlattened: boolean) => void
): void {
  const fail = (err: string) => cb({err, code}, null, false)
  if (isArray(code) && code.length > 0) {
    getIndex(0, code, (err, fn) => {
      if (fn === '' || fn === magicPrefix + 'syntax-quote') {
        return cb(null, ['', code], false)
      }
      resolveArray(code, xs => {
        if (fn === magicPrefix + 'unquote') {
          if (xs.length === 2) cb(null, xs[1], false)
          else fail('unquote takes exactly 1 argument')
        } else if (fn === magicPrefix + 'unquote-splicing') {
          if (xs.length === 2) cb(null, xs[1], true)
          else fail('unquote-splicing takes exactly 1 argument')
        } else {
          let toConcat: Jaspr[] = [], currentArray: Jaspr[] = []
          async.eachSeries<Jaspr, JasprObject | null>(xs,
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
                cb(null, [magicPrefix + "arrayConcat", ...toConcat], false)
              }
            })
        }
      })
    })
  } else if (isObject(code)) {
    resolveObject(code, obj =>
      async.mapValues<Jaspr, Jaspr, JasprObject | null>(obj,
        (v, k, cb) => syntaxQuote(v, cb),
        (err, res) => cb(<JasprObject|null>err, <JasprObject>res, false)))
  } else cb(null, ['', code], false)
}

function syntaxQuote(code: Jaspr, cb: AsyncResultCallback<Jaspr, JasprObject | null>): void {
  innerSyntaxQuote(code, (err, value, isFlattened) => {
    if (err) cb(err, null)
    else if (isFlattened) cb({err: 'encountered ~@ outside of array', code}, null)
    else cb(null, value)
  })
}

let nextGensym = 0

const magicFns: {[name: string]: (c: Context, args: Jaspr[], cb: Callback) => void} = {
  throw(c, [err], cb) { throw err },
  gensym(c, args, cb) {
    const name = args.length > 0 ? ("" + args[0]) : "gensym"
    cb(`${name},${(nextGensym++).toString(16)}`)
  },
  print(c, args, cb) {
    resolveFully(args, (err, args: Jaspr[]) => {
      console.log(_.join(args.map(a => toString(a, true)), ' '))
      cb(null)
    })
  },
  apply(c, [fn, args], cb) {
    if (isArray(args)) {
      c.fiber(
        new FiberInfo.Call(fn, args),
        (cb, fiber) => c.call(fn, args, fiber, cb)
      ).await(cb)
    } else throw {err: "apply's arguments must be an array", args}
  },
  sleep(c, [ms], cb) {
    if (typeof ms === 'number') setTimeout(cb, ms, null)
    else throw {err: "sleep argument must be a number"}
  },
  bool(c, [it], cb) { cb(toBool(it)) },
  equals(c, [a, b], cb) { cb(a === b) },
  less(c, args, cb) { 
    let last = args[0]
    if (typeof last !== 'number') throw {err: "less arguments must be numbers"}
    for (let i = 1; i < args.length; i++) {
      const next = args[i]
      if (typeof next !== 'number') throw {err: "less arguments must be numbers"}
      if (!(last < next)) return cb(false)
      last = next
    }
    cb(true)
  },
  lessOrEqual(c, args, cb) {
    let last = args[0]
    if (typeof last !== 'number') throw {err: "lessOrEqual arguments must be numbers"}
    for (let i = 1; i < args.length; i++) {
      const next = args[i]
      if (typeof next !== 'number') throw {err: "lessOrEqual arguments must be numbers"}
      if (!(last <= next)) return cb(false)
      last = next
    }
    cb(true)
  },
  add(c, args, cb) { cb(args.reduce(_.add)) },
  subtract(c, args, cb) { cb(args.reduce(_.subtract)) },
  multiply(c, args, cb) { cb(args.reduce(_.multiply)) },
  divide(c, args, cb) {
    let div
    try { div = args.reduce(_.divide) }
    catch (e) { throw {err: 'divide by zero', args} }
    cb(div)
  },
  modulus(c, [a, b], cb) {
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw {err: 'modulus arguments must be numbers'}
    }
    let mod
    try { mod = a % b }
    catch (e) { throw {err: 'mod by zero', args: [a, b]} }
    cb(mod)
  },
  negate(c, [a], cb) {
    if (typeof a === 'number') cb(-a)
    else throw {err: "negate argument must be a number", args: [a]}
  },
  toString(c: Context, [a]: Jaspr[], cb: Callback) {
    resolveFully(a, (err, x) => cb(toString(x, true)))
  },
  toJson(c, [a], cb) { 
    resolveFully(a, (err, x) => {
      if (err) throw err; else cb(toString(x))
    }, true)
  },
  fromJson(c, [a], cb) {
    // TODO: catch exceptions
    if (typeof a === 'string') cb(JSON.parse(a))
    else throw {err: "fromJson argument must be a string", args: [a]}
  },
  stringConcat(c, args, cb) {
    resolveFully(args, (err, args: Jaspr[]) =>
      cb(_.join(args.map(a => toString(a, true)), '')))
  },
  stringLength(c, [str], cb) {
    if (typeof str === 'string') cb(str.length)
    else throw {err: "stringLength argument must be a string", args: [str]}
  },
  stringSlice(c, [str, start, end], cb) {
    if (typeof str === 'string' && typeof start === 'number' && typeof end === 'number') {
      cb(str.substring(start, end))
    } else throw {
      err: "stringSlice arguments must be [string, number, number]",
      args: [str, start, end]
    }
  },
  arrayConcat(c, args, cb) {
    if (_.every(args, isArray)) cb((<Jaspr[][]>args).reduce((a, b) => a.concat(b), []))
    else throw {err: "arrayConcat arguments must be arrays", args}
  },
  arrayLength(c, [a], cb) {
    if (isArray(a)) cb(a.length)
    else throw {err: "arrayLength argument must be an array", args: [a]}
  },
  arraySlice(c, [a, start, end], cb) {
    if (isArray(a) && typeof start === 'number' && typeof end === 'number') {
      cb(a.slice(start, end))
    } else throw {
      err: "arraySlice arguments must be [a, number, number]",
      args: [a, start, end]
    }
  },
  objectHas(c, [obj, key], cb) {
    if (isObject(obj) && typeof key === 'string') {
      const val = obj[key]
      cb(val !== undefined && !_.isFunction(val))
    } else throw {
      err: "objectHas arguments must be [object, string]",
      args: [obj, key]
    }
  },
  objectDelete(c, [obj, ...keys], cb) {
    if (isObject(obj) && _.every(keys, _.isString)) {
      cb(_.omit(obj, <string[]>keys))
    } else throw {
      err: "objectDelete arguments must be [object, ...string]",
      args: [obj, ...keys]
    }
  },
  objectKeys(c, [obj], cb) {
    if (isObject(obj)) cb(Object.keys(obj))
    else throw {err: "objectMerge argument must be an object", args: [obj]}
  },
  objectMerge(c, args, cb) {
    if (_.every(args, isObject)) cb((<JasprObject[]>args).reduce(_.merge, {}))
    else throw {err: "objectMerge arguments must be objects", args}
  },
  isNumber(c, [it], cb) { cb(typeof it === 'number') },
  isString(c, [it], cb) { cb(typeof it === 'string') },
  isArray(c, [it], cb) { cb(isArray(it)) },
  isObject(c, [it], cb) { cb(isObject(it)) },
  isClosure(c, [it], cb) { cb(isClosure(it)) },
}
