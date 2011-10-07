// write data to it, and it'll emit data in 512 byte blocks.
// if you .end() or .flush(), it'll emit whatever it's got,
// padded with nulls to 512 bytes.

module.exports = BlockStream

var Stream = require("stream").Stream
  , inherits = require("inherits")
  , assert = require("assert").ok
  , debug = process.env.DEBUG ? console.error : function () {}

function BlockStream (size) {
  this.writable = this.readable = true
  this._chunkSize = size || 512
  this._offset = 0
  this._buffer = []
  this._bufferLength = 0
  this._zeroes = new Buffer(this._chunkSize)
  for (var i = 0; i < this._chunkSize; i ++) {
    this._zeroes[i] = 0
  }
}

inherits(BlockStream, Stream)

BlockStream.prototype.write = function (c, cb) {
  debug("write", c)
  if (this._ended) throw new Error("BlockStream: write after end")
  if (cb) process.nextTick(cb)
  if (c && !Buffer.isBuffer(c)) c = new Buffer(c + "")
  if (c.length) {
    this._buffer.push(c)
    this._bufferLength += c.length
  }
  debug("pushed onto buffer", this._bufferLength)
  if (this._bufferLength >= this._chunkSize) {
    if (this._paused) {
      this._needDrain = true
      return false
    }
    this._emitChunk()
  }
  return true
}

BlockStream.prototype.pause = function () {
  this.emit("pause")
  this._paused = true
}

BlockStream.prototype.resume = function () {
  this._paused = false
  this.emit("resume")
  return this.write()
}

BlockStream.prototype.end = function (chunk, cb) {
  debug("end", chunk)
  if (typeof chunk === "function") cb = chunk, chunk = null
  if (chunk) this.write(chunk)
  this._ended = true
  this.flush(cb)
}

BlockStream.prototype.flush = function (cb) {
  if (cb) process.nextTick(cb)
  this._emitChunk(true)
}

BlockStream.prototype._emitChunk = function (flush) {
  debug("emitChunk", flush)
  if (this._emitting) return
  this._emitting = true

  // emit a <chunkSize> chunk
  if (flush) {
    // push a chunk of zeroes
    var padBytes = (this._bufferLength % this._chunkSize)
    if (padBytes !== 0) padBytes = this._chunkSize - padBytes
    if (padBytes > 0) {
      debug("padBytes", padBytes, this._zeroes.slice(0, padBytes))
      this._buffer.push(this._zeroes.slice(0, padBytes))
      this._bufferLength += padBytes
      debug(this._buffer[this._buffer.length - 1].length, this._bufferLength)
    }
  }

  while (this._bufferLength >= this._chunkSize) {
    var out = new Buffer(this._chunkSize)
      , outOffset = 0
      , outHas = out.length
    while (outHas > 0) {
      debug("data emit loop")
      var cur = this._buffer[0]
        , curHas = cur.length - this._offset
      debug("cur=", cur)
      debug("curHas=%j", curHas)
      cur.copy(out, outOffset,
               this._offset, this._offset + Math.min(curHas, outHas))
      if (curHas > outHas) {
        // means that the current buffer couldn't be completely output
        // update this._offset to reflect how much WAS written
        this._offset += outHas
        outHas = 0
      } else {
        // output the entire current chunk.
        // toss it away
        outHas -= curHas
        this._buffer.shift()
        this._offset = 0
      }
    }
    this._bufferLength -= this._chunkSize
    assert(out.length === this._chunkSize)
    debug("emitting data", out)
    this.emit("data", out)
  }

  // now either drained or ended
  debug("either draining, or ending")
  debug(this._bufferLength, this._buffer.length, this._ended)
  // means that we've flushed out all that we can so far.
  if (this._needDrain) {
    debug("emitting drain")
    this._needDrain = false
    this.emit("drain")
  }

  if ((this._bufferLength === 0) && this._ended) {
    debug("emitting end")
    this.emit("end")
  }

  this._emitting = false
}
