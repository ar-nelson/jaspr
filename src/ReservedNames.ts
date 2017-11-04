/** Prefix for all reserved names */
export const prefix = '$'

export const closure = prefix + 'closure'
export const code = prefix + 'code'
export const args = prefix + 'args'
export const chan = prefix + 'chan'
export const dynamic = prefix + 'dynamic'
export const owner = prefix + 'owner'
export const processId = prefix + 'process-id'
export const error = prefix + 'error'
export const name = prefix + 'name'
export const module = prefix + 'module'
export const syntaxQuote = prefix + 'syntax-quote'
export const unquote = prefix + 'unquote'
export const unquoteSplicing = prefix + 'unquote-splicing'

export const if_ = prefix + 'if'
export const then = prefix + 'then'
export const eval_ = prefix + 'eval'
export const macroexpand = prefix + 'macroexpand'
export const contextGet = prefix + 'context-get'
export const dynamicLet = prefix + 'dynamic-let'
export const throw_ = prefix + 'throw'
export const unhandledError = prefix + 'panic'

/** Named here because it's the one built-in function (not special form) that
 *  is called directly by Jaspr's macroexpand/eval process: `$syntax-quote`
 *  can expand to `$array-concat` when `$unquote-splicing` is used. */
export const arrayConcat = prefix + 'array-concat'

export const assertDeepEquals = prefix + 'assert-deep-equals'
