/*
 * --- Jaspr Prototype REPL ---
 * Adam R. Nelson <adam@nels.onl>
 */

const parse = require('./parse')
const Promise = require('bluebird')
const _ = require('lodash')

const magicPrefix = "◊"
const scopeKey = magicPrefix + "scope"
const argsKey = magicPrefix + "args"
const aliasKey = magicPrefix + "alias"
let nextGensym = 0

const magicForms = {
  async if(p, thenCase, elseCase) {
    return jasprEval(this, jasprBool(await jasprEval(this, p)) ? thenCase : elseCase)
  },
  async copyScope() {
    return {[scopeKey]: Promise.resolve(_.clone(this))}
  },
  async extendScope(extras={}) {
    return {[scopeKey]: _.create(this, await jasprEval(this, extras))}
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
  async bool(a) { return jasprBool(a) },
  async equals(a, b) { return a === b },
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

async function followAliases(key, scope, history=new Set()) {
  if (history.has(key)) throw {err: "alias cycle", alias: key}
  if (key in scope) {
    const it = await Promise.resolve(scope[key])
    if (_.isPlainObject(it) && it.hasOwnProperty(aliasKey)) {
      history.add(key)
      return followAliases(it[aliasKey], scope, history)
    } else return key
  }
  throw {err: "no binding", name: key}
}

async function syntaxQuote(scope, codePromise) {
  const code = await Promise.resolve(codePromise)
  if (typeof(code) === "string") {
    try { return await followAliases(code, scope) }
    catch (e) { return code }
  } else if (_.isArray(code) && code.length > 0) {
    const fn = await Promise.resolve(code[0])
    if (fn === null || fn === true) return code
    if (fn === false) {
      if (code.length === 2) return jasprEval(scope, code[1])
      throw {err: `false (unquote) takes 1 argument, got ${code.length - 1}`}
    }
    if (_.isArray(fn) && fn.length === 1 && fn[0] === false) {
      throw {err: `[false] (inline unquote) is only valid inside an array`}
    }
    return Promise.map(code, async x => {
      if (_.isArray(x) && _.isArray(x[0]) && x[0].length === 1 && x[0][0] === false) {
        if (x.length === 2) return jasprEval(scope, x[1])
        throw {err: `[false] (inline unquote) takes 1 argument, got ${x.length - 1}`}
      }
      return [await syntaxQuote(scope, x)]
    }).then(_.flatten)
  } else if (_.isPlainObject(code)) {
    return _.mapValues(code, x => syntaxQuote(scope, x))
  } else return code
}

async function jasprEval(scope, codePromise) {
  const code = await Promise.resolve(codePromise)
  if (!code || code === true || typeof(code) === "number") {
    return code
  }
  if (typeof(code) === "string") {
    return scope[await followAliases(code, scope)]
  }
  if (_.isArray(code)) {
    if (code.length === 0) return code
    const pcode = code.map(Promise.resolve)
    const fn = await pcode[0]

    // null: quote
    if (fn === null) {
      if (pcode.length === 2) return pcode[1]
      throw {err: `null (quote) takes 1 argument, got ${pcode.length - 1}`}
    }

    // true/false: syntax quote
    if (fn === true) {
      if (pcode.length === 2) return syntaxQuote(scope, pcode[1])
      throw {err: `true (syntax quote) takes 1 argument, got ${pcode.length - 1}`}
    }
    if (fn === false) {
      throw {err: "unquote (~, false) can only occur inside syntax quote (`, true)"}
    }

    // "magic" special forms
    if (typeof(fn) === "string" && _.startsWith(fn, magicPrefix)) {
      const magic = fn.slice(magicPrefix.length)
      if (magicForms.hasOwnProperty(magic)) {
        return magicForms[magic].apply(scope, await Promise.all(pcode.slice(1)))
      } else if (magicFns.hasOwnProperty(magic)) {
        return magicFns[magic](...await Promise.all(pcode.slice(1).map(x => jasprEval(scope, x))))
      }
    }

    const efn = await jasprEval(scope, fn)

    // macro expansion
    if (_.isPlainObject(efn) && efn.hasOwnProperty(scopeKey) && efn.hasOwnProperty("macro")) {
      const macroScope = await Promise.resolve(efn[scopeKey])
      const expanded = await jasprEval(
        _.merge({}, macroScope, {[argsKey]: Promise.resolve(pcode.slice(1))}),
        efn.macro)
      //printValue(`\nmacroexpand ${await jasprToString(code)} =>\n`)(expanded)
      return jasprEval(scope, expanded)
    }

    // all other calls: functions and indexes
    return jasprCall(efn, await Promise.all(pcode.slice(1).map(x => jasprEval(scope, x))))
  }
  if (_.isPlainObject(code)) {
    if (code.hasOwnProperty(scopeKey)) {
      throw {err: "cannot eval a closure", closure: code}
    }
    return Promise.props(_.mapValues(code, x => jasprEval(scope, x)))
  }
  throw {err: "cannot eval: " + code}
}

async function jasprCall(callable, args=[]) {
  if (_.isPlainObject(callable)) {
    if (callable.hasOwnProperty(scopeKey) && callable.hasOwnProperty("fn")) {
      const scope = await Promise.resolve(callable[scopeKey])
      return jasprEval(_.create(scope, {[argsKey]: Promise.resolve(args)}), callable.fn)
    } else {
      throw {err: "not a function", fn: callable}
    }
  } else if (_.isArray(callable)) {
    return Promise.reduce(callable, async (args, c) => [jasprCall(c, args)], args)
      .then(a => a[0])
  } else if (args.length === 1) {
    if (callable === scopeKey) throw {err: `cannot access "${scopeKey}" directly`}
    const receiver = await args[0]
    if (receiver.hasOwnProperty(callable)) return receiver[callable]
    throw {err: "not found", key: callable, in: receiver}
  } else {
    throw {err: `${JSON.stringify(callable)} takes 1 argument, got ${args.length}`}
  }
}

const fs = Promise.promisifyAll(require("fs"))

const readline = require("readline")
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

async function evalScope(scope, parentScope={}) {
  let s = null
  s = _.merge({}, parentScope,
    _.mapValues(scope, x => Promise.delay(0).then(() => jasprEval(s, x))))
  return s
}

const jasprToString = options => async val => {
  if (_.isPlainObject(val)) {
    if (val.hasOwnProperty(scopeKey)) {
      if (options.json)
        throw {"err": "no JSON representation", "value": val}
      else return "(closure)"
    } else {
      const obj = await Promise.props(_.mapValues(await Promise.props(val), jasprToString(options)))
      return "{" + _(obj).toPairs().map(([k, v]) => JSON.stringify(k) + ": " + v).join(", ") + "}"
    }
  } else if (_.isArray(val)) {
    return "[" + _.join(await Promise.map(val, jasprToString(options)), ", ") + "]"
  } else if (typeof val === "string") {
    if (options.bareString) return val
    else return JSON.stringify(val)
  } else if (options.json) {
    try {return JSON.stringify(val)}
    catch (e) {throw {"err": "no JSON representation", "value": val}}
  } else return "" + val
}

const printValue = (prefix="") => (val) =>
  Promise.resolve(val).then(jasprToString({})).then(x => {
    console.log(prefix + x)
    return val
  })

function repl(scope) {
  rl.question("Jaspr> ", line =>
    line == "exit" ? rl.close() :
      Promise.resolve(line)
        .then(x => jasprEval(scope, parse(x)))
        .then(printValue(":= "), printValue("!! "))
        .then(() => setTimeout(() => repl(scope), 0)))
}

//repl({})
fs.readFileAsync("lib/prelude.json", "utf8")
  .then(j => evalScope(JSON.parse(j)))
  .then(repl)
