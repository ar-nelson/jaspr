const Promise = require('bluebird')
const _ = require('lodash')

const magicPrefix = "⚙"
const scopeKey = magicPrefix + "scope"
const macroscopeKey = magicPrefix + "macros"
const argsKey = magicPrefix + "args"
const macroKey = magicPrefix + "macro"
let nextGensym = 0

const magicForms = {
  async if(p, thenCase, elseCase) {
    return jasprEval(this, jasprBool(await jasprEval(this, p)) ? thenCase : elseCase)
  },
  async macroexpand(body) {
    return macroExpand(this.macroscope, await jasprEval(this, body))
  },
  async macroget(name) {
    const it = await Promise.resolve(this.macroscope[name])
    if (it === undefined) throw {err: "unbound macro name", name}
    return it
  },
  async copyScope() {
    return {
      [scopeKey]: Promise.resolve(_.clone(this.scope)),
      [macroscopeKey]: Promise.resolve(_.clone(this.macroscope))
    }
  },
  async extendScope(extras={}) {
    return {
      [scopeKey]: _.create(this.scope, await jasprEval(this, extras)),
      [macroscopeKey]: this.macroscope
    }
  },
  async extendMacroscope(extras={}) {
    const {scope, macroscope} = await evalScope(extras, this.scope, this.macroscope)
    return { [scopeKey]: scope, [macroscopeKey]: macroscope }
  }
}

const magicFns = {
  async gensym(name="gensym") {
    return `${name},${(nextGensym++).toString(16)}`
  },
  async print(a) {
    if (typeof(a) === "string") console.log(a)
    else printValue("")(a)
    return null
  },
  async apply(fn, args) { return jasprCall(fn, args) },
  async bool(a) { return jasprBool(a) },
  async equals(a, b) { return a === b },
  async less(a, b) { return a < b },
  async lessOrEqual(a, b) { return a <= b },
  async add(a, b) { return a + b },
  async subtract(a, b) { return a - b },
  async multiply(a, b) { return a * b },
  async divide(a, b) { return a / b },
  async modulus(a, b) { return a % b },
  async negate(a) { return -a },
  async toString(a) { return jasprToString({bareString: true})(a) },
  async toJson(a) { return jasprToString({json: true})(a) },
  async fromJson(a) { return JSON.parse(a) },
  async stringJoin(a, b) {
    return (await jasprToString({bareString: true})(a)) +
      (await jasprToString({bareString: true})(b))
  },
  async stringLength(str) { return str.length },
  async stringSlice(str, start, end) { return str.substring(start, end) },
  async arrayLength(arr) { return arr.length },
  async arraySlice(arr, start, end) { return arr.slice(start, end) },
  async makeObject(pairs) {
    const keys = await Promise.all(pairs.map(x => x[0]))
    return _.fromPairs(_.zipWith(keys, pairs, (k, [_, v]) => [k, v]))
  },
  async objectHas(obj, key) { return obj.hasOwnProperty(key) },
  async objectDelete(obj, key) {
    const obj2 = _.clone(obj)
    delete obj2[key]
    return obj2
  },
  async objectKeys(obj) { return Object.keys(obj) },
  async objectMerge(a, b) { return _.merge({}, a, b) },
  async isNumber(a) { return typeof(a) === "number" },
  async isString(a) { return typeof(a) === "string" },
  async isArray(a) { return _.isArray(a) },
  async isObject(a) { return _.isPlainObject(a) },
}

function jasprBool(a) {
  return !(!a
    || (_.isArray(a) && a.length === 0)
    || (_.isPlainObject(a) && Object.keys(a).length === 0))
}

function isClosure(obj) {
  return _.isPlainObject(obj) &&
    (obj.hasOwnProperty(scopeKey) || obj.hasOwnProperty(macroscopeKey))
}

async function macroSyntaxQuote(macroscope, codePromise) {
  const code = await Promise.resolve(codePromise)
  if (_.isArray(code) && code.length > 0) {
    const fn = await Promise.resolve(code[0])
    if (fn === null || fn === true) return code
    if (fn === false) {
      if (code.length === 2) return [false, await macroExpand(macroscope, code[1])]
      throw {err: `false (unquote) takes 1 argument, got ${code.length - 1}`, code}
    }
    if (_.isArray(fn) && fn.length === 1 && fn[0] === false) {
      if (code.length === 2) return [[false], await macroExpand(macroscope, code[1])]
      throw {err: `[false] (inline unquote) takes 1 argument, got ${code.length - 1}`, code}
    }
    return Promise.map(code, x => macroSyntaxQuote(macroscope, x))
  } else if (_.isPlainObject(code)) {
    return _.mapValues(code, (x, k) => {
      if (k === scopeKey || k === macroscopeKey) return x
      return macroSyntaxQuote(macroscope, x)
    })
  } else return code
}

async function syntaxQuote(scopes, codePromise) {
  const code = await Promise.resolve(codePromise)
  if (_.isArray(code) && code.length > 0) {
    const fn = await Promise.resolve(code[0])
    if (fn === null || fn === true) return code
    if (fn === false) return jasprEval(scopes, code[1])
    return Promise.map(code, async x => {
      if (_.isArray(x) && _.isArray(x[0]) && x[0].length === 1 && x[0][0] === false) {
        return jasprEval(scopes, x[1])
      }
      return [await syntaxQuote(scopes, x)]
    }).then(_.flatten)
  } else if (_.isPlainObject(code)) {
    return _.mapValues(code, (x, k) => {
      if (k === scopeKey || k === macroscopeKey) return x
      return syntaxQuote(scopes, x)
    })
  } else return code
}

async function macroExpand(macroscope, codePromise) {
  const code = await Promise.resolve(codePromise)
  if (_.isArray(code)) {
    if (code.length === 0) return code
    const origFn = await Promise.resolve(code[0])
    if (origFn === null) return code
    if (origFn === true) {
      if (code.length === 2) {
        return [true, await macroSyntaxQuote(macroscope, await Promise.resolve(code[1]))]
      }
      throw {err: `true (syntax quote) takes 1 argument, got ${code.length - 1}`, code}
    }
    const fn = await macroExpand(macroscope, origFn)
    if (typeof(fn) === "string") {
      if (fn === magicPrefix + "extendMacroscope") {
        return [fn].concat(code.slice(1))
      }
      const macro = await Promise.resolve(macroscope[fn])
      if (macro) return macroExpand(macroscope,
        await jasprCall(macro, Promise.map(code.slice(1), x => macroExpand(macroscope, x))))
    }
    return Promise.map(code, x => macroExpand(macroscope, x))
  } else if (_.isPlainObject(code)) {
    if (isClosure(code)) throw {err: "cannot macroexpand a closure", code}
    return Promise.props(_.mapValues(code, x => macroExpand(macroscope, x)))
  } else return code
}

async function jasprEval(scopes, codePromise) {
  const scope = scopes.scope
  const code = await Promise.resolve(codePromise)
  if (scope === undefined) throw {err: "scope is undefined", code}
  if (!code || code === true || typeof(code) === "number") {
    return code
  }
  if (typeof(code) === "string") {
    const it = await Promise.resolve(scope[code])
    if (it === undefined) throw {err: "unbound name", name: code}
    return it
  }
  if (_.isArray(code)) {
    if (code.length === 0) return code
    const pcode = code.map(Promise.resolve)
    const fn = await pcode[0]

    // null: quote
    if (fn === null) {
      if (pcode.length === 2) return pcode[1]
      throw {err: `null (quote) takes 1 argument, got ${pcode.length - 1}`, code}
    }

    // true/false: syntax quote
    if (fn === true) return syntaxQuote(scopes, pcode[1])
    if (fn === false) {
      throw {err: "unquote (~, false) can only occur inside syntax quote (`, true)", code}
    }

    // "magic" special forms
    if (typeof(fn) === "string" && _.startsWith(fn, magicPrefix)) {
      const magic = fn.slice(magicPrefix.length)
      if (magicForms.hasOwnProperty(magic)) {
        return magicForms[magic].apply(scopes, await Promise.all(pcode.slice(1)))
      } else if (magicFns.hasOwnProperty(magic)) {
        return magicFns[magic](...await Promise.all(pcode.slice(1).map(x => jasprEval(scopes, x))))
      }
    }

    // all other calls: functions and indexes
    const efn = await jasprEval(scopes, fn)
    try {
      return jasprCall(efn, await Promise.all(pcode.slice(1).map(x => jasprEval(scopes, x))))
    } catch (err) {
      if (_.isPlainObject(err)) err.context = code
      throw err
    }
  }
  if (_.isPlainObject(code)) {
    if (isClosure(code)) throw {err: "cannot eval a closure", code}
    return Promise.props(_.mapValues(code, x => jasprEval(scopes, x)))
  }
  throw {err: "cannot eval: " + code}
}

async function jasprCall(callable, args=[]) {
  if (isClosure(callable)) {
    if (callable.hasOwnProperty("fn")) {
      const scope = await Promise.resolve(callable[scopeKey])
      const macroscope = (await Promise.resolve(callable[macroscopeKey])) || {}
      return jasprEval({
          scope: _.create(scope, {[argsKey]: Promise.resolve(args)}),
          macroscope
        }, callable.fn)
    } else {
      throw {err: "closure has no code", fn: callable, args}
    }
  } else if (_.isArray(callable)) {
    return Promise.reduce(callable, async (args, c) => [jasprCall(c, args)], args)
      .then(a => a[0])
  } else if (typeof(callable) === "number") {
    if (args.length !== 1) {
      throw {err: `index takes 1 argument, got ${args.length}`, index: callable}
    }
    const receiver = await Promise.resolve(args[0])
    if (!_.isArray(receiver)) {
      throw {err: `numeric index into non-array`, index: callable}
    }
    let index = callable < 0 ? receiver.length - callable : callable
    if (0 <= index && index < receiver.length) return receiver[index]
    throw {err: "not found", key: index, in: receiver}
  } else if (typeof(callable) === "string") {
    if (callable === scopeKey || callable === macroscopeKey) {
      throw {err: `cannot access "${callable}" directly`}
    }
    if (args.length !== 1) {
      throw {err: `index takes 1 argument, got ${args.length}`, index: callable}
    }
    const receiver = await Promise.resolve(args[0])
    if (!_.isPlainObject(receiver)) {
      throw {err: `string index into non-object`, index: callable}
    }
    if (receiver.hasOwnProperty(callable)) return receiver[callable]
    throw {err: "not found", key: callable, in: receiver}
  } else {
    throw {err: "not callable", fn: callable, args}
  }
}

async function evalModule(module, parentScope={}, parentMacroscope={}) {
  let scope = null, macroscope = null
  const name = module.module
  const exports = module.export
  scope = _.mapValues(module.defs || {}, (v, k) =>
    Promise.delay(0)
           .then(() => macroExpand(macroscope, v),
                 printValue(`!! MACROEXPAND ERROR IN ${name}.${k}: `, true))
           .then(x => jasprEval({scope, macroscope}, x),
                 printValue(`!! EVAL ERROR IN ${name}.${k}: `, true)))

  macroscope = _.mapValues(module.macros || {}, (v, k) =>
    Promise.delay(0)
           .then(() => macroExpand(macroscope, v),
                 printValue(`!! MACROEXPAND ERROR IN ${name}.${k}: `, true))
           .then(x => jasprEval({scope, macroscope}, x),
                 printValue(`!! EVAL ERROR IN ${name}.${k}: `, true)))
  return {
    name,
    scope: _.pick(scope, exports),
    macroscope: _.pick(macroscope, exports)
  }
}

const jasprToString = options => async val => {
  if (_.isPlainObject(val)) {
    if (isClosure(val)) {
      if (options.json) throw {"err": "no JSON representation", "value": val}
      else return "(closure)"
    } else {
      const obj = await Promise.props(
        _.mapValues(await Promise.props(val), jasprToString({json: options.json})))
      const elements = await Promise.map(_.toPairs(obj),
        async ([k, v]) => (await jasprToString({json: options.json})(k)) + ": " + v)
      return `{${_.join(elements, ", ")}}`
    }
  } else if (_.isArray(val)) {
    const elements = await Promise.map(val, jasprToString({json: options.json}))
    return `[${_.join(elements, ", ")}]`
  } else if (typeof val === "string") {
    if (options.bareString) return val
    else if (options.json || /[()\[\]{},:"\s]|(\/\/)|(\/\*)|(\*\/)/.test(val)) {
      return JSON.stringify(val)
    } else return val
  } else if (options.json) {
    try {return JSON.stringify(val)}
    catch (e) {throw {"err": "no JSON representation", "value": val}}
  } else {
    if (val instanceof Error) console.error(val)
    return "" + val
  }
}

const printValue = (prefix="", fail=false) => (val) =>
  Promise.resolve(val).then(jasprToString({})).then(x => {
    console.log(prefix + x)
    if (fail) {throw val} else {return val}
  })

module.exports = {jasprEval, macroExpand, evalModule, isClosure, jasprToString, printValue}
