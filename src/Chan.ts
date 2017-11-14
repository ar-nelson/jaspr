import {Jaspr, JasprObject, JasprError, magicSymbol, isObject} from './Jaspr'
import * as Names from './ReservedNames'

class Chan {
  sendQueue: [Jaspr, (sent: boolean) => void][] = []
  recvQueue: Array<(err?: JasprError, val?: Jaspr) => void> = []
  magicObject: JasprObject
  closed = false

  constructor(magicObject: JasprObject) {
    this.magicObject = magicObject
  }

  send(msg: Jaspr, cb: (sent: boolean) => void): void {
    if (this.closed) return cb(false)
    if (this.recvQueue.length > 0) {
      (<any>this.recvQueue.shift())(undefined, msg)
      cb(true)
    } else {
      this.sendQueue.push([msg, cb])
    }
  }

  recv(cb: (err?: JasprError, val?: Jaspr) => void): void {
    if (this.closed) return cb({
      err: 'ChanClosed', why: 'recv on closed channel',
      chan: this.magicObject
    })
    if (this.sendQueue.length > 0) {
      const [msg, sendCb] = <any>this.sendQueue.shift()
      cb(undefined, msg)
      sendCb(true)
    } else {
      this.recvQueue.push(cb)
    }
  }

  close(): boolean {
    if (this.closed) return false
    this.closed = true
    for (let [_, cb] of this.sendQueue) cb(false)
    for (let cb of this.recvQueue) cb({
      err: 'ChanClosed', why: 'channel already closed',
      chan: this.magicObject
    })
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
