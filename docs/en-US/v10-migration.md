# KLineChart v10 Migration

KLineChart Pro `0.2.0` targets `klinecharts@10.0.3`. This release no longer declares compatibility with KLineChart v9. Install the matching core version explicitly:

```bash
npm install @klinecharts/pro@0.2.0 klinecharts@10.0.3
```

## Pro Models

Pro keeps its own `Period` (`multiplier`, `timespan`, and `text`) and extended `SymbolInfo`. The period bar, symbol search, and custom Datafeed do not need to adopt KLineChart's internal models; Pro converts them internally to v10's `{ span, type }` and supported symbol fields. `text` remains UI metadata.

## Datafeed

Existing Datafeeds returning `Promise<KLineData[]>` remain supported. For accurate paging state, import `DatafeedHistoryResult` from `@klinecharts/pro` and return:

```typescript
{
  bars: KLineData[],
  hasMoreBefore: boolean,
  hasMoreAfter: boolean
}
```

`hasMoreBefore` indicates older data and `hasMoreAfter` indicates newer data. For array results, Pro estimates availability from whether a 500-bar page is full. Timestamps must be in milliseconds; Pro sorts bars and removes duplicate timestamps.

The v10 DataLoader owns initialization, left/right pagination, realtime subscription, and unsubscription. Each `subscribe` callback receives exactly one `KLineData`: matching timestamps update the current bar and newer timestamps append. A Datafeed must cancel the underlying subscription by symbol and period. Do not additionally call the v9 `applyNewData`, `applyMoreData`, `updateData`, or `loadMore` APIs.

## Styles and Behavior

In v10, y-axis behavior is no longer part of `Styles`. Do not place `yAxis.type` or `yAxis.reverse` in initialization styles; Pro's settings panel applies these through the v10 axis API. Custom Pro periods retain their existing shape and support `second`, `minute`, `hour`, `day`, `week`, `month`, and `year`.

## Compatibility

The current release pins its peer dependency to `klinecharts@10.0.3`. Applications requiring KLineChart v9 should remain on the Pro v9-compatible release line; do not force-install this release by ignoring peer dependency checks.