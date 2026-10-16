// Thin HTTP client over Electron's net module. net.request rides Chromium's
// network stack, so it honors the OS proxy configuration (system proxy, PAC
// scripts) that Node's https module silently bypasses — users whose only
// route to GitHub/Nexus goes through a system-wide proxy got hangs and
// stalls from the old Node-based clients even though their browser worked.
import { net, type ClientRequest } from 'electron'

// Perform an HTTP(S) request and buffer the response body.
// Resolves { statusCode, headers, bodyText }. Non-2xx statuses RESOLVE too —
// status handling (and each API's error wording) stays with the caller.
//
// options:
//   method / headers / body      — request line + payload (Content-Length is
//                                  handled by Chromium; don't set it)
//   timeoutMs / timeoutMessage   — hard overall deadline. These are small API
//                                  calls, not streams, so a total cap is the
//                                  right shape (vs the per-chunk idle timeout
//                                  downloads use).
//   allowedRedirectHosts         — follow redirects only to these hostnames
//                                  (exact match); omitted/empty = don't
//                                  follow, the 3xx resolves like any other
//                                  status (matches the old Node clients).
//   maxRedirects                 — hop cap when following (default 5)

export interface NetRequestOptions {
  method?: string
  headers?: Record<string, string | null | undefined>
  body?: string | Buffer | null
  timeoutMs?: number
  timeoutMessage?: string
  allowedRedirectHosts?: string[] | null
  maxRedirects?: number
}

export interface NetResponse {
  statusCode: number
  headers: Record<string, string | string[]>
  bodyText: string
}

function netRequest(url: string, {
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 10000,
  timeoutMessage = 'Request timed out',
  allowedRedirectHosts = null,
  maxRedirects = 5,
}: NetRequestOptions = {}): Promise<NetResponse> {
  return new Promise<NetResponse>((resolve, reject) => {
    let request: ClientRequest
    try {
      request = net.request({ url, method, redirect: 'manual' })
    } catch (err) {
      reject(err)
      return
    }

    let settled = false
    const finish = <T>(fn: (value: T) => void, value: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      try { request.abort() } catch { /* already closed */ }
      finish(reject, new Error(timeoutMessage))
    }, timeoutMs)

    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) request.setHeader(name, value)
    }

    let redirectsLeft = maxRedirects
    request.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
      if (settled) return
      const follow = Array.isArray(allowedRedirectHosts) && allowedRedirectHosts.length > 0
      if (!follow) {
        // Caller opted out of redirects: surface the 3xx as a plain response.
        // (In 'manual' mode an unfollowed redirect would otherwise hang until
        // the deadline.)
        try { request.abort() } catch { /* already closed */ }
        finish(resolve, { statusCode, headers: responseHeaders || {}, bodyText: '' })
        return
      }
      if (redirectsLeft-- <= 0) {
        try { request.abort() } catch { /* already closed */ }
        finish(reject, new Error('Too many redirects'))
        return
      }
      let hostname: string | null = null
      try { hostname = new URL(redirectUrl).hostname } catch { /* reject below */ }
      if (!hostname || !allowedRedirectHosts.includes(hostname)) {
        try { request.abort() } catch { /* already closed */ }
        finish(reject, new Error(`Redirect to disallowed host: ${hostname || redirectUrl}`))
        return
      }
      request.followRedirect()
    })

    request.on('error', (err) => finish(reject, err))

    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        finish(resolve, {
          statusCode: response.statusCode,
          headers: response.headers,
          // Concatenate raw chunks THEN decode once — decoding per chunk
          // mangles multi-byte UTF-8 straddling a chunk boundary.
          bodyText: Buffer.concat(chunks).toString('utf8'),
        })
      })
      response.on('error', (err) => finish(reject, err))
    })

    if (body != null) request.write(body)
    request.end()
  })
}

export { netRequest }
