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

/**
 * Displays a REPL prompt, waits for user input, parses user input, then passes
 * the parsed input to `cb`¹. The prompt is displayed again if parsing fails.
 * 
 * If a REPL prompt is already displayed, and `options.priority` is greater²
 * than the current REPL prompt's priority, this prompt will be added to a
 * queue, and will not display until all other pending prompts have been
 * displayed.
 * 
 * ---
 * 
 * __¹__ Yes, I'm aware that this isn't exactly a REPL because it contains
 * neither the *evaluate* nor the *loop* parts of that acronym… `index.ts`
 * contains the rest of the REPL logic, since this prompt is used for error
 * recovery as well as a REPL.
 * 
 * __²__ Priority is reversed, it goes from high to low… don't ask, it was
 * easier to implement this way. 😬
 * 
 * @param options Options for the REPL prompt:
 *   - `prompt`: Required. The text to display for the prompt.
 *   - `priority`: Required. Lower numbers can replace existing prompts with
 *     higher numbers.
 *   - `message`: Optional. A message to display before the first prompt.
 *   - `onBlank`: Optional. Callback that is called if the user presses ENTER
 *     without typing anything.
 * @param cb Callback that is called with the Jaspr value parsed from user input
 */
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
