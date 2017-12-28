import * as commandLineArgs from 'command-line-args'
import * as _ from 'lodash'
import * as path from 'path'
import chalk from 'chalk'
import {readFile, writeFile} from 'fs'
import {Jaspr, Callback, resolveFully} from './Jaspr'
import {Env, Scope, mergeScopes, expandAndEval, waitFor} from './Interpreter'
import {Root, Branch, ErrorHandler} from './Fiber'
import Parser from './Parser'
import {parseMarkdown, markdownExtensions} from './LiterateParser'
import {Module, ModuleSource, readModuleFile, evalModule, importModule} from './Module'
import primitives from './JasprPrimitive'
import {primitiveModule, stdlibModule, version} from './ReservedNames'
import prettyPrint from './PrettyPrint'
import repl from './Repl'

const optionDefs = [
  {name: 'convert', alias: 'c', type: String},
  {name: 'literate', alias: 'l', type: Boolean},
  {name: 'repl', alias: 'r', type: Boolean},
  {name: 'stdlib', type: String},
  {name: 'help', type: Boolean},
  {name: 'src', type: String, multiple: true, defaultOption: true}
]

const options = commandLineArgs(optionDefs)

if (options.help) usage()
else if (options.convert) {
  if (options.repl || options.stdlib || !_.isEmpty(options.src)) {
    usage()
  } else {
    const inFile = options.convert
    readFile(inFile, (err, data) => {
      if (err != null) {
        console.error(err)
        process.exit(1)
      } else {
        const converted =
          (options.literate || _.some(markdownExtensions, e => inFile.endsWith(e)))
          ? parseMarkdown(data.toString('utf8'), inFile)
          : (() => {
              const p = new Parser(inFile)
              p.read(data.toString('utf8'))
              return p.getOneResult()
            })()
        console.log(JSON.stringify(converted))
      }
    })
  }
} else {
  const isRepl = options.repl || _.isEmpty(options.src)
  const stdlib = options.stdlib || path.resolve(__dirname, '..', '..', 'jaspr', 'jaspr.jaspr.md')
  const scope: Promise<Scope> =
    new Promise<Module[]>(resolve => setImmediate(() =>
      loadModules(root, [stdlib, ...options.src || []], !isRepl, mods =>
        resolve(Promise.all(mods.values())))))
    .then(mods => mergeScopes(root, ...mods.map(m =>
      importModule(m, m.$module, m.$module === primitiveModule ? {} : undefined))))
  var root = new Root(consoleSignalHandler(scope))
  if (isRepl) {
    scope.then(scope => {
      console.log(chalk.greenBright('{ Jaspr: (JSON Lisp) }'))
      console.log(chalk.yellow('Version ' + version))
      console.log(chalk.yellow('Adam R. Nelson <adam@nels.onl>'))
      console.log()
      console.log(chalk.gray('Use CTRL-C to quit'))
      console.log()
      function loop(counter = 1, last?: Jaspr) {
        repl({
          prompt: chalk.green('Jaspr') + ' ' + chalk.cyan('№' + counter) + '>',
          priority: 1,
          message: last
            ? chalk.green(`№${counter - 1} ⇒`) + ' ' + prettyPrint(last)
            : undefined
        }, input => {
          const {fiber, cancel} = root.deferCancelable((env, cb) => {
            env.onCancel(() => {
              console.warn(chalk.yellowBright(`№${counter} canceled`))
              loop(counter + 1)
            })
            waitFor(expandAndEval(env, scope, [], undefined, input), cb)
          })
          fiber.await(output =>
            resolveFully(output, (err, x) => loop(counter + 1, x)))
        })
      }
      loop()
    })
  }
}

function consoleSignalHandler(scope: Promise<Scope>): ErrorHandler {
  let helpDisplayed = false
  return function errorHandler(root, err, raisedIn, cb) {
    const message =
      '\n🚨  ' + chalk.redBright('Unhandled Signal Encountered!') + '\n' +
      prettyPrint(err) + '\n' + (helpDisplayed ? `
        Provide a resume value, or press ENTER to ${
          raisedIn == root ? 'end the program' : 'cancel this fiber'}.
      ` : `
        An unhandled signal has stopped one fiber of the running Jaspr program.
        (Other fibers may still be running!)

        The stopped fiber can be restarted by providing a ${
          chalk.bold('resume value')} at the
        prompt below. Or, you can press ENTER to ${
          raisedIn == root ? 'end the program' : 'cancel this fiber'}.
      `).replace(/^[ ]+/gm, '')
    helpDisplayed = true
    repl({prompt: chalk.red('!>'), message, priority: 0, onBlank: () => {
      if (root === raisedIn) {
        console.error('Ending program due to unhandled signal.')
        process.exit(1)
      } else {
        console.error('Canceling fiber.')
        raisedIn.cancel()
      }
    }}, resumeValue => scope.then(scope =>
          waitFor(expandAndEval(root, scope, [], undefined, resumeValue), cb)))
  }
}

function loadModules(
  env: Env, filenames: string[], runMain: boolean,
  cb: (mods: Map<string, Promise<Module>>) => void
): void {
  (function loadNext(localModules: Map<string, Promise<Module>>): void {
    const filename = filenames.shift()
    if (filename === undefined) return cb(localModules)
    readModuleFile(filename, (err, modsrc) => {
      if (err != null || modsrc == null) {
        console.error(chalk.redBright(`⚠☠ Failed to load module: ${filename}`))
        console.error(prettyPrint(err))
        return process.exit(1)
      }
      (<Promise<Module>>localModules.get(primitiveModule)).then(prim => {
        const imported = importModule(prim, primitiveModule, {})
        const stdlib = localModules.get(stdlibModule)
        if (stdlib) return stdlib.then(stdlib =>
          mergeScopes(env, imported, importModule(stdlib)))
        else return imported
      }).then(scope => {
        const promise = evalModule(env, modsrc, {
          filename, localModules, runMain, scope
        })
        if (modsrc.$module != null) localModules.set(modsrc.$module, promise)
        loadNext(localModules)
      })
    })
  })(new Map([[primitiveModule, Promise.resolve(primitives(env))]]))
}

function usage() {
  console.log(require('command-line-usage')([{
    header: `Jaspr ${version}`,
    content: `
      JavaScript reference implementation of an interpreter for the Jaspr
      programming language. Use this command to run Jaspr scripts, start a Jaspr
      REPL, or convert Jaspr source code into JSON.
    `.trim().replace(/\s+/gm, ' ')
  }, {
    header: 'Examples',
    content: `
[bold]{    jaspr}

Starts a REPL

[bold]{    jaspr foo.jaspr bar.jaspr}

Executes foo.jaspr and bar.jaspr

[bold]{    jaspr --convert foo.jaspr > foo.json}

Converts the Jaspr file foo.jaspr to the JSON file foo.json
    `.trim()
  }, {
    header: 'Options',
    optionList: [{
      name: 'help',
      description: 'Display this usage guide'
    }, {
      name: 'src',
      typeLabel: '[underline]{file} ...',
      description: 'Jaspr source files to load'
    }, {
      name: 'convert',
      typeLabel: '[underline]{file}',
      description: 'Jaspr file to convert to JSON (JSON is written to stdout)'
    }, {
      name: 'repl',
      description: 'Start a REPL even if source files are loaded'
    }, {
      name: 'literate',
      description: `
        Treat all source files as Literate Jaspr (Jaspr embedded in Markdown),
        regardless of extension
      `.trim().replace(/\s+/gm, ' ')
    }]
  }, {
    header: 'Author',
    content: `
Adam R. Nelson <adam@nels.onl>
GitHub: https://github.com/ar-nelson/jaspr
    `.trim()
  }]))
}
