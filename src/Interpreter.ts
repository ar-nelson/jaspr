import * as _ from 'lodash'
import * as async from 'async'
import {legalName, number} from './Parser'
import * as Names from './ReservedNames'
import {NativeFn, NativeSyncFn, NativeAsyncFn} from './NativeFn'
import {
  Jaspr, JasprArray, JasprObject, JasprError, isArray, isObject, Deferred,
  Callback, getIndex, getKey, resolveFully, toString, toBool, magicSymbol, has
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

function deferKey(
  iterFn: (cb: Callback) => IterableIterator<Deferred>,
  env: Env, props: () => DeferProperties,
  into: any, ...keys: (string | number)[]
): void {
  let d: Deferred | null = null
  const iter = iterFn(v => {
    for (let key of keys) into[key] = v
    if (d) d.resolve(v)
  })
  const {value, done} = iter.next()
  if (done) return
  d = env.defer(props)
  for (let key of keys) into[key] = d
  value.await(function recur(resolved: Jaspr) {
    const {value, done} = iter.next(resolved)
    if (!done) value.await(recur)
  })
}

function awaitGenerator(generator: IterableIterator<Deferred>): boolean {
  const {value, done} = generator.next()
  if (done) return true
  value.await(function recur(resolved: Jaspr) {
    const {value, done} = generator.next(resolved)
    if (!done) value.await(recur)
  })
  return false
}

export function* raise(
  env: Env,
  dynamics: DynamicMap | undefined,
  error: JasprError,
  cb: Callback
): IterableIterator<Deferred> {
  let ds = dynamics
  for (; ds; ds = ds.next) {
    if (ds.key === env.signalHandlerVar) {
      const handler = ds.value
      yield* callGen(env, handler instanceof Deferred ? yield handler : handler,
        [error], dynamics, cb)
      break
    }
  }
  if (!ds) env.unhandledError(error, cb)
}

function* macroExpandTop(
  env: Env,
  scope: Scope,
  dynamics: DynamicMap | undefined,
  code: Jaspr,
  cb: Callback
): IterableIterator<Deferred> {
  if (isArray(code)) {
    if (code.length > 0) {
      let fn = code[0]
      if (fn instanceof Deferred) fn = <Jaspr>(yield fn)
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
          let x = code[1]
          if (x instanceof Deferred) x = <Jaspr>(yield x)
          let error: JasprError | null = null, quoted: Jaspr | undefined = undefined
          yield* syntaxQuote(env, x, scope.qualified, gensyms, (err, y) => {
            if (err) error = err
            else quoted = y
          })
          if (error) yield* raise(env, dynamics, error, cb)
          else yield* macroExpandTop(env, scope, dynamics, <any>quoted, cb)
        } else yield* raise(env, dynamics, {
          err: 'BadArgs',
          why: `${Names.syntaxQuote} takes 1 argument, got ${code.length - 1}`,
          fn: Names.syntaxQuote, args: code.slice(1)
        }, cb)
      } else if (typeof fn === 'string' && scope.macro[fn] !== undefined) {
        const callee = scope.macro[fn]
        let expanded: Jaspr | undefined = undefined
        yield* callGen(env, callee instanceof Deferred ? yield callee : callee,
          code.slice(1), dynamics, x => expanded = x)
        if (expanded === undefined) throw new Error(
          'Macroexpanded value not available -- this should never happen!')
        yield* macroExpandTop(env, scope, dynamics, expanded, cb)
      } else cb(code)
    } else cb(code)
  } else cb(code)
}

function isLiteral(code: Jaspr | Deferred) {
  return !code || code === true || typeof code === "number" || _.isEmpty(code)
}

function* macroExpandGen(
  env: Env,
  scope: Scope,
  dynamics: DynamicMap | undefined,
  form: Jaspr | Deferred,
  cb: Callback
): IterableIterator<Deferred> {
  do {
    let code = form instanceof Deferred ? <Jaspr>(yield form) : form
    if (isLiteral(code) || typeof code === "string") {
      cb(code)
      break
    }
    if (isArray(code) && code.length > 0 &&
          !(code.length === 2 && code[0] === '') &&
          !(code.length === 4 && code[0] === Names.closure)) {
      yield* macroExpandTop(env, scope, dynamics, code, v => code = v)
    }
    if (isObject(code)) {
      const out = Object.create(null)
      for (let key in code) {
        deferKey(
          cb => macroExpandGen(env, scope, dynamics, (<any>code)[key], cb),
          env, () => ({action: 'macroexpand', code: (<any>code)[key]}),
          out, key)
      }
      cb(out)
    } else if (isArray(code)) {
      if (code.length === 2 && code[0] === '') {
        cb(code)
        break
      }
      let arg1 = code[1]
      if (arg1 instanceof Deferred) arg1 = <Jaspr>(yield arg1)
      const out = new Array<Jaspr | Deferred>(code.length)
      if (code[0] === Names.closure && code.length === 4 && isObject(arg1)) {
        const [fn, defs, body, fields] = code
        const nameError = validateNames(<JasprObject>defs)
        if (nameError != null) {
          yield* raise(env, dynamics, nameError, cb)
          break
        }
        out[0] = fn
        deferKey(cb => macroExpandGen(env, scope, dynamics, fields, cb),
          env, () => ({action: 'macroexpand', code: fields}), out, 3)
        if (_.some(Object.keys(arg1), k => k.startsWith('macro.'))) {
          out[1] = defs
          out[2] = body
          out[<any>unexpandedSymbol] = true
        } else {
          const outDefs = Object.create(null)
          out[1] = outDefs
          for (let name in <JasprObject>defs) {
            deferKey(cb => macroExpandGen(env, scope, {
                key: env.nameVar, value: name, next: dynamics
              }, (<any>defs)[name], cb),
              env, () => ({action: 'macroexpand', code: (<any>defs)[name]}),
              outDefs, name)
          }
          deferKey(cb => macroExpandGen(env, scope, dynamics, body, cb),
            env, () => ({action: 'macroexpand', code: body}), out, 2)
        }
      } else {
        for (let i = 0; i < code.length; i++) deferKey(
          cb => macroExpandGen(env, scope, dynamics, (<any>code)[i], cb),
          env, () => ({action: 'macroexpand', code: (<any>code)[i]}), out, i)
      }
      cb(out)
    } else cb(code)
  } while(false)
}

const gensymRegex = /^[.]([^.]+)[.]$/

function* innerSyntaxQuote(
  env: Env,
  form: Jaspr | Deferred,
  qualified: Dictionary<string>,
  gensyms: (name: string) => string,
  cb: (err: JasprError | null, value: Jaspr, isFlattened: boolean) => void
): IterableIterator<Deferred> {
  const code = form instanceof Deferred ? yield form : form
  if (isArray(code) && code.length > 0) {
    let fn = code[0]
    if (fn instanceof Deferred) fn = <Jaspr>(yield fn)
    if (fn === '' || fn === Names.syntaxQuote) {
      cb(null, ['', code], false)
    } else if (fn === Names.unquote) {
      if (code.length === 2) cb(null,
        code[1] instanceof Deferred ? yield <any>code[1] : code[1], false)
      else cb({
        err: 'BadArgs', why: `${Names.unquote} takes exactly 1 argument`,
        fn: Names.unquote, args: code.slice(1)
      }, null, false)
    } else if (fn === Names.unquoteSplicing) {
      if (code.length === 2) cb(null,
        code[1] instanceof Deferred ? yield <any>code[1] : code[1], true)
      else cb({
        err: 'BadArgs', why: `${Names.unquoteSplicing} takes exactly 1 argument`,
        fn: Names.unquoteSplicing, args: code.slice(1)
      }, null, false)
    } else {
      let toConcat: Jaspr[] = [], currentArray: Jaspr[] = []
      let error: JasprError | null = null
      for (let x of code) {
        if (error) break
        yield* innerSyntaxQuote(env,
          x instanceof Deferred ? yield x : x,
          qualified, gensyms, (err, v, flat) => {
            if (err) error = err
            else if (flat) {
              if (currentArray.length > 0) {
                toConcat.push([[], ...currentArray])
                currentArray = []
              }
              toConcat.push(v)
            } else currentArray.push(v)
          })
      }
      if (error) cb(error, null, false)
      else if (toConcat.length === 0) cb(null, [[], ...currentArray], false)
      else {
        if (currentArray.length > 0) toConcat.push([[], ...currentArray])
        cb(null, [Names.arrayConcatQualified, ...toConcat], false)
      }
    }
  } else if (isObject(code)) {
    const out: JasprObject = {}
    let error: JasprError | null = null
    for (let key in code) {
      if (error) break
      const gensymMatch = gensymRegex.exec(key)
      deferKey(
        cb => syntaxQuote(env, code[key], qualified, gensyms, (err, v) => {
          if (err) error = err
          else cb(<Jaspr>v)
        }),
        env, () => ({action: 'macroexpand', code: code[key]}),
        out, gensymMatch ? gensyms(gensymMatch[1]) : key)
    }
    cb(error, out, false)
  } else if (typeof code === 'string') {
    const gensymMatch = gensymRegex.exec(code)
    cb(null, ['',
      gensymMatch ? gensyms(gensymMatch[1]) :
      typeof qualified[code] === 'string' ? qualified[code] : code], false)
  } else cb(null, code, false)
}

function* syntaxQuote(
  env: Env,
  code: Jaspr | Deferred,
  qualified: Dictionary<string>,
  gensyms: (name: string) => string,
  cb: AsyncResultCallback<Jaspr, JasprError | null>,
): IterableIterator<Deferred> {
  yield* innerSyntaxQuote(env, code, qualified, gensyms, (err, value, isFlattened) => {
    if (err) cb(err, null)
    else if (isFlattened) cb({
      err: 'NotCallable', why: 'encountered ~@ outside of array',
      callee: Names.unquoteSplicing, args: (<any[]>code).slice(1)
    }, null)
    else cb(null, value)
  })
}

export interface Namespace {
  $module: string | null,
  $version: string | null
}

export function qualify(ns: Namespace, name: string): string {
  if (ns.$module) return `${ns.$module}.${name}@${ns.$version || ''}`
  else return name
}

function* callGen(
  env: Env,
  callee: Jaspr,
  args: JasprArray,
  dynamics: DynamicMap | undefined,
  cb: Callback
): IterableIterator<Deferred> {
  const badArgs = (why: string, extras = {}) =>
    raise(env, dynamics, 
      <any>Object.assign({err: 'BadArgs', why, fn: callee, args}, extras), cb)
  const notCallable = (why: string) =>
    raise(env, dynamics, {err: 'NotCallable', why, callee, args}, cb)
  if (isClosure(env, callee)) {
    let {
      [env.closureName]: scope,
      [Names.code]: code,
      [magicSymbol]: magic
    } = callee
    if (magic instanceof NativeFn) {
      for (let i = 0; i < args.length; i++) {
        if (args[i] instanceof Deferred) args[i] = yield <any>args[i]
      }
      if (magic instanceof NativeAsyncFn) {
        let d: Deferred | null | false = null
        magic.call(env, <Jaspr[]>args, (err, v) => {
          if (err) {
            awaitGenerator(raise(env, dynamics, err, v => {
              cb(v)
              if (d) d.resolve(v)
              else d = false
            }))
          } else {
            cb(<Jaspr>v)
            if (d) d.resolve(<Jaspr>v)
            else d = false
          }
        })
        if (d !== false) yield (d = env.defer())
      } else {
        let error: JasprError | null = null
        magic.call(env, <Jaspr[]>args, (err, v) => {
          if (err) error = err
          else cb(<Jaspr>v)
        })
        if (error) yield* raise(env, dynamics, error, cb)
      }
    } else if (code !== undefined) {
      if (scope instanceof Deferred) scope = <Jaspr>(yield scope)
      if (code instanceof Deferred) code = <Jaspr>(yield code)
      yield* evalGen(env, <Scope>scope, args, dynamics, code, cb)
    } else yield* notCallable('closure has no code')
  } else if (isArray(callee)) {
    if (callee.length === 0) cb(args)
    else yield* notCallable('cannot call a non-empty array')
  } else if (isObject(callee)) {
    if (_.isEmpty(callee)) {
      if (args.length % 2 === 0) {
        const out = Object.create(null)
        for (let i = 0; i < args.length; i += 2) {
          let key = args[i], value = args[i + 1]
          if (key instanceof Deferred) key = yield key
          if (typeof key !== 'string') {
            yield* badArgs('key is not a string', {key})
            cb = () => {}
            break
          }
          if (value instanceof Deferred) value = yield value
          out[key] = value
        }
        cb(out)
      } else yield* badArgs('{} takes an even number of arguments')
    } else yield* notCallable('cannot call non-closure, non-empty object')
  } else if (typeof callee === 'number') {
    if (args.length === 1) {
      let receiver = args[0]
      if (receiver instanceof Deferred) receiver = <Jaspr>(yield receiver)
      if (isArray(receiver)) {
        const index = callee < 0 ? receiver.length + callee : callee
        const el = receiver[index]
        if (el !== undefined) cb(el instanceof Deferred ? yield el : el)
        else yield* raise(env, dynamics, {
          err: 'NoKey', why: 'index not found in array',
          key: index, in: receiver
        }, cb)
      } else yield* badArgs('numeric index into non-array')
    } else yield* badArgs(`index takes 1 argument, got ${args.length}`)
  } else if (typeof(callee) === "string") {
    if (args.length === 1) {
      let receiver = args[0]
      if (receiver instanceof Deferred) receiver = <Jaspr>(yield receiver)
      if (isObject(receiver)) {
        const el = receiver[callee]
        if (el !== undefined) cb(el instanceof Deferred ? yield el : el)
        else yield* raise(env, dynamics, {
          err: 'NoKey', why: 'key not found in object',
          key: callee, in: receiver
        }, cb)
      } else yield* badArgs('string index into non-object')
    } else yield* badArgs(`index takes 1 argument, got ${args.length}`)
  } else yield* notCallable('not closure, number, string, [], or {}')
}

function* evalGen(
  env: Env,
  scope: Scope,
  $args: JasprArray,
  dynamics: DynamicMap | undefined,
  form: Jaspr | Deferred,
  cb: Callback
): IterableIterator<Deferred> {
  const code = form instanceof Deferred ? <Jaspr>(yield form) : form
  if (isLiteral(code)) cb(code)
  else if (code === Names.args) cb($args)
  else if (typeof code === 'string') {
    if (code.startsWith(Names.prefix)) yield* raise(env, dynamics, {
      err: 'NoBinding', why: 'no accessible binding for reserved name',
      name: code
    }, cb)
    else {
      const value =
        (isObject(scope.value) ? scope.value : Object.create(null))[code]
      if (value === undefined || typeof value === 'function') {
        yield* raise(env, dynamics,
          {err: 'NoBinding', why: 'name not defined', name: code}, cb)
      } else cb(value instanceof Deferred ? yield value : value)
    }
  } else if (isArray(code)) {
    let hd = code[0]
    hd = hd instanceof Deferred ? <Jaspr>(yield hd) : hd
    if (hd === '') {
      if (code.length === 2) {
        cb(code[1] instanceof Deferred ? yield <any>code[1] : code[1])
      } else yield* raise(env, dynamics, {
        err: 'BadArgs',
        why: `empty string (quote) takes 1 argument, got ${code.length - 1}`,
        fn: '', args: code.slice(1)
      }, cb)
    } else if (typeof hd === 'string' && hd.charAt(0) === Names.prefix) {
      switch (hd) {
      case Names.if_: {
        let p: Jaspr | undefined = undefined
        yield* evalGen(env, scope, $args, dynamics, code[1], v => p = v)
        if (p === undefined) throw new Error(
          'Predicate did not resolve -- this should never happen!')
        yield* evalGen(env, scope, $args, dynamics, code[toBool(p) ? 2 : 3], cb)

        // Somehow, unintuitively, the while loop below is MUCH slower than
        // recursion. But I'm keeping it because it might be necessary to avoid
        // blowing the stack on deeply-nested ifs.
        /*
        let expr: any = code, next: any = hd // this kills the typescript
        while (next === Names.if_) {
          let p: Jaspr | undefined = undefined
          yield* evalGen(env, scope, $args, dynamics, expr[1], v => p = v)
          if (p === undefined) throw new Error(
            'Predicate did not resolve -- this should never happen!')
          expr = expr[toBool(p) ? 2 : 3]
          if (expr instanceof Deferred) expr = yield expr
          if (isArray(expr)) next = expr[0]
          else next = null
          if (next instanceof Deferred) next = yield next
        }
        yield* evalGen(env, scope, $args, dynamics, expr, cb)
        */
        break
      }
      case Names.then:
        yield* evalGen(env, scope, $args, dynamics, code[1], () => {})
        yield* evalGen(env, scope, $args, dynamics, code[2], cb)
        break
      case Names.closure: {
        const defs: JasprObject =
          code[1] instanceof Deferred ? yield <any>code[1] : code[1]
        const fields: JasprObject =
          code[3] instanceof Deferred ? yield <any>code[3] : code[3]
        const newScope = evalDefs(env, scope, $args, dynamics, defs)
        let closureCode = code[2]
        if (code[<any>unexpandedSymbol]) {
          yield* macroExpandGen(env, newScope, dynamics, closureCode,
            x => closureCode = x)
        }
        yield* evalGen(env, scope, $args, dynamics, fields, fields => cb(
          Object.assign({
            [env.closureName]: newScope,
            [Names.code]: closureCode,
            [magicSymbol]: closureMarker
          }, fields)))
        break
      }
      case Names.apply: {
        let callee: Jaspr|undefined = undefined, args: Jaspr|undefined = undefined
        yield* evalGen(env, scope, $args, dynamics, code[1], v => callee = v)
        if (callee === undefined) throw new Error(
          'Callee did not resolve -- this should never happen!')
        yield* evalGen(env, scope, $args, dynamics, code[2], v => args = v)
        if (args === undefined) throw new Error(
          'Args did not resolve -- this should never happen!')
        yield* callGen(env, callee, <JasprArray>args, dynamics, cb)
        break
      } 
      case Names.dynamicGet: {
        let dyn: JasprDynamic | undefined = undefined
        yield* evalGen(env, scope, $args, dynamics, code[1],
          v => dyn = <JasprDynamic>v)
        if (dyn === undefined) throw new Error(
          'Dynamic variable did not resolve -- this should never happen!')
        let result = (<JasprDynamic>dyn).$default
        for (let ds = dynamics; ds !== undefined; ds = ds.next) {
          if (ds.key === dyn) {
            result = ds.value
            break
          }
        }
        cb(result instanceof Deferred ? yield result : result)
        break
      }
      case Names.dynamicLet: {
        let dyn: JasprDynamic | undefined = undefined
        yield* evalGen(env, scope, $args, dynamics, code[1],
          v => dyn = <JasprDynamic>v)
        if (dyn === undefined) throw new Error(
          'Dynamic variable did not resolve -- this should never happen!')
        const newDynamics: DynamicMap =
          {key: dyn, value: <any>undefined, next: dynamics}
        deferKey(cb => evalGen(env, scope, $args, dynamics, code[2], cb),
          env, () => ({action: 'eval', code: code[2]}),
          newDynamics, 'value')
        yield* evalGen(env, scope, $args, newDynamics, code[3], cb)
        break
      }
      case Names.contextGet: {
        let ctx = code[1], name = code[2]
        ctx = '' + (ctx instanceof Deferred ? yield ctx : ctx)
        name = '' + (name instanceof Deferred ? yield name : name)
        let bindings = scope[ctx]
        if (bindings instanceof Deferred) bindings = <Jaspr>(yield bindings)
        if (isObject(bindings) && bindings[name] !== undefined &&
            typeof bindings[name] !== 'function') {
          cb(bindings[name] instanceof Deferred ? yield <any>bindings[name]
                                                : bindings[name])
        } else {
          yield* raise(env, dynamics, {
            err: 'NoBinding', why: 'name not defined in context',
            name, context: ctx
          }, cb)
        }
        break
      }
      case Names.junction: {
        cb(yield env.junction(
          code.slice(1).map(expr => (env: Env, cb: Callback) =>
            awaitGenerator(evalGen(env, scope, $args, dynamics, expr, cb))),
          () => ({action: 'junction', code})))
        break
      }
      case Names.eval_: {
        let expr: Jaspr|undefined = undefined
        yield* evalGen(env, scope, $args, dynamics, code[1], v => expr = v)
        if (expr === undefined) throw new Error(
          'Expression did not resolve -- this should never happen!')
        yield* evalGen(env, scope, $args, dynamics, expr, cb)
        break
      }
      case Names.macroexpand: {
        let expr: Jaspr|undefined = undefined
        yield* evalGen(env, scope, $args, dynamics, code[1], v => expr = v)
        if (expr === undefined) throw new Error(
          'Expression did not resolve -- this should never happen!')
        yield* macroExpandGen(env, scope, dynamics, expr, cb)
        break
      }
      case Names.arrayMake: {
        let fn: Jaspr|undefined = undefined, len: number|undefined = undefined
        yield* evalGen(env, scope, $args, dynamics, code[1], v => fn = v)
        if (fn === undefined) throw new Error(
          'Function did not resolve -- this should never happen!')
        yield* evalGen(env, scope, $args, dynamics, code[2], v => len = +<any>v)
        if (len === undefined) throw new Error(
          'Length did not resolve -- this should never happen!')
        const out = new Array<Jaspr | Deferred>(len)
        for (let i = 0; i < len; i++) {
          const ii = i
          deferKey(
            cb => callGen(env, <Jaspr>fn, [ii], dynamics, cb),
            env, () => ({action: 'eval', code: [['', <Jaspr>fn], ii]}),
            out, ii)
        }
        cb(out)
        break
      } 
      case Names.objectMake: {
        let fn: Jaspr|undefined = undefined, keys: Jaspr|undefined = undefined
        yield* evalGen(env, scope, $args, dynamics, code[1], v => fn = v)
        if (fn === undefined) throw new Error(
          'Function did not resolve -- this should never happen!')
        yield* evalGen(env, scope, $args, dynamics, code[2], v => keys = v)
        if (keys === undefined) throw new Error(
          'Keys did not resolve -- this should never happen!')
        const out = Object.create(null)
        for (let k of <JasprArray>keys) {
          const kk = '' + (k instanceof Deferred ? yield k : k)
          deferKey(
            cb => callGen(env, <Jaspr>fn, [kk], dynamics, cb),
            env, () => ({action: 'eval', code: [['', <Jaspr>fn], ['', kk]]}),
            out, kk)
        }
        cb(out)
        break
      }
      case Names.syntaxQuote:
        yield* raise(env, dynamics, {
          err: 'NoPrimitive', why: `${hd} cannot be evaluated, must be macroexpanded`,
          callee: hd, code
        }, cb)
        break
      case Names.unquote:
      case Names.unquoteSplicing:
        yield* raise(env, dynamics, {
          err: 'NoPrimitive', why: `${hd} cannot occur outside ${Names.syntaxQuote}`,
          callee: hd, code
        }, cb)
        break
      default:
        yield* raise(env, dynamics, {
          err: 'NoPrimitive', why: 'no such primitive operation', callee: hd, code
        }, cb)
      }
    }

    // let
    else if (
      isArray(hd) && hd.length === 4 && code.length === 1 &&
      (hd[0] instanceof Deferred ? yield <any>hd[0] : hd[0]) === Names.closure &&
      isObject(hd[1] instanceof Deferred ? yield <any>hd[1] : hd[1]) &&
      isObject(hd[3] instanceof Deferred ? yield <any>hd[3] : hd[3])
    ) {
      yield* evalGen(env, scope, $args, dynamics, <Jaspr>hd[3], () => {})
      const newScope = evalDefs(env, scope, $args, dynamics, <JasprObject>hd[1])
      let body = hd[2]
      if (hd[<any>unexpandedSymbol]) {
        yield* macroExpandGen(env, newScope, dynamics, body, x => body = x)
      }
      yield* evalGen(env, newScope, [], dynamics, body, cb)
    }

    // calls
    else {
      const form = new Array<Jaspr | Deferred>(code.length)
      for (let i = 0; i < code.length; i++) {
        const j = i
        deferKey(cb => evalGen(env, scope, $args, dynamics, code[j], cb),
          env, () => ({action: 'eval', code: code[j]}),
          form, j)
      }
      const callee = form[0]
      yield* callGen(env,
        callee instanceof Deferred ? yield callee : callee,
        form.slice(1),
        dynamics,
        cb)
    }
  } else /* object */ {
    const out = Object.create(null)
    for (let key in <JasprObject>code) {
      const k = key
      deferKey(cb =>
          evalGen(env, scope, $args, dynamics, (<JasprObject>code)[k], cb),
        env, () => ({action: 'eval', code: (<JasprObject>code)[k]}),
        out, k)
    }
    cb(out)
  }
}

function* expandAndEvalGen(
  env: Env,
  scope: Scope,
  $args: JasprArray,
  dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred,
  cb: Callback
): IterableIterator<Deferred> {
  let expanded: Jaspr | undefined = undefined
  yield* macroExpandGen(env, scope, dynamics, code, v => expanded = v)
  if (expanded === undefined) throw new Error(
    'Macroexpanded value unavailable -- this should never happen!')
  yield* evalGen(env, scope, $args, dynamics, expanded, cb)
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
  for (let [name, ctx, idents] of names) {
    const value = defs[name]
    const deferred = byContext[ctx][idents[0]]
    deferKey(
      cb => expandAndEvalGen(env, scope, $args, {
        key: env.nameVar, value: <string>_.last(idents),
        next: dynamics
      }, value, v => {
        cb(v)
        if (deferred instanceof Deferred) deferred.resolve(v)
      }),
      env, () => ({action: 'eval', code: value}),
      scope[ctx], ...idents)
  }
  if (namespace) {
    scope.qualified = _.create(scope.qualified,
      _(defs).keys().filter(k => !/^test[.][^.]+$/.test(k)).flatMap(name => {
        const lastDot = name.lastIndexOf('.')
        const ident = lastDot > -1 ? name.slice(lastDot + 1) : name
        const qualified = qualify(namespace, ident)
        return [[ident, qualified], [`${namespace.$module}.${ident}`, qualified]]
      }).fromPairs().value())
  }
  return scope
}

export function evalExpr(
  env: Env, scope: Scope, code: Jaspr | Deferred, cb: Callback): void
export function evalExpr(
  env: Env, scope: Scope, $args: JasprArray, code: Jaspr | Deferred,
  cb: Callback): void
export function evalExpr(
  env: Env, scope: Scope, $args: JasprArray, dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred, cb: Callback): void

export function evalExpr(env: Env, scope: Scope, ...rest: any[]): void {
  let $args: JasprArray = []
  let dynamics: DynamicMap | undefined = undefined
  let code: Jaspr | Deferred, cb: Callback
  switch (rest.length) {
  case 2:
    [code, cb] = rest
    break
  case 3:
    [$args, code, cb] = rest
    break
  case 4:
    [$args, dynamics, code, cb] = rest
    break
  default:
    throw new Error('wrong number of arguments')
  }
  awaitGenerator(evalGen(env, scope, $args, dynamics, code, cb))
}

export function macroExpand(
  env: Env, scope: Scope, code: Jaspr | Deferred, cb: Callback): void
export function macroExpand(
  env: Env, scope: Scope, dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred, cb: Callback): void
  
export function macroExpand(env: Env, scope: Scope, ...rest: any[]): void {
  let dynamics: DynamicMap | undefined = undefined
  let code: Jaspr | Deferred, cb: Callback
  switch (rest.length) {
  case 2:
    [code, cb] = rest
    break
  case 3:
    [dynamics, code, cb] = rest
    break
  default:
    throw new Error('wrong number of arguments')
  }
  awaitGenerator(macroExpandGen(env, scope, dynamics, code, cb))
}

export function call(
  env: Env, callee: Jaspr, args: JasprArray, cb: Callback): void
export function call(
  env: Env, callee: Jaspr, args: JasprArray, dynamics: DynamicMap | undefined,
  cb: Callback): void
  
export function call(env: Env, callee: Jaspr, args: JasprArray, ...rest: any[]): void {
  let dynamics: DynamicMap | undefined = undefined, cb: Callback
  switch (rest.length) {
  case 1:
    [cb] = rest
    break
  case 2:
    [dynamics, cb] = rest
    break
  default:
    throw new Error('wrong number of arguments')
  }
  awaitGenerator(callGen(env, callee, args, dynamics, cb))
}

export function expandAndEval(
  env: Env, scope: Scope, code: Jaspr | Deferred, cb: Callback): void
export function expandAndEval(
  env: Env, scope: Scope, $args: JasprArray, code: Jaspr | Deferred,
  cb: Callback): void
export function expandAndEval(
  env: Env, scope: Scope, $args: JasprArray, dynamics: DynamicMap | undefined,
  code: Jaspr | Deferred, cb: Callback): void

export function expandAndEval(env: Env, scope: Scope, ...rest: any[]): void {
  let $args: JasprArray = []
  let dynamics: DynamicMap | undefined = undefined
  let code: Jaspr | Deferred, cb: Callback
  switch (rest.length) {
  case 2:
    [code, cb] = rest
    break
  case 3:
    [$args, code, cb] = rest
    break
  case 4:
    [$args, dynamics, code, cb] = rest
    break
  default:
    throw new Error('wrong number of arguments')
  }
  awaitGenerator(expandAndEvalGen(env, scope, $args, dynamics, code, cb))
}
