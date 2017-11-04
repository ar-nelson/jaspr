import {Jaspr} from './Jaspr'
import {JasprError} from './Interpreter'

export default class Chan {
  sendQueue: [Jaspr, (sent: boolean) => void][] = []
  recvQueue: Array<(err?: JasprError, val?: Jaspr) => void> = []
  closed = false

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
    if (this.closed) return cb({err: 'channel closed'})
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
    for (let cb of this.recvQueue) cb({err: 'channel closed'})
    this.sendQueue = []
    this.recvQueue = []
    return true
  }
}
