import { KLineChartPro, DefaultDatafeed } from '../../src'
import type { Datafeed, Period, SymbolInfo } from '../../src/types'

import './style.css'

function getStep (period: Period): number {
  switch (period.timespan) {
    case 'second': return period.multiplier * 1000
    case 'minute': return period.multiplier * 60 * 1000
    case 'hour': return period.multiplier * 60 * 60 * 1000
    case 'day': return period.multiplier * 24 * 60 * 60 * 1000
    case 'week': return period.multiplier * 7 * 24 * 60 * 60 * 1000
    case 'month': return period.multiplier * 30 * 24 * 60 * 60 * 1000
    case 'year': return period.multiplier * 365 * 24 * 60 * 60 * 1000
    default: return 60 * 1000
  }
}

class PreviewDatafeed implements Datafeed {
  private readonly symbols: SymbolInfo[] = [
    { ticker: 'BABA', shortName: 'BABA', name: 'Alibaba Group', exchange: 'XNYS', market: 'stocks', priceCurrency: 'usd' },
    { ticker: 'AAPL', shortName: 'AAPL', name: 'Apple Inc.', exchange: 'XNAS', market: 'stocks', priceCurrency: 'usd' },
    { ticker: 'MSFT', shortName: 'MSFT', name: 'Microsoft Corporation', exchange: 'XNAS', market: 'stocks', priceCurrency: 'usd' }
  ]

  private readonly timers = new Map<string, number>()

  async searchSymbols (search = ''): Promise<SymbolInfo[]> {
    const query = search.toLocaleLowerCase()
    return this.symbols.filter(symbol => `${symbol.ticker} ${symbol.name}`.toLocaleLowerCase().includes(query))
  }

  async getHistoryKLineData (_symbol: SymbolInfo, period: Period, from: number, to: number) {
    const step = getStep(period)
    const bars = []
    for (let timestamp = Math.ceil(from / step) * step; timestamp <= to && bars.length < 500; timestamp += step) {
      const index = Math.floor(timestamp / step)
      const open = 100 + Math.sin(index / 18) * 5 + Math.sin(index / 5) * 1.5
      const close = open + Math.cos(index / 4) * 0.8
      bars.push({
        timestamp,
        open,
        high: Math.max(open, close) + 0.45,
        low: Math.min(open, close) - 0.45,
        close,
        volume: 500 + Math.round(Math.abs(Math.sin(index / 9)) * 9500)
      })
    }
    return bars
  }

  subscribe (_symbol: SymbolInfo, period: Period, callback: (data: any) => void): void {
    const key = `${_symbol.ticker}|${period.multiplier}|${period.timespan}`
    this.unsubscribe(_symbol, period)
    const timer = window.setInterval(() => {
      const step = getStep(period)
      const timestamp = Math.floor(Date.now() / step) * step
      const close = 100 + Math.sin(timestamp / step / 18) * 5 + Math.cos(Date.now() / 4000) * 0.6
      callback({
        timestamp,
        open: close - 0.25,
        high: close + 0.5,
        low: close - 0.6,
        close,
        volume: 700 + Math.round(Math.abs(Math.sin(Date.now() / 3000)) * 3000)
      })
    }, 1200)
    this.timers.set(key, timer)
  }

  unsubscribe (symbol: SymbolInfo, period: Period): void {
    const key = `${symbol.ticker}|${period.multiplier}|${period.timespan}`
    const timer = this.timers.get(key)
    if (timer !== undefined) {
      window.clearInterval(timer)
      this.timers.delete(key)
    }
  }
}

const symbol: SymbolInfo = {
  ticker: 'BABA',
  shortName: 'BABA',
  name: 'Alibaba Group',
  exchange: 'XNYS',
  market: 'stocks',
  priceCurrency: 'usd',
  pricePrecision: 2,
  volumePrecision: 0
}
const polygonApiKey = import.meta.env.VITE_POLYGON_IO_API_KEY
const datafeed = polygonApiKey ? new DefaultDatafeed(polygonApiKey) : new PreviewDatafeed()

new KLineChartPro({
  container: 'chart',
  locale: window.location.hash.endsWith('#en-US') ? 'en-US' : 'zh-CN',
  symbol,
  period: { multiplier: 15, timespan: 'minute', text: '15m' },
  mainIndicators: ['MA'],
  subIndicators: ['VOL', 'MACD'],
  datafeed
})