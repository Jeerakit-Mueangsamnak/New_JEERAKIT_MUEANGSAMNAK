// Test guard: no test may reach the real Supabase project or any other host off this machine.
// Blocks fetch, XMLHttpRequest, WebSocket/EventSource and Node http/https/net/tls connections.
// A blocked attempt throws where it happens and also fails the test in afterEach, so a call
// whose error is swallowed by app code (try/catch, fallback to cache) still shows up.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { afterEach } from 'vitest'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const blocked: string[] = []

function block(channel: string, target: string): never {
  const message = `[no-network] ${channel} to ${target} is blocked in tests (mock the data layer instead)`
  blocked.push(message)
  throw new Error(message)
}

function hostOf(target: unknown): string | null {
  try {
    if (typeof target === 'string') return new URL(target, 'http://localhost').hostname
    if (target instanceof URL) return target.hostname
    if (target && typeof target === 'object') {
      const t = target as { url?: string; hostname?: string; host?: string; path?: string }
      if (typeof t.url === 'string') return new URL(t.url, 'http://localhost').hostname
      if (t.hostname || t.host) return String(t.hostname || t.host).replace(/:\d+$/, '')
      if (t.path) return 'localhost' // IPC pipe / unix socket
    }
  } catch {
    return null
  }
  return 'localhost'
}

function guard(channel: string, target: unknown) {
  const host = hostOf(target)
  if (!host || !LOOPBACK.has(host)) block(channel, String(host ?? target))
}

// 1) Environment: the Supabase values must be the local test ones from vitest.config.mjs.
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
  const value = process.env[key] || ''
  if (value && !LOOPBACK.has(hostOf(value) || '')) {
    throw new Error(`[no-network] ${key} points off this machine; tests must use the local test URL`)
  }
}

// 2) fetch (Node undici and jsdom share globalThis.fetch).
const realFetch = globalThis.fetch
if (realFetch) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    guard('fetch', input)
    return realFetch(input, init)
  }) as typeof fetch
}

// 3) Browser-style channels under jsdom.
const g = globalThis as Record<string, unknown>
const RealXHR = g.XMLHttpRequest as (new () => XMLHttpRequest) | undefined
if (RealXHR) {
  const open = RealXHR.prototype.open
  RealXHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    guard('XMLHttpRequest', url)
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof open
}
for (const name of ['WebSocket', 'EventSource'] as const) {
  const Real = g[name] as (new (url: string | URL, ...rest: unknown[]) => object) | undefined
  if (!Real) continue
  g[name] = new Proxy(Real, {
    construct(target, args) {
      guard(name, args[0])
      return Reflect.construct(target, args)
    },
  })
}

// 4) Node sockets.
for (const [mod, label] of [[http, 'http'], [https, 'https']] as const) {
  for (const fn of ['request', 'get'] as const) {
    const real = mod[fn] as (...a: unknown[]) => unknown
    ;(mod as unknown as Record<string, unknown>)[fn] = (...args: unknown[]) => {
      guard(`${label}.${fn}`, args[0])
      return real.apply(mod, args)
    }
  }
}
for (const [mod, label] of [[net, 'net'], [tls, 'tls']] as const) {
  for (const fn of ['connect', 'createConnection'] as const) {
    const real = (mod as unknown as Record<string, (...a: unknown[]) => unknown>)[fn]
    if (!real) continue
    ;(mod as unknown as Record<string, unknown>)[fn] = (...args: unknown[]) => {
      const a0 = args[0]
      const target = typeof a0 === 'number' ? { host: typeof args[1] === 'string' ? args[1] : 'localhost' } : a0
      guard(`${label}.${fn}`, target)
      return real.apply(mod, args)
    }
  }
}

afterEach(() => {
  if (blocked.length === 0) return
  const found = blocked.splice(0)
  throw new Error(`Network access attempted during this test:\n${found.join('\n')}`)
})
