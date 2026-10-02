# Access data
You can use default data and custom data to complete data access.

## Use default data
The default data source is https://polygon.io/. You need to apply for an API key before using it. After the application is completed, data access is completed through the built-in `DefaultDatafeed` class.
Sample,
```typescript
import { KLineChartPro, DefaultDatafeed } from '@klinecharts/pro'
const chart = new KLineChartPro({
  container: document.getElementById('container'),
  datafeed: new DefaultDatafeed(`${polygonIoApiKey}`)
})
```

## Use custom data
To use custom data, just follow the steps below.

### Step 1: Implement the data access API
```typescript
class CustomDatafeed {
  /**
   * Fuzzy search symbols
   * Triggered when the search box is entered
   * Returns an array of symbol information
   */
  searchSymbols (search?: string): Promise<SymbolInfo[]> {
    // Remote pull of symbol data based on fuzzy fields
  }

  /**
   * Pull historical k-line data
  * Triggered on initialization, symbol/period changes, and boundary pagination
   * 
  * Returns bars with millisecond timestamps, or a DatafeedHistoryResult with paging metadata.
   */
  getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[] | DatafeedHistoryResult> {
    // Complete data request
  }

  /**
   * Subscribe to real-time data of the symbol in a certain period
  * Subscribed after history initialization; unsubscribed on symbol/period changes or disposal
   * 
  * Push exactly one KLineData through each callback
   */
  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    // Complete ws subscription or http polling
  }

  /**
   * Unsubscribe to real-time data of the symbol in a certain period
   * Triggered when the symbol and period change
   * 
   */ 
  unsubscribe (symbol: SymbolInfo, period: Period): void {
    // Complete ws subscription cancellation or http polling cancellation
  }
}
```

Returning `KLineData[]` remains supported. For exact two-way pagination, return:
```typescript
{
  bars: KLineData[],
  hasMoreBefore: boolean,
  hasMoreAfter: boolean
}
```

`hasMoreBefore` indicates older data and `hasMoreAfter` indicates newer data. The array form remains for existing datafeeds; Pro estimates availability from whether a 500-bar page is full. Every `timestamp` must be in milliseconds. Pro sorts bars chronologically and removes duplicate timestamps. Realtime callbacks deliver one bar at a time; matching timestamps update the current bar. KLineChart v10's DataLoader owns history, pagination, subscription, and unsubscription lifecycle, so datafeeds must not write directly to chart data APIs.

### Step 2: Access custom data
```typescript
import { KLineChartPro, DefaultDatafeed } from '@klinecharts/pro'
const chart = new KLineChartPro({
  container: document.getElementById('container'),
  datafeed: new CustomDatafeed()
})
```