/*
 * --- Jaspr Prototype REPL ---
 * Adam R. Nelson <adam@nels.onl>
 */

const Promise = require('bluebird')
const interpreter = require('./interpreter')
const parse = require('./parse')
const fs = Promise.promisifyAll(require('fs'))

const readline = require("readline")
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function repl(scopes) {
  rl.question("Jaspr> ", line =>
    line == "exit" ? rl.close() :
      Promise.resolve(line)
        .then(x => interpreter.macroExpand(scopes.macroscope, parse(x)))
        .then(x => interpreter.jasprEval(scopes, x))
        .then(interpreter.printValue(":= "), interpreter.printValue("!! "))
        .then(() => setTimeout(() => repl(scopes, 0))))
}

//repl({})
fs.readFileAsync("lib/prelude.jaspr", "utf8")
  .then(j => interpreter.evalModule(parse(j)))
  .then(repl)
