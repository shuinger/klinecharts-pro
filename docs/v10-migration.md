# KLineChart v10 迁移

KLineChart Pro `0.2.0` 面向 `klinecharts@10.0.3`。此版本不再声明 KLineChart v9 兼容；请在应用中显式安装匹配的内核版本：

```bash
npm install @klinecharts/pro@0.2.0 klinecharts@10.0.3
```

## Pro 公共模型

Pro 继续使用自己的 `Period`（`multiplier`、`timespan`、`text`）和扩展 `SymbolInfo`。周期栏、标的搜索和自定义 Datafeed 无需改成 KLineChart 的内部模型；Pro 会在内部转换为 v10 的 `{ span, type }` 和基础标的字段。`text` 仍只用于 Pro UI。

## Datafeed

已有返回 `Promise<KLineData[]>` 的 Datafeed 仍可使用。需要准确表达分页状态时，可从 `@klinecharts/pro` 导入 `DatafeedHistoryResult`，并返回：

```typescript
{
  bars: KLineData[],
  hasMoreBefore: boolean,
  hasMoreAfter: boolean
}
```

`hasMoreBefore` 对应更早的历史数据，`hasMoreAfter` 对应更新的数据。仅返回数组时，Pro 会以每页 500 根估算是否还有数据。时间戳必须使用毫秒；Pro 会排序并合并重复时间戳。

图表初始化、左右分页、实时订阅和取消订阅由 v10 DataLoader 管理。`subscribe` 的回调每次只接收一根 `KLineData`；相同时间戳更新当前 bar，新时间戳追加。Datafeed 应能按标的和周期准确取消底层订阅，不要在消费端额外调用 v9 的 `applyNewData`、`applyMoreData`、`updateData` 或 `loadMore`。

## 样式和行为

v10 已将 y 轴行为从 `Styles` 移出。不要再把 `yAxis.type` 或 `yAxis.reverse` 放入初始化 `styles`；Pro 设置面板会通过 v10 的 y 轴 API 应用这些设置。Pro 自定义周期列表仍使用原来的周期结构，并支持 `second`、`minute`、`hour`、`day`、`week`、`month` 和 `year`。

## 兼容范围

当前发行包的 peer dependency 精确锁定为 `klinecharts@10.0.3`。需要 KLineChart v9 的应用应继续使用 Pro v9 兼容发行线；不要通过忽略 peer dependency 强制混装。