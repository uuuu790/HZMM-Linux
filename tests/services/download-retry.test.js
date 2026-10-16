// downloadFile retry/resume behavior over the mocked Electron net module.
// The real archive.test.js covers the allowlist fast-reject paths (which run
// before net is touched); this file covers what happens once bytes flow.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import os from 'os'
import fs from 'fs'
import path from 'path'

const { netMock } = vi.hoisted(() => ({ netMock: { request: null } }))
vi.mock('electron', () => ({ net: { request: (...args) => netMock.request(...args) } }))

const { downloadFile } = await import('../../src/main/services/archive')

function makeRequest(onEnd) {
  const req = new EventEmitter()
  req.headers = {}
  req.setHeader = (name, value) => { req.headers[name.toLowerCase()] = value }
  req.followRedirect = vi.fn()
  req.abort = vi.fn()
  req.end = () => { setImmediate(() => onEnd(req)) }
  return req
}

// A response readable that pushes `chunks`, then either ends cleanly or
// destroys itself with an error (simulating a mid-stream connection reset).
// The delay before the failure gives pipeline() time to flush the chunks to
// disk so the next attempt has a partial file to resume.
function makeResponse({ statusCode, headers = {}, chunks = [], failMidStream = false }) {
  const res = new Readable({ read() {} })
  res.statusCode = statusCode
  res.headers = headers
  setImmediate(() => {
    for (const c of chunks) res.push(c)
    if (failMidStream) setTimeout(() => res.destroy(new Error('connection reset')), 50)
    else res.push(null)
  })
  return res
}

const URL_OK = 'https://github.com/UE4SS-RE/RE-UE4SS/releases/download/x/UE4SS.zip'
const HOSTS = ['github.com']

let destPath

beforeEach(() => {
  destPath = path.join(os.tmpdir(), `hzmm-dl-test-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
})

afterEach(() => {
  try { fs.rmSync(destPath, { force: true }) } catch { /* best-effort */ }
})

describe('downloadFile over electron net', () => {
  it('downloads in one attempt on a clean 200', async () => {
    const calls = []
    netMock.request = () => {
      const req = makeRequest((r) => {
        r.emit('response', makeResponse({
          statusCode: 200,
          headers: { 'content-length': '5' },
          chunks: [Buffer.from('hello')],
        }))
      })
      calls.push(req)
      return req
    }

    await expect(downloadFile(URL_OK, destPath, null, HOSTS)).resolves.toBe(destPath)
    expect(calls).toHaveLength(1)
    expect(fs.readFileSync(destPath, 'utf8')).toBe('hello')
  })

  it('retries a mid-stream reset and resumes with a Range request', async () => {
    const calls = []
    const progress = []
    netMock.request = () => {
      const attempt = calls.length + 1
      const req = makeRequest((r) => {
        if (attempt === 1) {
          r.emit('response', makeResponse({
            statusCode: 200,
            headers: { 'content-length': '10' },
            chunks: [Buffer.from('hello')],
            failMidStream: true,
          }))
        } else {
          r.emit('response', makeResponse({
            statusCode: 206,
            headers: { 'content-range': 'bytes 5-9/10' },
            chunks: [Buffer.from('world')],
          }))
        }
      })
      calls.push(req)
      return req
    }

    await expect(downloadFile(URL_OK, destPath, p => progress.push(p), HOSTS)).resolves.toBe(destPath)
    expect(calls).toHaveLength(2)
    // Second attempt resumed from the 5 bytes the first attempt flushed.
    expect(calls[1].headers.range).toBe('bytes=5-')
    expect(fs.readFileSync(destPath, 'utf8')).toBe('helloworld')
    expect(progress.at(-1)).toBe(100)
  }, 15000)

  it('does NOT retry a 404 and removes the temp file', async () => {
    const calls = []
    netMock.request = () => {
      const req = makeRequest((r) => {
        r.emit('response', makeResponse({ statusCode: 404 }))
      })
      calls.push(req)
      return req
    }

    await expect(downloadFile(URL_OK, destPath, null, HOSTS)).rejects.toThrow(/HTTP 404/)
    expect(calls).toHaveLength(1)
    expect(fs.existsSync(destPath)).toBe(false)
  })

  it('blocks a redirect hop to a host outside the allowlist', async () => {
    netMock.request = () => makeRequest((r) => {
      r.emit('redirect', 302, 'GET', 'https://evil.example.com/x.zip', {})
    })

    await expect(downloadFile(URL_OK, destPath, null, HOSTS)).rejects.toThrow(/not in the allowed list/)
  })

  it('follows an allowed redirect hop', async () => {
    let redirected = false
    netMock.request = () => {
      const req = makeRequest((r) => {
        r.emit('redirect', 302, 'GET', 'https://objects.githubusercontent.com/a/b.zip', {})
      })
      req.followRedirect = vi.fn(() => {
        redirected = true
        req.emit('response', makeResponse({
          statusCode: 200,
          headers: { 'content-length': '2' },
          chunks: [Buffer.from('ok')],
        }))
      })
      return req
    }

    await expect(
      downloadFile(URL_OK, destPath, null, ['github.com', '*.githubusercontent.com'])
    ).resolves.toBe(destPath)
    expect(redirected).toBe(true)
    expect(fs.readFileSync(destPath, 'utf8')).toBe('ok')
  })
})
