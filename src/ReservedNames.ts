/** Prefix for all reserved names */
export const prefix = '$'

export const closure = prefix + 'closure'
export const code = prefix + 'code'
export const args = prefix + 'args'
export const chan = prefix + 'chan'
export const dynamic = prefix + 'dynamic'
export const default_ = prefix + 'default'
export const signalHandler = prefix + 'signalHandler'
export const name = prefix + 'name'
export const module = prefix + 'module'
export const syntaxQuote = prefix + 'syntaxQuote'
export const unquote = prefix + 'unquote'
export const unquoteSplicing = prefix + 'unquoteSplicing'

export const if_ = prefix + 'if'
export const then = prefix + 'then'
export const junction = prefix + 'junction'
export const eval_ = prefix + 'eval'
export const macroexpand = prefix + 'macroexpand'
export const contextGet = prefix + 'contextGet'
export const dynamicLet = prefix + 'dynamicLet'
export const unhandledError = prefix + 'panic'

/** Named here because it's the one built-in function (not special form) that
 *  is called directly by Jaspr's macroexpand/eval process: `$syntaxQuote`
 *  can expand to `$arrayConcat` when `$unquoteSplicing` is used. */
export const arrayConcat = prefix + 'arrayConcat'

export const assertEquals = prefix + 'assertEquals'
