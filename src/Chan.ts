import {Jaspr, JasprObject, JasprError, magicSymbol, isObject} from './Jaspr'
import * as Names from './ReservedNames'
import {remove} from 'lodash'

class Chan {
  sendQueue: [Jaspr, (sent: boolean) => void][] = []
  recvQueue: Array<(val: {value: Jaspr, done: boolean}) => void> = []
  magicObject: JasprObject
  closed = false

  constructor(magicObject: JasprObject) {
    this.magicObject = magicObject
  }

  send(msg: Jaspr, cb: (sent: boolean) => void): (() => void) | null {
    if (this.closed) { cb(false); return null }
    if (this.recvQueue.length > 0) {
      (<any>this.recvQueue.shift())({value: msg, done: false})
      cb(true)
      return null
    } else {
      const entry: [Jaspr, (sent: boolean) => void] = [msg, cb]
      this.sendQueue.push(entry)
      return () => {remove(this.sendQueue, x => x === entry)}
    }
  }

  recv(cb: (val: {value: Jaspr, done: boolean}) => void): (() => void) | null {
    if (this.closed) {
      cb({value: null, done: true})
      return null
    }
    if (this.sendQueue.length > 0) {
      const [msg, sendCb] = <any>this.sendQueue.shift()
      cb({value: msg, done: false})
      sendCb(true)
      return null
    } else {
      this.recvQueue.push(cb)
      return () => {remove(this.recvQueue, x => x === cb)}
    }
  }

  close(): boolean {
    if (this.closed) return false
    this.closed = true
    for (let [_, cb] of this.sendQueue) cb(false)
    for (let cb of this.recvQueue) cb({value: null, done: true})
    this.sendQueue = []
    this.recvQueue = []
    return true
  }
}

namespace Chan {
  export function make(): JasprObject {
    const obj: JasprObject = {[Names.chan]: true}
    obj[magicSymbol] = <any>new Chan(obj)
    return obj
  }

  export function isChan(it: Jaspr) {
    return isObject(it) && magicSymbol in it && it[magicSymbol] instanceof Chan
  }
}

export default Chan
