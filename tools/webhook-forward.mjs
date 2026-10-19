#!/usr/bin/env node
/**
 * Forward OrchestAPI webhook traffic to a local process (smee-style).
 *
 * Usage:
 *   node tools/webhook-forward.mjs \
 *     --source https://your-host/api/webhooks/<id>/requests/stream \
 *     --target http://localhost:3000
 *
 * Or derive the SSE URL from the public webhook URL:
 *   node tools/webhook-forward.mjs \
 *     --url https://your-host/webhook/<id> \
 *     --target http://localhost:3000/hooks
 *
 * Requires Node.js 18+.
 */

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

function usage(exitCode = 0) {
  console.log(`Forward OrchestAPI webhook requests to a local URL via SSE.

Usage:
  node tools/webhook-forward.mjs --source <sse-url> --target <local-url>
  node tools/webhook-forward.mjs --url <webhook-url> --target <local-url>

Options:
  --source, -s   SSE stream URL (.../api/webhooks/<id>/requests/stream)
  --url, -u      Public webhook URL (.../webhook/<id>) — derives --source
  --target, -t   Local base URL to forward to (path/query from the event are appended)
  --help, -h     Show this help

Notes:
  - Caller still receives the response configured in OrchestAPI (not your local app).
  - Multipart uploads are best-effort (files only; other form fields may be missing).
  - Binary bodies stored as base64 are decoded before forwarding.
`)
  process.exit(exitCode)
}

function parseArgs(argv) {
  const args = { source: null, url: null, target: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v == null) throw new Error(`Missing value after ${a}`)
      return v
    }
    switch (a) {
      case '--source':
      case '-s':
        args.source = next()
        break
      case '--url':
      case '-u':
        args.url = next()
        break
      case '--target':
      case '-t':
        args.target = next()
        break
      case '--help':
      case '-h':
        usage(0)
        break
      default:
        throw new Error(`Unknown argument: ${a}`)
    }
  }
  return args
}

function deriveSourceFromWebhookUrl(webhookUrl) {
  let parsed
  try {
    parsed = new URL(webhookUrl)
  } catch {
    throw new Error(`Invalid --url: ${webhookUrl}`)
  }
  const match = parsed.pathname.match(/^(.*)\/webhook\/([^/]+)\/?$/)
  if (!match) {
    throw new Error(
      `--url must look like https://host[/context]/webhook/<id>, got: ${webhookUrl}`,
    )
  }
  const basePath = match[1] || ''
  const id = match[2]
  return `${parsed.origin}${basePath}/api/webhooks/${id}/requests/stream`
}

function isBinaryContentType(contentType) {
  if (!contentType) return false
  const ct = contentType.toLowerCase()
  return (
    ct.startsWith('image/') ||
    ct.startsWith('audio/') ||
    ct.startsWith('video/') ||
    ct === 'application/octet-stream' ||
    ct === 'application/pdf' ||
    ct.startsWith('application/pdf;')
  )
}

function parseJsonObject(raw, fallback = {}) {
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback
  } catch {
    return fallback
  }
}

function buildTargetUrl(targetBase, requestPath, queryParams) {
  const base = targetBase.replace(/\/$/, '')
  const path =
    !requestPath || requestPath === '/'
      ? ''
      : requestPath.startsWith('/')
        ? requestPath
        : `/${requestPath}`
  const url = new URL(`${base}${path}`)
  for (const [k, v] of Object.entries(queryParams || {})) {
    if (v != null) url.searchParams.set(k, String(v))
  }
  return url
}

function buildHeaders(rawHeaders) {
  const headers = new Headers()
  const obj = parseJsonObject(rawHeaders, {})
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue
    if (HOP_BY_HOP.has(key.toLowerCase())) continue
    try {
      headers.set(key, String(value))
    } catch {
      // skip invalid header names/values
    }
  }
  return headers
}

async function buildBody(log) {
  if (log.multipart) {
    let files = []
    try {
      files = JSON.parse(log.files || '[]')
    } catch {
      files = []
    }
    if (!Array.isArray(files) || files.length === 0) {
      return { body: undefined, headers: undefined, note: 'multipart with no files' }
    }
    const form = new FormData()
    for (const file of files) {
      const bytes = Buffer.from(file.contentBase64 || '', 'base64')
      const blob = new Blob([bytes], { type: file.contentType || 'application/octet-stream' })
      form.append('file', blob, file.filename || 'upload.bin')
    }
    return { body: form, headers: undefined, note: `multipart ${files.length} file(s)` }
  }

  if (log.requestBody == null || log.requestBody === '') {
    return { body: undefined, headers: undefined, note: 'empty body' }
  }

  if (isBinaryContentType(log.contentType)) {
    return {
      body: Buffer.from(log.requestBody, 'base64'),
      headers: undefined,
      note: 'binary (base64 decoded)',
    }
  }

  return { body: log.requestBody, headers: undefined, note: 'text' }
}

async function forward(log, targetBase) {
  const queryParams = parseJsonObject(log.queryParams, {})
  const url = buildTargetUrl(targetBase, log.requestPath, queryParams)
  const headers = buildHeaders(log.requestHeaders)
  const { body, note } = await buildBody(log)

  // Let FormData set its own Content-Type boundary
  if (body instanceof FormData) {
    headers.delete('content-type')
  }

  const method = (log.httpMethod || 'POST').toUpperCase()
  const init = { method, headers }
  if (body != null && method !== 'GET' && method !== 'HEAD') {
    init.body = body
  }

  const started = Date.now()
  try {
    const res = await fetch(url, init)
    const ms = Date.now() - started
    console.log(
      `→ ${method} ${url.pathname}${url.search}  ${res.status}  ${ms}ms  (${note})`,
    )
  } catch (err) {
    const ms = Date.now() - started
    console.error(
      `→ ${method} ${url.pathname}${url.search}  FAILED  ${ms}ms  ${err.message}`,
    )
  }
}

async function* readSse(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = 'message'
  let dataLines = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)

      if (line === '') {
        if (dataLines.length > 0) {
          yield { event: eventName, data: dataLines.join('\n') }
        }
        eventName = 'message'
        dataLines = []
        continue
      }
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let val = colon === -1 ? '' : line.slice(colon + 1)
      if (val.startsWith(' ')) val = val.slice(1)

      if (field === 'event') eventName = val
      else if (field === 'data') dataLines.push(val)
    }
  }
}

async function connectLoop(sourceUrl, targetBase) {
  let attempt = 0
  while (true) {
    attempt++
    console.log(`Connecting to ${sourceUrl} (attempt ${attempt})…`)
    try {
      const res = await fetch(sourceUrl, {
        headers: { Accept: 'text/event-stream' },
      })
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
      }
      console.log(`Connected. Forwarding to ${targetBase}`)
      attempt = 0

      for await (const evt of readSse(res.body)) {
        if (evt.event === 'connected') {
          console.log('SSE ready')
          continue
        }
        if (evt.event !== 'request') continue
        let log
        try {
          log = JSON.parse(evt.data)
        } catch {
          console.warn('Skipping unparseable SSE payload')
          continue
        }
        await forward(log, targetBase)
      }
      console.warn('SSE stream ended, reconnecting…')
    } catch (err) {
      console.error(`Connection error: ${err.message}`)
    }
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
    console.log(`Retry in ${Math.round(delay / 1000)}s…`)
    await new Promise((r) => setTimeout(r, delay))
  }
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    usage(1)
  }

  if (!args.target) {
    console.error('Missing --target')
    usage(1)
  }
  let source = args.source
  if (!source && args.url) {
    try {
      source = deriveSourceFromWebhookUrl(args.url)
    } catch (err) {
      console.error(err.message)
      process.exit(1)
    }
  }
  if (!source) {
    console.error('Provide --source or --url')
    usage(1)
  }

  try {
    new URL(source)
    new URL(args.target)
  } catch {
    console.error('Invalid URL for --source/--url/--target')
    process.exit(1)
  }

  process.on('SIGINT', () => {
    console.log('\nStopped.')
    process.exit(0)
  })

  await connectLoop(source, args.target)
}

main()
