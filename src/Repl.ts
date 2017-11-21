import chalk from 'chalk'
import * as readline from 'readline'
import {waterfall} from 'async'

import {Jaspr, JasprError, Json, Callback, resolveFully} from './Jaspr'
import {Scope, emptyScope, Env, Action, macroExpand, evalExpr, deferExpandEval} from './Interpreter'
import {readModuleFile, evalModule, importModule, ModuleSource, Module} from './Module'
import Fiber from './Fiber'
import Parser from './Parser'
import prettyPrint from './PrettyPrint'
import prim from './JasprPrimitive'
import {version, primitiveModule} from './ReservedNames'

const banner = `
⎧                          ⎫
⎪  { Jaspr: (JSON Lisp) }  ⎪
⎨                          ⎬
⎪    Version ${version}    ⎪
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
let ready = false

const filename = 'jaspr/jaspr.jaspr.md'
const scopePromise = new Promise<Scope>(resolve => {
  waterfall<Module, JasprError>([
    (cb: any) => readModuleFile(filename, cb),
    (mod: ModuleSource, cb: any) => evalModule(root, mod, {
      filename, localModules: new Map([[primitiveModule, prim(root)]])
    }, cb),
    (mod: Module, cb: any) => resolveFully(importModule(mod), cb)
  ], (err, mod) => {
    if (err) {
      console.error(chalk.redBright('\n⚠☠ Failed to load standard library.'))
      if (err instanceof Error) console.error(err)
      else console.error(prettyPrint(err))
      return process.exit(1)
    }
    ready = true
    resolve(mod)
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

function handleError(env: Env, err: Jaspr, raisedBy: Fiber, cb: Callback) {
  if (!ready) {
    console.error(chalk.redBright('\n⚠☠ Error occurred in standard library.'))
    console.error(prettyPrint(err))
    console.error('\nStack trace:')
    console.error(raisedBy.stackTraceString())
    return process.exit(1)
  }
  if (timeout != null) clearTimeout(timeout)
  console.log(`\n${chalk.redBright('UNHANDLED SIGNAL')} raised in fiber ${promptNumber()}:`)
  console.log(prettyPrint(err))
  console.log('\nStack trace:')
  console.log(raisedBy.stackTraceString())
  console.log('\nEnter a replacement expression to resume from where the signal was raised.')
  console.log(`Leave blank and press ENTER to cancel fiber ${promptNumber()} and continue.\n`)
  errorCallback = cb
  setState(State.Recover)
  prompt()
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
        deferExpandEval(root, scopePromise, code).await(result =>
          resolveFully(result, (err, result) => {
            if (timeout != null) clearTimeout(timeout)
            console.log(chalk.green(`№${number} ⇒`) + ' ' + prettyPrint(result))
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
          //if (lastFiber != null) lastFiber.cancel()
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
        //if (lastFiber != null) lastFiber.cancel()
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
          deferExpandEval(root, scopePromise, code).await(result => {
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
