import chalk from 'chalk'
import * as ReadLine from 'readline'
import {Jaspr, Callback} from './Jaspr'
import Parser from './Parser'
const {blank} = require('printable-characters')

let
  promptStacks: {
    prompt: string, message?: string, cb: Callback, onBlank?: () => void
  }[][] = [],
  currentCallback: any = null, currentOnBlank: any = null, currentPrompt = '>',
  currentPriority = 0, parser: Parser | null = null,
  readline: ReadLine.ReadLine | null = null

function nextPrompt(
  {prompt, message, onBlank}:
    {prompt: string, message?: string, onBlank?: () => void},
  priority: number,
  cb: Callback
) {
  parser = new Parser('REPL Input')
  currentPriority = priority
  currentCallback = cb
  currentPrompt = prompt
  currentOnBlank = onBlank || (() => {
    parser = new Parser('REPL Input')
    rl.setPrompt(prompt + ' ')
    rl.prompt()
  })
  const rl = readline || (readline = makeReadline())
  if (message) console.log(message)
  rl.setPrompt(prompt + ' ')
  rl.prompt()
}

function makeReadline(): ReadLine.ReadLine {
  const rl = ReadLine.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  rl.on('line', input => {
    if (!currentCallback) return
    if (input.trim() === '') {
      currentOnBlank()
      for (let i = 0; i < promptStacks.length; i++) {
        if (!promptStacks[i]) continue
        const next = promptStacks[i].pop()
        if (next) return nextPrompt(next, i, next.cb)
      }
      currentCallback = null
      return
    }
    const p = parser || (parser = new Parser('REPL Input'))
    let result: Jaspr | undefined = undefined
    try {
      p.read(input)
      if (p.isDone()) {
        result = p.getOneResult()
      } else {
        rl.setPrompt(chalk.gray('…') + blank(currentPrompt))
        rl.prompt()
      }
    } catch (ex) {
      console.error(ex)
      parser = new Parser('REPL Input')
      rl.setPrompt(currentPrompt + ' ')
      rl.prompt()
    }
    if (result !== undefined) {
      currentCallback(result)
      for (let i = 0; i < promptStacks.length; i++) {
        if (!promptStacks[i]) continue
        const next = promptStacks[i].pop()
        if (next) return nextPrompt(next, i, next.cb)
      }
      currentCallback = null
    }
  }).on('close', () => process.exit(0))
  return rl
}

export default function repl(
  options: {
    prompt: string,
    priority: number,
    message?: string,
    onBlank?: () => void
  },
  cb: Callback
) {
  if (currentCallback && options.priority >= currentPriority) {
    (promptStacks[options.priority] || (promptStacks[options.priority] = []))
      .push(Object.assign(options, {cb}))
  } else {
    if (currentCallback) {
      (promptStacks[currentPriority] || (promptStacks[currentPriority] = []))
        .push({prompt: currentPrompt, onBlank: currentOnBlank, cb: currentCallback})
    }
    nextPrompt(options, options.priority, cb)
  }
}
