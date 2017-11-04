import * as _ from 'lodash'
import {reduce as asyncReduce} from 'async'
import * as XRegExp from 'xregexp'
import * as fs from 'fs'
import * as path from 'path'
import {
  Jaspr, JasprObject, Json, JsonObject, Deferred, Scope, emptyScope, isArray,
  isObject
} from './Jaspr'
import {
  Env, evalDefs, deferExpandEval, JasprError, isLegalName
} from './Interpreter'
import {has} from './BuiltinFunctions'
import {prefix} from './ReservedNames'
import Parser from './Parser'
import {parseMarkdown} from './LiterateParser'

export const currentSchema = "http://adam.nels.onl/schema/jaspr/module"

export type ImportSource = 'local' | 'file' | 'http' | 'git'

export interface Import extends JsonObject {
  from: string
  via: ImportSource
  module: string
  names: boolean | { [as: string]: string }
}

export interface ModuleSource {
  $schema: string
  $module?: string
  $doc?: string
  $author?: string
  $main?: Json
  // $include: boolean | string[]
  $import?: { [namespace: string]: Import }
  $export?: { [as: string]: string }
  [name: string]: Json | undefined
}

export interface Module extends Scope {
  $schema: string
  $module: string | null
  $doc: string | null
  $author: string | null
  $main: Jaspr | Deferred
  $import: { [namespace: string]: Import }
  $export: { [as: string]: string }
}

export const markdownExtensions = ['.md', 'mkd', '.markdown']

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
      return {from: name, via: importSource(name), module: name, names: imp}
    } else if (typeof imp === 'string') {
      return {from: imp, via: importSource(imp), module: name, names: {}}
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
  if (history.indexOf(filename) > 0) {
    return cb(undefined, {$schema: currentSchema})
  }
  fs.readFile(filename, (err, data) => {
    // Error check
    if (err != null) return cb({
      err: 'module read failed', filename,
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
          err: 'module parse failed', why: ex.message,
          filename: filename || null, line, column
        })
      } else throw ex
    }

    // Validate string properties
    if (!isObject(src)) return cb({
      err: 'module is not an object', module: src, filename
    })
    if (src.$schema !== currentSchema) return cb({
      err: 'bad schema',
      help: `
        Jaspr modules must have a $schema property, and that property must be a
        valid Jaspr module schema location. Currently, the only supported schema
        is "${currentSchema}".
      `.trim().replace(/\s+/, ' '),
      schema: src.$schema || null, filename
    })
    if (src.$include === true && history.length === 0) return cb({
      err: 'module is an include file', filename,
      help: `
        A module with the property "$include: true" is an include file. It can
        only be included by other modules, not loaded as a module on its own.
      `.trim().replace(/\s+/, ' '),
    })
    for (let key of ['$module', '$doc', '$author']) {
       if (src.hasOwnProperty(key) && typeof src[key] !== 'string') return cb({
         err: `${key} is not a string`, [key]: src[key], filename
       })
    }
    if (src.hasOwnProperty('$module') && !moduleNameRegex.test('' + src.$module)) {
      return cb({err: 'bad module name', $module: src.$module, filename})
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
          asyncReduce(includes, <ModuleSource>src, (mod, el, cb) => {
            if (typeof el === 'string') {
              const incFilename =
                path.isAbsolute(el) ? el : path.join(path.dirname(filename), el)
              readModuleFile(incFilename, (err, included) => {
                if (err) return cb(err)
                history.push(path.normalize(incFilename))
                cb(undefined, mergeModules(
                  <ModuleSource>mod, <ModuleSource>included,
                  filename, incFilename))
              }, history.concat([filename]))
            } else {
              cb({err: 'include is not a string', include: el, filename})
            }
          }, cb)
        } else throw {err: '$include is not an array', $include: includes}
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
  return _.mergeWith(left, right, (l: Json, r: Json, name: string): Json => {
    if (l === undefined) return r
    if (r === undefined) return l
    function mergeNames(ln: any, rn: any, kind: string): Dictionary<string> {
      return _.mergeWith(ln, rn, (l: string, r: string, name: string): string => {
        if (l === undefined) return r
        if (r === undefined) return l
        if (l !== r) throw {
          err: `include failed: duplicate ${kind}`,
          includer: lFilename, included: rFilename, name,
          'includer-value': l, 'included-value': r
        }
        return l
      })
    }
    switch (name) {
      case '$import':
        return _.mergeWith(<any>l, <any>r,
          (l: Import, r: Import, name: string): Import => {
            if (l === undefined) return r
            if (r === undefined) return l
            if (l.from !== r.from || l.via !== r.via || l.module !== r.module) {
              throw {
                err: 'include failed: duplicate import',
                includer: lFilename, included: rFilename, name,
                'includer-import': l, 'included-import': r
              }
            }
            return {
              from: l.from, via: l.via, module: l.module,
              names: mergeNames(l.names, r.names, 'imported value')
            }
          })
      case '$export':
        return mergeNames(l, r, 'export')
      default:
        if (l === r) return l
        else throw {
          err: 'include failed: duplicate name',
          includer: lFilename, included: rFilename, name,
          'includer-value': l, 'included-value': r
        }
    }
  })
}

export function evalModule(
  env: Env,
  module: ModuleSource,
  evalScope: Scope = emptyScope
): Module {
  const {$schema, $module, $main, $import, $export, $doc, $author} = module
  if ($module === undefined && $main === undefined) {
    // TODO: Throw Jaspr error instead of JS exception
    throw new Error('module must define either $module or $main')
  }
  // TODO: Load imports
  const out = evalDefs(env, evalScope,
    _.pickBy(module, v => v !== undefined),
    $module)
  function makeExports<T>(sc: {[k: string]: T}): Dictionary<T> {
    return _.transform($export || {}, (def, exported, as) => {
      if (has(sc, exported)) def[$module + '.' + as] = def[as] = sc[exported]
      return true
    }, <Dictionary<T>>Object.create(null))
  }
  const scope: Module = {
    $schema, $main: null,
    $module: $module || null, $doc: $doc || null, $author: $author || null,
    $import: $import || {}, $export: $export || {},
    value: makeExports(out.value),
    macro: makeExports(out.macro),
    check: makeExports(out.check),
    doc: makeExports(out.doc),
    test: out.test,
    qualified: _.fromPairs(_.keys($export).map(k => [k, $module + '.' + k])),
  }
  if ($main != null) {
    scope.$main = deferExpandEval(env, scope, $main, '$main', $module)
  }
  return scope
}
