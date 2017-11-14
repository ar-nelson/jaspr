import {Jaspr, Deferred, isArray, isObject, isClosure, isMagic} from './Jaspr'
import {reservedChar} from './Parser'
import chalk from 'chalk'
import {join, sum, identity} from 'lodash'

const defaultIndent = 2
const maxLength = 80
const maxEntries = 36
const maxDepth = 36

function spaces(n: number) {
  let s = ''
  for (let i = 0; i < n; i++) s += ' '
  return s
}

const escapes: {[e: string]: string} = {
  '\n': '\\n',
  '\r': '\\r',
  '\f': '\\f',
  '\v': '\\v',
  '“': '\\“',
  '”': '\\”',
  '\\': '\\\\'
}

function quoteString(
  str: string,
  truncateAt = Infinity,
  quoteColor: (s: string) => string = identity,
  escapeColor: (s: string) => string = identity,
  ellipsisColor: (s: string) => string = identity
): string {
  let out = quoteColor('“'), len = 1
  for (let c of str) {
    if (escapes.hasOwnProperty(c)) {
      len++
      c = escapeColor(escapes[c])
    }
    if (len >= truncateAt) {
      out += ellipsisColor('…')
      break
    }
    out += c
    len++
  }
  return out + quoteColor('”')
}

abstract class Form {
  abstract length(): number
  abstract toStringInline(compress?: boolean): string
  abstract toStringBlock(offset?: number, hanging?: number): string
  toString(offset = 0, hanging?: number) {
    if (this.length() < maxLength - offset) {
      return this.toStringInline()
    } else {
      return this.toStringBlock(offset, hanging)
    }
  }
}

class ArrayForm extends Form {
  elements: Form[]

  constructor(elements: Form[]) {
    super()
    this.elements = elements
  }

  length() {
    return 2 + sum(this.elements.map(x => x.length())) +
           (this.elements.length > 0 ? this.elements.length - 1 : 0)
  }

  toStringInline() {
    return chalk.cyan('[') +
           join(this.elements.map(x => x.toStringInline()), ' ') +
           chalk.cyan(']')
  }

  toStringBlock(offset = 0, hanging = offset) {
    return chalk.cyan('[') + '\n' +
      join(this.elements.map(x =>
          spaces(hanging + defaultIndent) +
          x.toString(hanging + defaultIndent)),
        chalk.cyan(',') + '\n') +
      '\n' + spaces(hanging) + chalk.cyan(']')
  }
}

class ObjectForm extends Form {
  entries: {
    key: string,
    unquoted: boolean,
    len: number,
    form: Form
  }[]

  constructor(entries: [string, Form][]) {
    super()
    this.entries = entries.map(([key, form]) => {
      if (key === '' || reservedChar.test(key)) {
        return {key, unquoted: false, len: quoteString(key).length, form}
      } else {
        return {key, unquoted: true, len: key.length, form}
      }
    })
  }

  length() {
    return 2 + sum(this.entries.map(({len, form}) => len + 1 + form.length())) +
        (this.entries.length > 0 ? this.entries.length - 1 : 0)
  }

  toStringInline() {
    return chalk.green('{') +
      join(this.entries.map(({key, unquoted, form: value}) => {
        if (unquoted) {
          return key + chalk.green(':') + value.toStringInline()
        } else {
          return quoteString(key, undefined, 
              chalk.green, chalk.green, chalk.gray) +
            chalk.green(':') + value.toStringInline()
        }
      }), ' ') + chalk.green('}')
  }

  toStringBlock(offset = 0, hanging = offset) {
    return chalk.green('{') + '\n' +
      join(this.entries.map(({key, len, unquoted, form: value}) => {
        const keyStr = spaces(hanging + defaultIndent) + (unquoted
          ? key + chalk.green(':') + ' '
          : quoteString(key, undefined, chalk.green, chalk.green, chalk.gray) +
              chalk.green(':') + ' ')
        if (hanging + defaultIndent + len + 2 + value.length() < maxLength) {
          return keyStr + value.toStringInline()
        } else {
          return keyStr + value.toString(
            hanging + defaultIndent + len + 2,
            hanging + defaultIndent)
        }
      }), chalk.green(',') + '\n') +
      '\n' + spaces(hanging) + chalk.green('}')
  }
}

class StringForm extends Form {
  str: string
  unquoted: boolean
  len: number

  constructor(str: string) {
    super()
    this.str = str
    if (str === '' || reservedChar.test(str)) {
      this.unquoted = false
      this.len = quoteString(str).length
    } else {
      this.unquoted = true
      this.len = str.length
    }
  }

  length() { return this.len }

  toStringInline() {
    if (this.unquoted) return this.str
    else return quoteString(this.str, undefined,
        chalk.gray, chalk.yellow, chalk.gray)
  }

  toStringBlock(offset = 0, hanging = -1) {
    let out = '', len = maxLength - offset
    if (hanging >= 0 && offset + this.str.length > maxLength) {
      out += '\n' + spaces(hanging)
      len = maxLength - hanging
    }
    if (this.unquoted && this.str.length <= len) return out + this.str
    else return out + quoteString(this.str, len,
        chalk.gray, chalk.yellow, chalk.gray)
  }
}

class ConstantForm extends Form {
  str: string
  color: (s: string) => string

  constructor(str: string, color: (s: string) => string = identity) {
    super()
    this.str = str
    this.color = color
  }
  
  length() { return this.str.length }
  toStringInline() { return this.color(this.str) }
  toStringBlock(offset = 0, hanging = -1) {
    if (hanging >= 0 && offset + this.str.length > maxLength) {
      return '\n' + spaces(hanging) + this.color(this.str)
    }
    return this.color(this.str)
  }
}

function buildForms(it: Jaspr | Deferred, depth = 0): Form {
  if (depth >= maxDepth) return new ConstantForm('... (too deep)', chalk.gray)
  if (it === null) return new ConstantForm('null', chalk.magentaBright)
  if (it === true) return new ConstantForm('true', chalk.greenBright)
  if (it === false) return new ConstantForm('false', chalk.redBright)
  if (typeof it === 'number') return new ConstantForm('' + it, chalk.cyanBright)
  if (typeof it === 'string') return new StringForm(it)
  if (it instanceof Deferred) {
    if (it.value !== undefined) return buildForms(it.value, depth)
    else return new ConstantForm(it.toString(), chalk.yellow)
  }
  if (isArray(it)) return new ArrayForm(it.map(e => buildForms(e, depth + 1)))
  if (isClosure(it) && isMagic(it)) {
    return new ConstantForm('(closure)', chalk.yellowBright)
  }
  if (isObject(it)) {
    return new ObjectForm(
      Object.keys(it).map(k => <any>[k, buildForms(it[k], depth + 2)]))
  }
  return new ConstantForm('' + it, chalk.yellow)
}

export default function prettyPrint(it: Jaspr) {
  return buildForms(it).toString()
}
