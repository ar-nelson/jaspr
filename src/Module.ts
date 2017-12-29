import * as _ from 'lodash'
import * as XRegExp from 'xregexp'
import * as fs from 'fs'
import * as path from 'path'
import {
  Jaspr, JasprObject, JasprError, Json, JsonObject, Deferred, Callback,
  ErrCallback, isArray, isObject, has
} from './Jaspr'
import {
  Scope, emptyScope, mergeScopes, Env, evalDefs, expandAndEval, isLegalName,
  Namespace, qualify, validateNames
} from './Interpreter'
import {prefix, primitiveModule} from './ReservedNames'
import Parser from './Parser'
import {parseMarkdown, markdownExtensions} from './LiterateParser'

/** The JSON schema URL that all Jaspr modules must contain */
export const currentSchema = "http://adam.nels.onl/schema/jaspr/module"

/** Enumeration of all valid module sources */
export type ImportSource = 'local' | 'file' | 'http' | 'git'

/**
 * An import clause, from the `$import` section of a Jaspr module.
 * Contains a module name and version, and specifies where the module should be
 * loaded from and what names can be included in the top-level scope.
 */
export interface Import extends JsonObject {
  /** Path or URL to load the module from; format depends on `via` */
  from: string
  /** Type of source to load the module from (http, file, git, etc.) */
  via: ImportSource
  /** Name of the module to import */
  module: string
  /** Optional module version; if not present, most recent version */
  version: string | null
  /** 
   * Names from the module to include in the top-level scope (unqualified).
   * May create aliases. `false` is equivalent to `{}`; `true` imports
   * everything.
   */
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
  cb: ErrCallback<ModuleSource>,
  history?: string[]
): void {
  filename = path.normalize(filename)
  if (history) {
    if (history.indexOf(filename) >= 0) {
      return cb(null, {$schema: currentSchema})
    }
    history.push(filename)
  }
  fs.readFile(filename, (err, data) => {
    // Error check
    if (err != null) return cb({
      err: 'ReadFailed', why: 'failed to read module file', filename,
      'nodeError': {
        name: err.name,
        message: err.message,
        errno: err.errno || null,
        path: err.path || null
      }
    }, null)

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
        }, null)
      } else throw ex
    }

    if (!isObject(src)) return cb({
      err: 'BadModule', why: 'module is not an object',
      module: src, filename
    }, null)
    
    // Format imports and exports
    src.$import = normalizeImports(src.$import || src.$imports)
    delete src.$imports
    src.$export = normalizeExports(src.$export || src.$exports)
    delete src.$exports

    // Validate string properties if this is not an include file
    const done: (m: ModuleSource) => void =
      history ? src => cb(null, src) :
      src => {
        if (src.$schema !== currentSchema) return cb({
          err: 'BadModule', why: 'bad or missing $schema property',
          help: `
            Jaspr modules must have a $schema property, and that property must
            be a valid Jaspr module schema location. Currently, the only
            supported schema is "${currentSchema}".
          `.trim().replace(/\s+/gm, ' '),
          schema: src.$schema || null, filename
        }, null)
        for (let key of ['$module', '$doc', '$author']) {
          if (src.hasOwnProperty(key) && typeof src[key] !== 'string') {
            return cb(<any>{
              err: 'BadModule', why: `${key} is not a string`,
              [key]: src[key], filename
            }, null)
          }
        }
        if (src.hasOwnProperty('$module') &&
            !moduleNameRegex.test('' + src.$module)) {
          return cb(<any>{
            err: 'BadModule', why: 'bad module name ($module property)',
            $module: src.$module, filename
          }, null)
        }
        cb(null, src)
      }

    // Load includes
    if (src.hasOwnProperty('$include')) {
      const includes = src.$include, includeHistory = history || [filename]
      delete src.$include
      if (isArray(includes)) {
        const includeNext = (mod: ModuleSource) => {
          const include = includes.pop()
          if (include === undefined) return done(mod)
          else if (typeof include !== 'string') return cb({
            err: 'BadModule', why: 'include is not a string',
            include, filename
          }, null)
          const incFilename =
            path.isAbsolute(include)
            ? include : path.join(path.dirname(filename), include)
          readModuleFile(incFilename, (err, included) => {
            if (err) return cb(err, null)
            includeNext(mergeModules(
              <ModuleSource>mod, <ModuleSource>included,
              filename, incFilename))
          }, includeHistory)
        }
        includeNext(<ModuleSource>src)
      } else cb({
        err: 'BadModule', why: '$include is not an array', $include: includes,
        filename
      }, null)
    } else done(<ModuleSource>src)
  })
}

function mergeModules(
  left: ModuleSource, right: ModuleSource,
  lFilename: string, rFilename: string
): ModuleSource {
  return _.assignInWith(left, right, (l: Json, r: Json, name: string): Json => {
    if (l === undefined) return r
    if (r === undefined) return l
    function mergeNames(ln: any, rn: any, kind: string): {[k: string]: string} {
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
  localModules = new Map<string, Promise<Module>>()
): Promise<Scope> {
  if (!moduleNameRegex.test(alias)) return Promise.reject({
    err: 'BadModule', why: 'illegal import alias; contains special characters',
    alias, filename
  })
  if (via !== 'local') return Promise.reject({
    err: 'NotImplemented', why: `import loader ${via} is not yet implemented`,
    filename
  })
  const imported = localModules.get(from)
  if (imported) return imported.then(mod => {
    if (mod.$module == null) throw {
      err: 'BadModule', why: 'cannot import script module', module: alias,
      help: 'A module without a $module key is a script module, and cannot be imported.'
    }
    return importModule(mod, alias, names === true ? undefined : (names || {}))
  })
  else return Promise.reject({
    err: 'BadModule', why: 'local import not found', importedModule: from,
    filename
  })
}

export function evalModule(
  env: Env,
  module: ModuleSource,
  options: {
    filename: string,
    scope?: Scope,
    runMain?: boolean,
    localModules?: Map<string, Promise<Module>>
  }
): Promise<Module> {
  const {runMain, filename} = options
  const {$schema, $module, $version, $main, $import, $export, $doc, $author} = module
  if ($module === undefined && $main === undefined) return Promise.reject({
    err: 'BadModule', why: 'module must have either $module key or $main key',
    filename
  })

  const imports: [string, Import][] = _.toPairs($import || {})
  return (function nextImport(scope: Scope): Promise<Module> {
    const popped = imports.pop()
    if (popped) {
      const [alias, imp] = popped
      return loadImport(alias, imp, filename, options.localModules).then(
        imported => nextImport(mergeScopes(env, scope, imported)))
    } else {
      const defs: JasprObject = _.omit(
        _.pickBy(module, v => v !== undefined),
        ...Object.keys(module).filter(x => x.startsWith('$')))
      const ns = {$module: $module || null, $version: $version || null}
      const nameError = validateNames(defs, ns)
      if (nameError != null) return Promise.reject(nameError)
      const mod = evalDefs(env, scope, [], undefined, defs, ns)

      // TODO: Remove this debug code!
      // -----------------------------------------------------------------------
      for (let k in mod.value) {
        const v = mod.value[k]
        if (v instanceof Deferred) {
          const timeout =
            setTimeout(() => console.warn(`value.${k} has not resolved!`), 2500)
          v.await(() => clearTimeout(timeout))
        }
      }
      for (let k in mod.macro) {
        const v = mod.macro[k]
        if (v instanceof Deferred) {
          const timeout =
            setTimeout(() => console.warn(`macro.${k} has not resolved!`), 2500)
          v.await(() => clearTimeout(timeout))
        }
      }
      // -----------------------------------------------------------------------

      return Promise.resolve(Object.assign(mod, {
        $schema,
        $module: $module || null,
        $version: $version || null,
        $doc: $doc || null,
        $author: $author || null,
        $import: $import || Object.create(null),
        $export: $export || Object.create(null),
        $main: options.runMain && $main !== undefined
          ? expandAndEval(env, mod, [], undefined, $main)
          : null
      }))
    }
  })(options.scope || emptyScope)
}

export function importModule(
  module: Module,
  alias = module.$module,
  names: {[name: string]: string} =
    _(module.$export).keys().map(k => [k, k]).fromPairs().value()
): Scope {
  function onlyExports<T>(sc: {[name: string]: T}): {[name: string]: T} {
    const out: {[name: string]: T} = Object.create(null)
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
    alias ? _.keys(module.$export).map(k => [`${alias}.${k}`, k]) : [])
  ).forEach(([as, imported]) =>
    out.qualified[as] = qualify(module, imported))
  return out
}
