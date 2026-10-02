import { KLineData } from 'klinecharts'

import { DatafeedHistoryResult, Period, SymbolInfo } from './types'

export type DataLoadType = 'init' | 'forward' | 'backward' | 'update'
export type ChartPeriodType = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export const HISTORY_PAGE_SIZE = 500

export function toChartPeriod (period: Period): { span: number, type: ChartPeriodType } {
  const supportedTypes: ChartPeriodType[] = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year']
  if (!Number.isFinite(period.multiplier) || period.multiplier <= 0 || !supportedTypes.includes(period.timespan as ChartPeriodType)) {
    throw new Error(`Unsupported Pro period: ${period.multiplier} ${period.timespan}`)
  }
  return { span: period.multiplier, type: period.timespan as ChartPeriodType }
}

export function toChartSymbol (symbol: SymbolInfo) {
  return {
    ticker: symbol.ticker,
    pricePrecision: symbol.pricePrecision ?? 2,
    volumePrecision: symbol.volumePrecision ?? 0
  }
}

function shiftPeriod (timestamp: number, period: Period, count: number): number {
  const date = new Date(timestamp)
  const amount = period.multiplier * count
  switch (period.timespan) {
    case 'second': date.setUTCSeconds(date.getUTCSeconds() + amount); break
    case 'minute': date.setUTCMinutes(date.getUTCMinutes() + amount); break
    case 'hour': date.setUTCHours(date.getUTCHours() + amount); break
    case 'day': date.setUTCDate(date.getUTCDate() + amount); break
    case 'week': date.setUTCDate(date.getUTCDate() + amount * 7); break
    case 'month': {
      const day = date.getUTCDate()
      date.setUTCDate(1)
      date.setUTCMonth(date.getUTCMonth() + amount)
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
      date.setUTCDate(Math.min(day, lastDay))
      break
    }
    case 'year': {
      const day = date.getUTCDate()
      const month = date.getUTCMonth()
      date.setUTCDate(1)
      date.setUTCFullYear(date.getUTCFullYear() + amount)
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate()
      date.setUTCMonth(month)
      date.setUTCDate(Math.min(day, lastDay))
      break
    }
  }
  return date.getTime()
}

export function getHistoryRange (type: DataLoadType, period: Period, timestamp: number | null): [number, number] {
  toChartPeriod(period)
  const anchor = timestamp ?? Date.now()
  if (type === 'backward') {
    return [anchor + 1, shiftPeriod(anchor, period, HISTORY_PAGE_SIZE)]
  }
  if (type === 'update') {
    return [anchor + 1, shiftPeriod(anchor, period, 1)]
  }
  return [shiftPeriod(anchor, period, -HISTORY_PAGE_SIZE), type === 'forward' ? anchor - 1 : anchor]
}

export function normalizeHistoryResult (
  result: KLineData[] | DatafeedHistoryResult,
  type: DataLoadType
): { bars: KLineData[], more: { forward: boolean, backward: boolean } } {
  const isArrayResult = Array.isArray(result)
  const sourceBars = isArrayResult ? result : result.bars
  if (sourceBars.some(bar => !Number.isFinite(bar.timestamp) || bar.timestamp < 100000000000)) {
    throw new Error('KLineData timestamps must be milliseconds')
  }
  const bars = [...sourceBars]
    .sort((left, right) => left.timestamp - right.timestamp)
    .filter((bar, index, sorted) => index === 0 || bar.timestamp !== sorted[index - 1].timestamp)
  const fullPage = bars.length >= HISTORY_PAGE_SIZE
  const hasMoreBefore = isArrayResult ? fullPage : result.hasMoreBefore ?? fullPage
  const hasMoreAfter = isArrayResult ? type === 'backward' && fullPage : result.hasMoreAfter ?? (type === 'backward' && fullPage)
  return {
    bars,
    more: {
      forward: (type === 'init' || type === 'forward') && hasMoreBefore,
      backward: (type === 'init' || type === 'backward') && hasMoreAfter
    }
  }
}