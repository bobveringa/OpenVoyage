// @vitest-environment node
import { createServer as createHttpServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'

import config from '../../vite.config'

const payload = Buffer.from(
  JSON.stringify({
    title: 'Big route',
    coordinates: 'Béceleuf · Ošupe '.repeat(8000),
  }),
)
const media = Buffer.from([0, 255, 1, 128, 13, 10])
let upstream: Server
let proxy: ViteDevServer
let proxyUrl: string
let receivedHost: string | undefined

beforeAll(async () => {
  upstream = createHttpServer((request, response) => {
    receivedHost = request.headers.host
    const isMedia = request.url === '/api/media'
    const body = isMedia ? media : payload
    response.writeHead(isMedia ? 206 : 200, {
      'Content-Type': isMedia ? 'application/octet-stream' : 'application/json',
      'Content-Length': body.length,
      Connection: 'close',
      ...(isMedia ? { 'Content-Range': 'bytes 0-5/20' } : {}),
    })
    for (let offset = 0; offset < body.length; offset += 8192) {
      response.write(body.subarray(offset, offset + 8192))
    }
    response.end()
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const port = (upstream.address() as AddressInfo).port
  const apiProxy = config.server?.proxy?.['/api']
  if (!apiProxy || typeof apiProxy === 'string') {
    throw new Error('Expected the API proxy to have structured options')
  }
  proxy = await createServer({
    configFile: false,
    plugins: [],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      watch: null,
      proxy: { '/api': { ...apiProxy, target: `http://127.0.0.1:${port}` } },
    },
  })
  await proxy.listen()
  proxyUrl = `http://127.0.0.1:${(proxy.httpServer!.address() as AddressInfo).port}`
})

afterAll(async () => {
  await proxy?.close()
  upstream?.closeAllConnections()
  await new Promise<void>((resolve) => upstream?.close(() => resolve()))
})

it('keeps downstream connections alive and forwards a large UTF-8 JSON body intact', async () => {
  const response = await fetch(`${proxyUrl}/api/timeline`)
  expect(response.headers.get('connection')).toBe('keep-alive')
  expect(response.headers.get('content-length')).toBe(String(payload.length))
  expect(Buffer.from(await response.arrayBuffer())).toEqual(payload)
  // The API uses the original Host for absolute media URLs on other devices.
  expect(receivedHost).toBe(new URL(proxyUrl).host)
})

it('preserves partial binary responses and their range headers', async () => {
  const response = await fetch(`${proxyUrl}/api/media`)
  expect(response.status).toBe(206)
  expect(response.headers.get('content-range')).toBe('bytes 0-5/20')
  expect(response.headers.get('content-length')).toBe(String(media.length))
  expect(Buffer.from(await response.arrayBuffer())).toEqual(media)
})
