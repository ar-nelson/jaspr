import * as _ from 'lodash'
import {reduce as asyncReduce} from 'async'
import * as XRegExp from 'xregexp'
import * as fs from 'fs'
import * as path from 'path'
import {
  Jaspr, JasprObject, JasprError, Json, JsonObject, Deferred, Callback, isArray,
  isObject, has
} from './Jaspr'
import {
  Scope, emptyScope, mergeScopes, Env, evalDefs, expandAndEval, isLegalName,
  Namespace, qualify, validateNames
} from './Interpreter'
import {prefix, primitiveModule} from './ReservedNames'
import Parser from './Parser'
import {parseMarkdown} from './LiterateParser'

export const currentSchema = "http://adam.nels.onl/schema/jaspr/module"

export type ImportSource = 'local' | 'file' | 'http' | 'git'

export interface Import extends JsonObject {
  from: string
  via: ImportSource
  module: string
  version: string | null
  names: boolean | { [as: string]: string }
}

export interface ModuleSource {
  $schema: string
  $module?: string
  $version?: string
  $doc?: string
  $author?: string
  $main?: Json
  $import?: { [namespace: string]: Import }
  $export?: { [as: string]: string }
  [name: string]: Json | undefined
}

export interface Module extends Scope, Namespace {
  $schema: string
  $module: string | null
  $version: string | null
  $doc: string | null
  $author: string | null
  $main: Jaspr | Deferred
  $import: { [namespace: string]: Import }
  $export: { [as: string]: string }
}

export const markdownExtensions = ['.md', '.mkd', '.markdown']

const githubRegex = /^https?:\/\/(www[.])?github[.]com\/[^\/]+\/[^\/]+/
const httpRegex = /^https?:\/\/.+/
const moduleSegment = '(\\pL|\\p{Pd}|\\p{Pc})(\\pL|\\pN|\\p{Pd}|\\p{Pc}|\\p{Sk})*'
const moduleNameRegex = XRegExp(`^${moduleSegment}([.]${moduleSegment})*$`, 'A')


function importSource(from: string): ImportSource {
  if (githubRegex.test(from)) return 'git'
  else if (httpRegex.test(from)) return 'http'
  else if (moduleNameRegex.test(from)) return 'local'
  return 'file'
}

function normalizeImports(imports?: Json): { [namespace: string]: Import } {
  if (imports == null) return {}
  if (isArray(imports)) {
    imports = <JsonObject>_(imports).map(name => {
      if (typeof name === 'string') return [name, name]
      else throw {err: 'import is not a string', import: name}
    }).fromPairs().value()
  }
  if (!isObject(imports)) throw {err: 'imports is not an object or array'}
  return _.mapValues(imports, (imp, name): Import => {
    if (!moduleNameRegex.test(name)) throw {err: 'illegal import name', name}
    if (typeof imp === 'boolean') {
      return {from: name, via: importSource(name), module: name, version: null, names: imp}
    } else if (typeof imp === 'string') {
      return {from: imp, via: importSource(imp), module: name, version: null, names: {}}
    } else if (isObject(imp)) {
      if (imp.hasOwnProperty('from')) {
        if (typeof imp.from !== 'string') {
          throw {err: 'import.from is not a string', name, import: imp}
        }
      } else imp.from = name
      switch (imp.via) {
        case 'local': case 'file': case 'http': case 'git':
          break
        case undefined:
          imp.via = importSource('' + imp.from)
          break
        default:
          throw {
            err: 'import.via is not a supported source',
            help: 'Supported sources are "local", "file", "http", and "git".',
            name, import: imp
          }
      }
      if (imp.hasOwnProperty('module')) {
        if (typeof imp.from !== 'string') {
          throw {err: 'import.module is not a string', name, import: imp}
        }
      } else imp.module = imp.via === 'local' ? imp.from : name
      imp.names = normalizeExports(imp.names, 'imported name')
      return <Import>imp
    } else throw {err: 'illegal import value', name, import: imp}
  })
}

function normalizeExports(exports?: Json, name = 'export'): { [as: string]: string } {
  if (exports == null) return {}
  if (isArray(exports)) {
    exports = <JsonObject>_(exports).map(key => {
      if (typeof key === 'string') return [key, key]
      else throw {err: `${name} is not a string`, key, value: key}
    }).fromPairs().value()
  }
  if (!isObject(exports)) throw {err: `${name}s is not an object or array`}
  for (let key in exports) {
    const value = exports[key]
    if (!isLegalName(key)) throw {err: `illegal ${name} key`, key, value}
    if (typeof value !== 'string') throw {err: `${name} is not a string`, key, value}
    if (!isLegalName(value)) throw {err: `illegal ${name} value`, key, value}
  }
  return <any>exports
}

export function readModuleFile(
  filename: string,
  cb: AsyncResultCallback<ModuleSource, JasprError>,
  history: string[] = []
): void {
  filename = path.normalize(filename)
  if (history.indexOf(filename) >= 0) {
    return cb(undefined, {$schema: currentSchema})
  }
  history.push(filename)
  fs.readFile(filename, (err, data) => {
    // Error check
    if (err != null) return cb({
      err: 'ReadFailed', why: 'failed to read module file', filename,
      'node-error': {
        name: err.name,
        message: err.message,
        errno: err.errno || null,
        path: err.path || null
      }
    })

    // Parse
    let src: Json
    try {
      if (_.some(markdownExtensions, e => filename.endsWith(e))) {
        src = parseMarkdown(data.toString('utf8'), filename)
      } else {
        const parser = new Parser(filename)
        parser.read(data.toString('utf8'))
        src = parser.getOneResult()
      }
    } catch (ex) {
      if (ex instanceof Parser.ParseError) {
        const {filename, line, column} = ex.location
        return cb({
          err: 'ParseFailed', why: ex.message,
          filename: filename || null, line, column
        })
      } else throw ex
    }

    // Validate string properties
    if (!isObject(src)) return cb({
      err: 'BadModule', why: 'module is not an object',
      module: src, filename
    })
    if (src.$schema !== currentSchema) return cb({
      err: 'BadModule', why: 'bad or missing $schema property',
      help: `
        Jaspr modules must have a $schema property, and that property must be a
        valid Jaspr module schema location. Currently, the only supported schema
        is "${currentSchema}".
      `.trim().replace(/\s+/gm, ' '),
      schema: src.$schema || null, filename
    })
    for (let key of ['$module', '$doc', '$author']) {
       if (src.hasOwnProperty(key) && typeof src[key] !== 'string') return cb({
         err: 'BadModule', why: `${key} is not a string`,
         [key]: src[key], filename
       })
    }
    if (src.hasOwnProperty('$module') && !moduleNameRegex.test('' + src.$module)) {
      return cb({
        err: 'BadModule', why: 'bad module name ($module property)',
        $module: src.$module, filename
      })
    }

    try {
      // Format imports and exports
      src.$import = normalizeImports(src.$import || src.$imports)
      delete src.$imports
      src.$export = normalizeExports(src.$export || src.$exports)
      delete src.$exports

      // Load includes
      if (src.hasOwnProperty('$include')) {
        const includes = src.$include
        delete src.$include
        if (isArray(includes)) {
          const includeNext = (mod: ModuleSource) => {
            const include = includes.pop()
            if (include === undefined) return cb(undefined, mod)
            else if (typeof include !== 'string') return cb({
              err: 'BadModule', why: 'include is not a string',
              include, filename
            })
            const incFilename =
              path.isAbsolute(include)
              ? include : path.join(path.dirname(filename), include)
            readModuleFile(incFilename, (err, included) => {
              if (err) return cb(err)
              includeNext(mergeModules(
                <ModuleSource>mod, <ModuleSource>included,
                filename, incFilename))
            }, history)
          }
          includeNext(<ModuleSource>src)
        } else throw {
          err: 'BadModule', why: '$include is not an array', $include: includes
        }
      } else {
        cb(undefined, <ModuleSource>src)
      }
    } catch (ex) {
      ex.filename = filename
      cb(ex)
    }
  })
}

function mergeModules(
  left: ModuleSource, right: ModuleSource,
  lFilename: string, rFilename: string
): ModuleSource {
  return _.assignInWith(left, right, (l: Json, r: Json, name: string): Json => {
    if (l === undefined) return r
    if (r === undefined) return l
    function mergeNames(ln: any, rn: any, kind: string): Dictionary<string> {
      return _.assignInWith(ln, rn, (l: string, r: string, name: string): string => {
        if (l === undefined) return r
        if (r === undefined) return l
        if (l !== r) throw {
          err: 'BadModule', why: `include failed: duplicate ${kind}`,
          includer: lFilename, included: rFilename, name,
          'includer-value': l, 'included-value': r
        }
        return l
      })
    }
    switch (name) {
      case '$import':
        return _.assignInWith(<any>l, <any>r,
          (l: Import, r: Import, name: string): Import => {
            if (l === undefined) return r
            if (r === undefined) return l
            if (l.from !== r.from || l.via !== r.via || l.module !== r.module) {
              throw {
                err: 'BadModule', why: 'include failed: duplicate import',
                includer: lFilename, included: rFilename, name,
                'includer-import': l, 'included-import': r
              }
            }
            return {
              from: l.from, via: l.via, module: l.module, version: null,
              names: mergeNames(l.names, r.names, 'imported value')
            }
          })
      case '$export':
        return mergeNames(l, r, 'export')
      default:
        if (l === r) return l
        else throw {
          err: 'BadModule', why: 'include failed: duplicate name',
          includer: lFilename, included: rFilename, name,
          'includer-value': l, 'included-value': r
        }
    }
  })
}

function loadImport(
  alias: string,
  {from, via, module, version, names} : Import,
  filename: string,
  localModules = new Map<string, Module>()
): Scope {
  if (!moduleNameRegex.test(alias)) throw {
    err: 'BadModule', why: 'illegal import alias; contains special characters',
    alias, filename
  }
  if (via !== 'local') throw {
    err: 'NotImplemented', why: `import loader ${via} is not yet implemented`,
    filename
  }
  const imported = localModules.get(from)
  if (!imported) throw {
    err: 'BadModule', why: 'local import not found', importedModule: from,
    filename
  }
  if (imported.$module == null) throw {
    err: 'BadModule', why: 'cannot import script module', module: alias,
    help: 'A module without a $module key is a script module, and cannot be imported.'
  }
  return importModule(imported, alias, names === true ? undefined : names || {})
}

export function evalModule(
  env: Env,
  module: ModuleSource,
  options: {
    filename: string,
    scope?: Scope,
    runMain?: boolean,
    localModules?: Map<string, Module>
  },
  cb: AsyncResultCallback<Module, JasprError>,
): void {
  const {runMain, filename} = options
  const {$schema, $module, $version, $main, $import, $export, $doc, $author} = module
  if ($module === undefined && $main === undefined) return cb({
    err: 'BadModule', why: 'module must have either $module key or $main key',
    filename
  })

  let evalScope
  try {
    evalScope = _.toPairs($import || {}).reduce(
      (scope, [alias, imp]) => mergeScopes(env, scope,
        loadImport(alias, ($import || {})[alias], filename,
                   options.localModules)),
      options.scope || emptyScope)
  } catch (err) { return cb(err) }

  const defs: JasprObject = _.omit(
    _.pickBy(module, v => v !== undefined),
    ...Object.keys(module).filter(x => x.startsWith('$')))
  const ns = {$module: $module || null, $version: $version || null}
  const nameError = validateNames(defs, ns)
  if (nameError != null) return cb(nameError)
  const scope = evalDefs(env, evalScope, [], undefined, defs, ns)
    
  // TODO: Remove this debug code!
  // ---------------------------------------------------------------------------
  for (let k in scope.value) {
    const v = scope.value[k]
    if (v instanceof Deferred) {
      const timeout =
        setTimeout(() => console.warn(`value.${k} has not resolved!`), 2500)
      v.await(() => clearTimeout(timeout))
    }
  }
  for (let k in scope.macro) {
    const v = scope.macro[k]
    if (v instanceof Deferred) {
      const timeout =
        setTimeout(() => console.warn(`macro.${k} has not resolved!`), 2500)
      v.await(() => clearTimeout(timeout))
    }
  }
  // ---------------------------------------------------------------------------

  scope.$schema = $schema
  scope.$module = $module || null
  scope.$version = $version || null
  scope.$doc = $doc || null
  scope.$author = $author || null
  scope.$import = $import || Object.create(null)
  scope.$export = $export || Object.create(null)
  //scope.$main = runMain && $main !== undefined
  //  ? deferExpandEval(env, scope, $main, qualify(ns, '$main'))
  //  : null
  cb(undefined, <Module>scope)
}

export function importModule(
  module: Module,
  alias = module.$module,
  names: Dictionary<string> =
    _(module.$export).keys().map(k => [k, k]).fromPairs().value()
): Scope {
  function onlyExports<T>(sc: Dictionary<T>): Dictionary<T> {
    const out: Dictionary<T> = Object.create(null)
    _.forIn(module.$export, (exported, as) => {
      const qualified = qualify(module, exported)
      if (has(sc, qualified)) {
        out[qualify(module, as)] = sc[qualified]
        if (alias) out[`${alias}.${as}`] = sc[qualified]
      }
    })
    // TODO: Raise BadModule if a name does not refer to an actual import
    _.forIn(names, (imported, as) => {
      const qualified = qualify(module, imported)
      if (has(out, qualified)) out[as] = out[qualified]
    })
    return out
  }
  const out: Scope = <any>
    _(module).omit('test', 'qualified')
             .omitBy((v, k) => k.startsWith('$'))
             .mapValues((v: Jaspr, k) => isObject(v) ? onlyExports(v) : v)
             .value()
  out.test = Object.create(null)
  out.qualified = Object.create(null)
  _.toPairs(names).concat(<any>(
    alias ? _.keys(module.$export).map(k => [`${alias}.${k}`, k]).concat() : [])
  ).forEach(([as, imported]) =>
    out.qualified[as] = qualify(module, imported))
  return out
}
