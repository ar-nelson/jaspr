import {Jaspr, Deferred, isArray, isObject, isMagic} from './Jaspr'
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
  abstract toStringInline(color?: boolean): string
  abstract toStringBlock(color?: boolean, offset?: number, hanging?: number): string
  toString(color = true, offset = 0, hanging?: number) {
    if (this.length() < maxLength - offset) {
      return this.toStringInline(color)
    } else {
      return this.toStringBlock(color, offset, hanging)
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

  toStringInline(color = true) {
    return (color ? chalk.cyan('[') : '[') +
           join(this.elements.map(x => x.toStringInline(color)), ' ') +
           (color ? chalk.cyan(']') : ']')
  }

  toStringBlock(color = true, offset = 0, hanging = offset) {
    const token: (x: string) => string = color ? chalk.cyan : identity
    return token('[') + '\n' +
      join(this.elements.map(x =>
          spaces(hanging + defaultIndent) +
          x.toString(color, hanging + defaultIndent)),
        token(',') + '\n') +
      '\n' + spaces(hanging) + token(']')
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

  toStringInline(color = true) {
    const token: (x: string) => string = color ? chalk.green : identity
    return token('{') +
      join(this.entries.map(({key, unquoted, form: value}) => {
        if (unquoted) {
          return key + token(':') + value.toStringInline(color)
        } else {
          return quoteString(key, undefined, 
              token, token, color ? chalk.gray : identity) +
            token(':') + value.toStringInline(color)
        }
      }), ' ') + token('}')
  }

  toStringBlock(color = true, offset = 0, hanging = offset) {
    const token: (x: string) => string = color ? chalk.green : identity
    return token('{') + '\n' +
      join(this.entries.map(({key, len, unquoted, form: value}) => {
        const keyStr = spaces(hanging + defaultIndent) +
          (unquoted ? key : quoteString(key, undefined,
            token, token, color ? chalk.gray : identity)) +
          token(':') + ' '
        if (hanging + defaultIndent + len + 2 + value.length() < maxLength) {
          return keyStr + value.toStringInline(color)
        } else {
          return keyStr + value.toString(color,
            hanging + defaultIndent + len + 2,
            hanging + defaultIndent)
        }
      }), token(',') + '\n') +
      '\n' + spaces(hanging) + token('}')
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

  toStringInline(color = true) {
    if (this.unquoted) return this.str
    else return quoteString(this.str, undefined,
        color ? chalk.gray : identity,
        color ? chalk.yellow : identity,
        color ? chalk.gray : identity)
  }

  toStringBlock(color = true, offset = 0, hanging = -1) {
    let out = '', len = maxLength - offset
    if (hanging >= 0 && offset + this.str.length > maxLength) {
      out += '\n' + spaces(hanging)
      len = maxLength - hanging
    }
    if (this.unquoted && this.str.length <= len) return out + this.str
    else return out + quoteString(this.str, len,
        color ? chalk.gray : identity,
        color ? chalk.yellow : identity,
        color ? chalk.gray : identity)
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
  toStringInline(color = true) { return color ? this.color(this.str) : this.str }
  toStringBlock(color = true, offset = 0, hanging = -1) {
    if (hanging >= 0 && offset + this.str.length > maxLength) {
      return '\n' + spaces(hanging) + (color ? this.color(this.str) : this.str)
    }
    return color ? this.color(this.str) : this.str
  }
}

function buildForms(it: Jaspr | Deferred, depth = 0): Form {
  if (depth >= maxDepth) {
    return new ConstantForm('... (too deep)', chalk.gray)
  } else if (it === null) {
    return new ConstantForm('null', chalk.magentaBright)
  } else if (it === true) {
    return new ConstantForm('true', chalk.greenBright)
  } else if (it === false) {
    return new ConstantForm('false', chalk.redBright)
  } else if (typeof it === 'number') {
    return new ConstantForm('' + it, chalk.cyanBright)
  } else if (typeof it === 'string') {
    return new StringForm(it)
  } else if (it instanceof Deferred) {
    if (it.value !== undefined) {
      return buildForms(it.value, depth)
    } else {
      return new ConstantForm(it.toString(), chalk.yellow)
    }
  } else if (isArray(it)) {
    return new ArrayForm(it.map(e => buildForms(e, depth + 1)))
  } else if (isMagic(it)) {
    return new ConstantForm('(magic)', chalk.yellowBright)
  } else if (isObject(it)) {
    return new ObjectForm(
      Object.keys(it).map(k => <any>[k, buildForms(it[k], depth + 2)]))
  } else {
    return new ConstantForm('' + it, chalk.yellow)
  }
}

export default function prettyPrint(it: Jaspr, color = true) {
  return buildForms(it).toString(color)
}
