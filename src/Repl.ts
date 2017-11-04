import chalk from 'chalk'
import * as readline from 'readline'

import {Jaspr, Json, Scope, Callback, emptyScope, resolveFully, toString} from './Jaspr'
import {Env, Action, macroExpand, evalExpr} from './Interpreter'
import {readModuleFile, evalModule, ModuleSource} from './Module'
import Fiber from './Fiber'
import Parser from './Parser'

const banner = `
⎧                          ⎫
⎪  { Jaspr: (JSON Lisp) }  ⎪
⎨                          ⎬
⎪    Version 0.1.171103    ⎪
⎩      Adam R. Nelson      ⎭

Use CTRL-C to exit.
`

enum State {Input, Waiting, Timeout, Recover}
let state = State.Input
let counter = 1
let lastFiber: Fiber | null = null
let timeout: any = null
let errorCallback: Callback | null = null

const promptPrefix = chalk.gray('Jaspr')
function promptNumber() {
  return chalk.cyan('№' + counter)
}

const inputPrompt = chalk.whiteBright('☞')
const continuePrompt = chalk.gray('…')
const waitPrompt = chalk.gray('⏱?')

const root = Fiber.newRoot(handleError)
let parser = new Parser('REPL input')
let continued = false

const scopePromise = new Promise<Scope>(resolve => {
  readModuleFile('./jaspr/jaspr.jaspr.md', (err, src) => {
    if (err) {
      console.error(chalk.redBright('\n⚠☠ Failed to load standard library.'))
      if (err instanceof Error) console.error(err)
      else console.error(toString(err))
      return process.exit(1)
    }
    const moduleRoot = Fiber.newRoot((env, err, cb) => {
      console.error(chalk.redBright('\n⚠☠ Error occurred in standard library.'))
      console.error(toString(err))
      return process.exit(1)
    })
    resolveFully(
      evalModule(moduleRoot, <ModuleSource>src, emptyScope),
      (err, m) => resolve(<Scope>m))
  })
})

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function prompt() {
  rl.setPrompt(
    promptPrefix + ' ' +
    (state === State.Recover ? chalk.redBright('⚠') : promptNumber()) + ' ' +
    (state === State.Timeout ? waitPrompt :
     continued ? continuePrompt : inputPrompt) + ' ')
  rl.prompt()
}

function setState(st: State) {
  parser = new Parser('REPL input')
  continued = false
  state = st
}

function handleError(env: Env, err: Jaspr, cb: Callback) {
  if (timeout != null) clearTimeout(timeout)
  console.log(`\n${chalk.redBright('UNHANDLED EXCEPTION')} in fiber ${promptNumber()}:`)
  console.log(chalk.yellowBright(toString(err, false, true)))
  console.log('\nEnter a replacement expression to recover from the exception.')
  console.log(`Leave blank and press ENTER to cancel fiber ${promptNumber()} and continue.\n`)
  errorCallback = cb
  setState(State.Recover)
  prompt()
}

function fullEval(code: Json, cb: Callback) {
  const fiber = root.defer({
    action: Action.MacroExpand, code,
    fn: (env, cb) => scopePromise.then(s => macroExpand(env, s, code, cb))
  })
  lastFiber = fiber  
  fiber.await(code => {
    const fiber = root.defer({
      action: Action.Eval, code,
      fn: (env, cb) => scopePromise.then(s => evalExpr(env, s, code, cb))
    })
    lastFiber = fiber
    fiber.await(cb)
  })
}

function startTimer() {
  timeout = setTimeout(() => {
    setState(State.Timeout)
    console.log(`\nStill waiting on fiber ${promptNumber()}…`)
    console.log(`Press ENTER again to cancel it, or type 'bg' to background it.`)
    timeout = null
    prompt()
  }, 10000)
}

rl.on('line', line => {
  try {
    switch (state) {
    case State.Input:
      if (line.trim() == '') {
        prompt()
        return
      }
      parser.read(line)
      if (parser.isDone()) {
        const code = parser.getOneResult()
        setState(State.Waiting)
        startTimer()
        const number = counter
        fullEval(code, result => resolveFully(result, (err, result) => {
          if (timeout != null) clearTimeout(timeout)
          console.log(chalk.green(`№${number} ⇒`) + ' ' + toString(result, false, true))
          lastFiber = null
          counter++
          setState(State.Input)
          prompt()
        }))
      } else {
        continued = true
        prompt()
      }
      break
    case State.Waiting:
      console.log(`Still waiting on fiber ${promptNumber()}…`)
      console.log(`Press ENTER again to cancel it, or type 'bg' to background it.`)
      if (timeout != null) clearTimeout(timeout)
      setState(State.Timeout)
      prompt()
      break
    case State.Timeout:
      switch (line.trim()) {
        case '':
          console.log(`Canceling fiber ${promptNumber()}!`)
          if (lastFiber != null) lastFiber.cancel()
          // fallthrough
        case 'bg':
          lastFiber = null
          counter++
          setState(State.Input)
          break
        default:
          console.log(`Unrecognized command: ${line.trim()}`)
          console.log(`Still waiting on fiber ${promptNumber()}…`)
          console.log(`Press ENTER again to cancel it, or type 'bg' to background it.`)
      }
      prompt()
      break
    case State.Recover:
      if (!continued && line.trim() === '') {
        console.log(`Canceling fiber ${promptNumber()}!`)
        if (lastFiber != null) lastFiber.cancel()
        lastFiber = null
        counter++
        setState(State.Input)
        prompt()
      } else {
        parser.read(line)
        if (parser.isDone()) {
          const code = parser.getOneResult()
          setState(State.Waiting)
          startTimer()
          fullEval(code, result => {
            if (errorCallback != null) errorCallback(result)
          })
        } else {
          continued = true
          prompt()
        }
      }
      break
    }
  } catch (ex) {
    console.error(ex)
    setState(state)
    prompt()
  }
}).on('close', () => {
  console.log('')
  console.log('Bye!')
  process.exit(0)
})



console.log(banner)
prompt()
