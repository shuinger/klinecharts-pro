import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KLineData } from 'klinecharts'

import { getHistoryRange, HISTORY_PAGE_SIZE, normalizeHistoryResult } from './chart-adapter'
import DefaultDatafeed from './DefaultDatafeed'
import { DatafeedHistoryResult, Period, SymbolInfo } from './types'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static instances: MockWebSocket[] = []

  readyState = 0
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor (readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  send (message: string): void {
    this.sent.push(message)
  }

  close (): void {
    this.readyState = 3
    this.onclose?.({} as CloseEvent)
  }

  open (): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.({} as Event)
  }

  emit (messages: Array<Record<string, unknown>>): void {
    this.onmessage?.({ data: JSON.stringify(messages) } as MessageEvent)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  MockWebSocket.instances = []
})

function createBar (timestamp: number) {
  return { timestamp, open: 1, high: 2, low: 0, close: 1, volume: 1 }
}

describe('chart adapter history', () => {
  it('sorts bars and removes duplicate timestamps', () => {
    const normalized = normalizeHistoryResult([
      createBar(1700000002000),
      createBar(1700000001000),
      createBar(1700000001000)
    ], 'init')

    expect(normalized.bars.map(bar => bar.timestamp)).toEqual([1700000001000, 1700000002000])
    expect(normalized.more).toEqual({ forward: false, backward: false })
  })

  it('estimates older-page availability for legacy array results', () => {
    const bars = Array.from({ length: HISTORY_PAGE_SIZE }, (_, index) => createBar(1700000000000 + index * 60000))

    expect(normalizeHistoryResult(bars, 'init').more).toEqual({ forward: true, backward: false })
  })

  it('preserves explicit bidirectional pagination metadata', () => {
    const result: DatafeedHistoryResult = {
      bars: [createBar(1700000000000)],
      hasMoreBefore: true,
      hasMoreAfter: true
    }

    expect(normalizeHistoryResult(result, 'init').more).toEqual({ forward: true, backward: true })
    expect(normalizeHistoryResult(result, 'update').more).toEqual({ forward: false, backward: false })
  })

  it('rejects timestamps that are not milliseconds', () => {
    expect(() => normalizeHistoryResult([createBar(1700000000)], 'init')).toThrow('milliseconds')
  })

  it('clamps month offsets at month end', () => {
    const period: Period = { multiplier: 1, timespan: 'month', text: '1M' }
    const anchor = Date.UTC(2024, 2, 31)
    const [from, to] = getHistoryRange('forward', period, anchor)

    expect(new Date(from).toISOString().slice(0, 10)).toBe('1982-07-31')
    expect(to).toBe(anchor - 1)
  })

  it('keeps leap-day calendar offsets valid', () => {
    const period: Period = { multiplier: 1, timespan: 'year', text: '1Y' }
    const anchor = Date.UTC(2024, 1, 29)
    const [from] = getHistoryRange('forward', period, anchor)

    expect(new Date(from).toISOString().slice(5, 10)).toBe('02-29')
  })

  it('excludes existing boundary bars from paging ranges', () => {
    const period: Period = { multiplier: 1, timespan: 'hour', text: '1H' }
    const anchor = Date.UTC(2024, 0, 1, 12)

    expect(getHistoryRange('forward', period, anchor)[1]).toBe(anchor - 1)
    expect(getHistoryRange('backward', period, anchor)[0]).toBe(anchor + 1)
    expect(getHistoryRange('update', period, anchor)[0]).toBe(anchor + 1)
    expect(getHistoryRange('init', period, anchor)[1]).toBe(anchor)
  })
})

describe('default datafeed subscriptions', () => {
  it('closes a pending socket without authenticating after its final subscription is removed', () => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    const datafeed = new DefaultDatafeed('test-key')
    const symbol: SymbolInfo = { ticker: 'TEST', market: 'stocks' }
    const period: Period = { multiplier: 1, timespan: 'minute', text: '1m' }

    datafeed.subscribe(symbol, period, () => {})
    const socket = MockWebSocket.instances[0]
    datafeed.unsubscribe(symbol, period)

    expect(socket.readyState).toBe(MockWebSocket.CONNECTING)
    socket.open()
    expect(socket.readyState).toBe(3)
    expect(socket.sent).toEqual([])
  })

  it('shares channels, aggregates periods, replaces snapshots, and releases the final subscription', () => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    const datafeed = new DefaultDatafeed('test-key')
    const symbol: SymbolInfo = { ticker: 'TEST', market: 'stocks' }
    const minute: Period = { multiplier: 1, timespan: 'minute', text: '1m' }
    const fiveMinutes: Period = { multiplier: 5, timespan: 'minute', text: '5m' }
    const minuteBars: KLineData[] = []
    const fiveMinuteBars: KLineData[] = []

    datafeed.subscribe(symbol, minute, bar => { minuteBars.push(bar) })
    datafeed.subscribe(symbol, fiveMinutes, bar => { fiveMinuteBars.push(bar) })

    const socket = MockWebSocket.instances[0]
    expect(MockWebSocket.instances).toHaveLength(1)
    socket.open()
    socket.emit([{ ev: 'status', status: 'auth_success' }])
    expect(socket.sent.map(message => JSON.parse(message).params)).toEqual(['test-key', 'AM.TEST'])

    const timestamp = Date.UTC(2024, 0, 1, 10, 0)
    socket.emit([{ ev: 'AM', sym: 'TEST', s: timestamp, o: 10, h: 12, l: 9, c: 11, v: 3, vw: 10.5 }])
    socket.emit([{ ev: 'AM', sym: 'TEST', s: timestamp, o: 10, h: 13, l: 8, c: 12, v: 5, vw: 11 }])
    socket.emit([{ ev: 'AM', sym: 'TEST', s: timestamp + 60000, o: 12, h: 15, l: 11, c: 14, v: 2, vw: 13 }])

    expect(minuteBars).toHaveLength(3)
    expect(minuteBars[1].volume).toBe(5)
    expect(fiveMinuteBars[2]).toMatchObject({ timestamp, open: 10, high: 15, low: 8, close: 14, volume: 7 })

    datafeed.unsubscribe(symbol, minute)
    expect(socket.sent.some(message => JSON.parse(message).action === 'unsubscribe')).toBe(false)
    datafeed.unsubscribe(symbol, fiveMinutes)
    expect(JSON.parse(socket.sent[socket.sent.length - 1]).params).toBe('AM.TEST')
    expect(JSON.parse(socket.sent[socket.sent.length - 1]).action).toBe('unsubscribe')
    expect(socket.readyState).toBe(3)
  })
})