# 接入数据
可以使用默认的数据，和自定义数据完成数据接入。

## 使用默认数据
默认数据来源于 https://polygon.io/ ，在使用前需要去申请API key。申请完成后，通过内置`DefaultDatafeed`这个类完成数据接入。
示例：
```typescript
import { KLineChartPro, DefaultDatafeed } from '@klinecharts/pro'
const chart = new KLineChartPro({
  container: document.getElementById('container'),
  datafeed: new DefaultDatafeed(`${polygonIoApiKey}`)
})
```

## 使用自定义数据
需要使用自定义数据，只需要按如下步骤即可。

### 第一步，实现数据接入API
```typescript
class CustomDatafeed {
  /**
   * 模糊搜索标的
   * 在搜索框输入的时候触发
   * 返回标的信息数组
   */
  searchSymbols (search?: string): Promise<SymbolInfo[]> {
    // 根据模糊字段远程拉取标的数据
  }

  /**
   * 获取历史k线数据
  * 初始化、切换标的/周期或拖动到数据边界时触发
   * 
  * 返回毫秒时间戳的 K 线数组。也可返回带分页信息的 DatafeedHistoryResult。
   */
  getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[] | DatafeedHistoryResult> {
    // 完成数据请求
  }

  /**
   * 订阅标的在某个周期的实时数据
  * 初始化历史数据后由图表订阅；切换标的/周期或销毁时取消
   * 
  * 每次通过 callback 推送一根 KLineData
   */
  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    // 完成ws订阅或者http轮询
  }

  /**
   * 取消订阅标的在某个周期的实时数据
   * 当标的和周期发生变化的时候触发
   * 
   */ 
  unsubscribe (symbol: SymbolInfo, period: Period): void {
    // 完成ws订阅取消或者http轮询取消
  }
}
```

历史结果可以继续返回 `KLineData[]`。如需准确控制双向分页，可返回：
```typescript
{
  bars: KLineData[],
  hasMoreBefore: boolean,
  hasMoreAfter: boolean
}
```

`hasMoreBefore` 表示还有更早的数据，`hasMoreAfter` 表示还有更新的数据。数组形式为兼容旧 Datafeed 保留，Pro 会以每页 500 根的结果长度估算是否还有数据。所有 `timestamp` 必须为毫秒；Pro 会按时间升序整理并合并重复时间戳。实时回调每次只接收一根 K 线，同一时间戳用于更新当前 bar。历史加载、分页和订阅/取消订阅由 KLineChart v10 的 DataLoader 生命周期触发，业务代码不要再直接调用图表数据写入 API。

### 第二步，接入自定义数据
```typescript
import { KLineChartPro, DefaultDatafeed } from '@klinecharts/pro'
const chart = new KLineChartPro({
  container: document.getElementById('container'),
  datafeed: new CustomDatafeed()
})
```