/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createSignal, createEffect, onMount, Show, onCleanup, startTransition, Component } from 'solid-js'

import {
  init, dispose, utils, Nullable, Chart, OverlayMode, Styles,
  Indicator, DomPosition
} from 'klinecharts'

import lodashSet from 'lodash/set'
import lodashClone from 'lodash/cloneDeep'

import { SelectDataSourceItem, Loading } from './component'

import {
  PeriodBar, DrawingBar, IndicatorModal, TimezoneModal, SettingModal,
  ScreenshotModal, IndicatorSettingModal, SymbolSearchModal
} from './widget'

import { translateTimezone } from './widget/timezone-modal/data'

import { SymbolInfo, Period, ChartProOptions, ChartPro } from './types'
import { getHistoryRange, normalizeHistoryResult, toChartPeriod, toChartSymbol } from './chart-adapter'

export interface ChartProComponentProps extends Required<Omit<ChartProOptions, 'container'>> {
  ref: (chart: ChartPro) => void
}

interface IndicatorTooltipFeatureClick {
  paneId: string
  indicator?: Indicator
  feature?: { id?: string }
}

type YAxisName = 'normal' | 'percentage' | 'logarithm'

function getPaneId (indicatorName: string): string {
  return `klinecharts-pro-${indicatorName}`
}

function getModelKey (symbol: SymbolInfo, period: Period): string {
  return `${symbol.market ?? ''}|${symbol.exchange ?? ''}|${symbol.ticker}|${symbol.pricePrecision ?? 2}|${symbol.volumePrecision ?? 0}|${period.multiplier}|${period.timespan}`
}

function createIndicator (widget: Nullable<Chart>, indicatorName: string, isStack?: boolean, paneId?: string): Nullable<string> {
  const indicatorId = widget?.createIndicator({
    name: indicatorName,
    ...(paneId ? { paneId } : {}),
    createTooltipDataSource: ({ chart, crosshair, indicator }) => {
      const visibleFeatureId = indicator.visible ? 'invisible' : 'visible'
      const tooltipStyles = chart.getStyles().indicator.tooltip
      const data = indicator.result[crosshair.dataIndex ?? -1] as Record<string, unknown> | undefined
      const legends = indicator.visible && data
        ? indicator.figures.flatMap(figure => {
          if (!figure.title) return []
          const rawValue = data[figure.key]
          const value = typeof rawValue === 'number' && Number.isFinite(rawValue)
            ? utils.formatPrecision(rawValue, indicator.precision)
            : String(rawValue ?? tooltipStyles.legend.defaultValue)
          return [{
            title: { text: figure.title, color: tooltipStyles.legend.color },
            value: { text: indicator.shouldFormatBigNumber ? utils.formatBigNumber(value) : value, color: tooltipStyles.legend.color }
          }]
        })
        : []
      return {
        name: tooltipStyles.title.show && tooltipStyles.title.showName ? indicator.shortName : '',
        calcParamsText: tooltipStyles.title.show && tooltipStyles.title.showParams && indicator.calcParams.length > 0
          ? `(${indicator.calcParams.join(',')})`
          : '',
        legends,
        features: tooltipStyles.features.filter(feature =>
          feature.id === visibleFeatureId || feature.id === 'setting' || feature.id === 'close'
        )
      }
    }
  }, isStack) ?? null
  return paneId ?? indicatorId
}

const ChartProComponent: Component<ChartProComponentProps> = props => {
  let widgetRef: HTMLDivElement | undefined = undefined
  let widget: Nullable<Chart> = null

  let priceUnitDom: HTMLElement

  let pendingLoads = 0
  let loadGeneration = 0
  let isDisposed = false
  let currentModelKey = ''
  const activeSubscriptions = new Map<string, { symbol: SymbolInfo, period: Period }>()

  const [theme, setTheme] = createSignal(props.theme)
  const [styles, setStyles] = createSignal(props.styles)
  const [locale, setLocale] = createSignal(props.locale)
  const [yAxisOptions, setYAxisOptions] = createSignal<{ name: YAxisName, reverse: boolean }>({ name: 'normal', reverse: false })

  const [symbol, setSymbol] = createSignal(props.symbol)
  const [period, setPeriod] = createSignal(props.period)
  const [indicatorModalVisible, setIndicatorModalVisible] = createSignal(false)
  const [mainIndicators, setMainIndicators] = createSignal([...(props.mainIndicators!)])
  const [subIndicators, setSubIndicators] = createSignal<Record<string, string>>({})

  const [timezoneModalVisible, setTimezoneModalVisible] = createSignal(false)
  const [timezone, setTimezone] = createSignal<SelectDataSourceItem>({ key: props.timezone, text: translateTimezone(props.timezone, props.locale) })

  const [settingModalVisible, setSettingModalVisible] = createSignal(false)
  const [widgetDefaultStyles, setWidgetDefaultStyles] = createSignal<Styles>()

  const [screenshotUrl, setScreenshotUrl] = createSignal('')

  const [drawingBarVisible, setDrawingBarVisible] = createSignal(props.drawingBarVisible)

  const [symbolSearchModalVisible, setSymbolSearchModalVisible] = createSignal(false)

  const [loadingVisible, setLoadingVisible] = createSignal(false)

  const [indicatorSettingModalParams, setIndicatorSettingModalParams] = createSignal({
    visible: false, indicatorName: '', paneId: '', calcParams: [] as Array<any>
  })

  props.ref({
    setTheme,
    getTheme: () => theme(),
    setStyles,
    getStyles: () => widget!.getStyles(),
    setLocale,
    getLocale: () => locale(),
    setTimezone: (timezone: string) => { setTimezone({ key: timezone, text: translateTimezone(props.timezone, locale()) }) },
    getTimezone: () => timezone().key,
    setSymbol,
    getSymbol: () => symbol(),
    setPeriod,
    getPeriod: () => period()
  })

  const documentResize = () => {
    widget?.resize()
  }

  onMount(() => {
    window.addEventListener('resize', documentResize)
    widget = init(widgetRef!, {
      layout: {
        yAxis: { position: 'right', inside: false, reverse: yAxisOptions().reverse }
      },
      formatter: {
        formatDate: ({ dateTimeFormat, timestamp, type }) => {
          const p = period()
          let template = 'YYYY-MM-DD HH:mm'
          switch (p.timespan) {
            case 'second':
            case 'minute': template = type === 'xAxis' ? 'HH:mm' : 'YYYY-MM-DD HH:mm:ss'; break
            case 'hour': template = type === 'xAxis' ? 'MM-DD HH:mm' : 'YYYY-MM-DD HH:mm'; break
            case 'day':
            case 'week': template = 'YYYY-MM-DD'; break
            case 'month': {
              template = type === 'xAxis' ? 'YYYY-MM' : 'YYYY-MM-DD'
              break
            }
            case 'year': {
              template = type === 'xAxis' ? 'YYYY' : 'YYYY-MM-DD'
              break
            }
          }
          return utils.formatDate(dateTimeFormat, timestamp, template)
        }
      }
    })

    if (widget) {
      currentModelKey = getModelKey(symbol(), period())
      widget.setSymbol(toChartSymbol(symbol()))
      widget.setPeriod(toChartPeriod(period()))
      widget.setDataLoader({
        getBars: async ({ type, timestamp, symbol: chartSymbol, period: chartPeriod, callback }) => {
          const requestGeneration = loadGeneration
          const requestSymbol = symbol()
          const requestPeriod = period()
          const requestKey = getModelKey(requestSymbol, requestPeriod)
          let callbackCalled = false
          const finish = (bars: Parameters<typeof callback>[0], more?: Parameters<typeof callback>[1]) => {
            if (!callbackCalled) {
              callbackCalled = true
              callback(bars, more)
            }
          }
          pendingLoads += 1
          setLoadingVisible(true)
          try {
            if (chartSymbol.ticker !== requestSymbol.ticker || chartPeriod.span !== requestPeriod.multiplier || chartPeriod.type !== requestPeriod.timespan) {
              finish([], false)
              return
            }
            const [from, to] = getHistoryRange(type, requestPeriod, timestamp)
            const result = await props.datafeed.getHistoryKLineData(requestSymbol, requestPeriod, from, to)
            if (isDisposed || requestGeneration !== loadGeneration || requestKey !== getModelKey(symbol(), period())) {
              finish([], false)
              return
            }
            const normalized = normalizeHistoryResult(result, type)
            finish(normalized.bars, normalized.more)
          } catch (error) {
            finish([], false)
            if (!isDisposed && requestGeneration === loadGeneration) {
              console.error('[KLineChart Pro] Failed to load historical data', error)
            }
          } finally {
            pendingLoads = Math.max(0, pendingLoads - 1)
            if (!isDisposed) {
              setLoadingVisible(pendingLoads > 0)
            }
          }
        },
        subscribeBar: ({ symbol: chartSymbol, period: chartPeriod, callback }) => {
          const subscriptionKey = `${chartSymbol.ticker}|${chartPeriod.span}|${chartPeriod.type}`
          const currentSymbol = symbol()
          const subscriptionSymbol = chartSymbol.ticker === currentSymbol.ticker
            ? currentSymbol
            : {
                ticker: chartSymbol.ticker,
                pricePrecision: chartSymbol.pricePrecision,
                volumePrecision: chartSymbol.volumePrecision
              }
          const subscriptionPeriod = [period(), ...props.periods].find(candidate =>
            candidate.multiplier === chartPeriod.span && candidate.timespan === chartPeriod.type
          ) ?? {
            multiplier: chartPeriod.span,
            timespan: chartPeriod.type,
            text: `${chartPeriod.span}${chartPeriod.type}`
          }
          const subscription = { symbol: subscriptionSymbol, period: subscriptionPeriod }
          activeSubscriptions.set(subscriptionKey, subscription)
          props.datafeed.subscribe(subscription.symbol, subscription.period, callback)
        },
        unsubscribeBar: ({ symbol: chartSymbol, period: chartPeriod }) => {
          const subscriptionKey = `${chartSymbol.ticker}|${chartPeriod.span}|${chartPeriod.type}`
          const subscription = activeSubscriptions.get(subscriptionKey)
          if (subscription) {
            props.datafeed.unsubscribe(subscription.symbol, subscription.period)
            activeSubscriptions.delete(subscriptionKey)
          }
        }
      })

      const watermarkContainer = widget.getDom('candle_pane', 'main')
      if (watermarkContainer) {
        let watermark = document.createElement('div')
        watermark.className = 'klinecharts-pro-watermark'
        if (utils.isString(props.watermark)) {
          const str = (props.watermark as string).replace(/(^\s*)|(\s*$)/g, '')
          watermark.innerHTML = str
        } else {
          watermark.appendChild(props.watermark as Node)
        }
        watermarkContainer.appendChild(watermark)
      }

      const priceUnitContainer = widget.getDom('candle_pane', 'yAxis')
      priceUnitDom = document.createElement('span')
      priceUnitDom.className = 'klinecharts-pro-price-unit'
      priceUnitContainer?.appendChild(priceUnitDom)
    }

    mainIndicators().forEach(indicator => {
      createIndicator(widget, indicator, true, 'candle_pane')
    })
    const subIndicatorMap: Record<string, string> = {}
    props.subIndicators!.forEach(indicator => {
      const paneId = getPaneId(indicator)
      createIndicator(widget, indicator, false, paneId)
      if (paneId) {
        subIndicatorMap[indicator] = paneId
      }
    })
    setSubIndicators(subIndicatorMap)
    widget?.subscribeAction('onIndicatorTooltipFeatureClick', data => {
        const { paneId, indicator, feature } = data as IndicatorTooltipFeatureClick
        if (!indicator || !feature?.id) {
          return
        }
        const indicatorName = indicator.name
        switch (feature.id) {
          case 'visible': {
            widget?.overrideIndicator({ name: indicatorName, paneId, visible: true })
            break
          }
          case 'invisible': {
            widget?.overrideIndicator({ name: indicatorName, paneId, visible: false })
            break
          }
          case 'setting': {
            const currentIndicator = widget?.getIndicators({ paneId, name: indicatorName })[0]
            if (currentIndicator) {
              setIndicatorSettingModalParams({
                visible: true, indicatorName, paneId, calcParams: currentIndicator.calcParams
              })
            }
            break
          }
          case 'close': {
            if (paneId === 'candle_pane') {
              const newMainIndicators = [...mainIndicators()]
              widget?.removeIndicator({ paneId, name: indicatorName })
              const indicatorIndex = newMainIndicators.indexOf(indicatorName)
              if (indicatorIndex >= 0) newMainIndicators.splice(indicatorIndex, 1)
              setMainIndicators(newMainIndicators)
            } else {
              const newIndicators = { ...subIndicators() }
              widget?.removeIndicator({ paneId, name: indicatorName })
              delete newIndicators[indicatorName]
              setSubIndicators(newIndicators)
            }
          }
        }
      })
  })

  onCleanup(() => {
    isDisposed = true
    loadGeneration += 1
    window.removeEventListener('resize', documentResize)
    dispose(widgetRef!)
  })

  createEffect(() => {
    const s = symbol()
    if (!priceUnitDom) {
      return
    }
    if (s?.priceCurrency) {
      priceUnitDom.textContent = s.priceCurrency.toLocaleUpperCase()
      priceUnitDom.style.display = 'flex'
    } else {
      priceUnitDom.style.display = 'none'
    }
  })

  createEffect(() => {
    const currentSymbol = symbol()
    const currentPeriod = period()
    const nextModelKey = getModelKey(currentSymbol, currentPeriod)
    if (widget && nextModelKey !== currentModelKey) {
      currentModelKey = nextModelKey
      loadGeneration += 1
      widget.setSymbol(toChartSymbol(currentSymbol))
      widget.setPeriod(toChartPeriod(currentPeriod))
    }
  })

  createEffect(() => {
    const t = theme()
    widget?.setStyles(t)
    const color = t === 'dark' ? '#929AA5' : '#76808F'
    widget?.setStyles({
      indicator: {
        tooltip: {
          features: [
            {
              id: 'visible',
              position: 'middle',
              type: 'icon_font',
              content: { family: 'icomoon', code: '\ue903' },
              marginLeft: 8,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)'
            },
            {
              id: 'invisible',
              position: 'middle',
              type: 'icon_font',
              content: { family: 'icomoon', code: '\ue901' },
              marginLeft: 8,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)'
            },
            {
              id: 'setting',
              position: 'middle',
              type: 'icon_font',
              content: { family: 'icomoon', code: '\ue902' },
              marginLeft: 6,
              marginTop: 7,
              marginBottom: 0,
              marginRight: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)'
            },
            {
              id: 'close',
              position: 'middle',
              type: 'icon_font',
              content: { family: 'icomoon', code: '\ue900' },
              marginLeft: 6,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)'
            }
          ]
        }
      }
    })
  })

  createEffect(() => {
    widget?.setLocale(locale())
  })

  createEffect(() => {
    widget?.setTimezone(timezone().key)
  })

  createEffect(() => {
    if (styles()) {
      widget?.setStyles(styles())
      setWidgetDefaultStyles(lodashClone(widget!.getStyles()))
    }
  })

  return (
    <>
      <i class="icon-close klinecharts-pro-load-icon"/>
      <Show when={symbolSearchModalVisible()}>
        <SymbolSearchModal
          locale={props.locale}
          datafeed={props.datafeed}
          onSymbolSelected={symbol => { setSymbol(symbol) }}
          onClose={() => { setSymbolSearchModalVisible(false) }}/>
      </Show>
      <Show when={indicatorModalVisible()}>
        <IndicatorModal
          locale={props.locale}
          mainIndicators={mainIndicators()}
          subIndicators={subIndicators()}
          onClose={() => { setIndicatorModalVisible(false) }}
          onMainIndicatorChange={data => {
            const newMainIndicators = [...mainIndicators()]
            if (data.added) {
              createIndicator(widget, data.name, true, 'candle_pane')
              newMainIndicators.push(data.name)
            } else {
              widget?.removeIndicator({ paneId: 'candle_pane', name: data.name })
              newMainIndicators.splice(newMainIndicators.indexOf(data.name), 1)
            }
            setMainIndicators(newMainIndicators)
          }}
          onSubIndicatorChange={data => {
            const newSubIndicators = { ...subIndicators() }
            if (data.added) {
              const paneId = getPaneId(data.name)
              createIndicator(widget, data.name, false, paneId)
              if (paneId) {
                newSubIndicators[data.name] = paneId
              }
            } else {
              if (data.paneId) {
                widget?.removeIndicator({ paneId: data.paneId, name: data.name })
                delete newSubIndicators[data.name]
              }
            }
            setSubIndicators(newSubIndicators)
          }}/>
      </Show>
      <Show when={timezoneModalVisible()}>
        <TimezoneModal
          locale={props.locale}
          timezone={timezone()}
          onClose={() => { setTimezoneModalVisible(false) }}
          onConfirm={setTimezone}
        />
      </Show>
      <Show when={settingModalVisible()}>
        <SettingModal
          locale={props.locale}
          currentStyles={utils.clone(widget!.getStyles())}
          currentYAxis={yAxisOptions()}
          onClose={() => { setSettingModalVisible(false) }}
          onChange={style => {
            widget?.setStyles(style)
          }}
          onYAxisChange={options => {
            const nextOptions = { ...yAxisOptions(), ...options }
            setYAxisOptions(nextOptions)
            widget?.overrideYAxis({ paneId: 'candle_pane', ...nextOptions })
          }}
          onRestoreDefault={(options: SelectDataSourceItem[]) => {
            const style = {}
            options.forEach(option => {
              const key = option.key
              lodashSet(style, key, utils.formatValue(widgetDefaultStyles(), key))
            })
            widget?.setStyles(style)
          }}
        />
      </Show>
      <Show when={screenshotUrl().length > 0}>
        <ScreenshotModal
          locale={props.locale}
          url={screenshotUrl()}
          onClose={() => { setScreenshotUrl('') }}
        />
      </Show>
      <Show when={indicatorSettingModalParams().visible}>
        <IndicatorSettingModal
          locale={props.locale}
          params={indicatorSettingModalParams()}
          onClose={() => { setIndicatorSettingModalParams({ visible: false, indicatorName: '', paneId: '', calcParams: [] }) }}
          onConfirm={(params)=> {
            const modalParams = indicatorSettingModalParams()
            widget?.overrideIndicator({ name: modalParams.indicatorName, paneId: modalParams.paneId, calcParams: params })
          }}
        />
      </Show>
      <PeriodBar
        locale={props.locale}
        symbol={symbol()}
        spread={drawingBarVisible()}
        period={period()}
        periods={props.periods}
        onMenuClick={async () => {
          try {
            await startTransition(() => setDrawingBarVisible(!drawingBarVisible()))
            widget?.resize()
          } catch (e) {}    
        }}
        onSymbolClick={() => { setSymbolSearchModalVisible(!symbolSearchModalVisible()) }}
        onPeriodChange={setPeriod}
        onIndicatorClick={() => { setIndicatorModalVisible((visible => !visible)) }}
        onTimezoneClick={() => { setTimezoneModalVisible((visible => !visible)) }}
        onSettingClick={() => { setSettingModalVisible((visible => !visible)) }}
        onScreenshotClick={() => {
          if (widget) {
            const url = widget.getConvertPictureUrl(true, 'jpeg', props.theme === 'dark' ? '#151517' : '#ffffff')
            setScreenshotUrl(url)
          }
        }}
      />
      <div
        class="klinecharts-pro-content">
        <Show when={loadingVisible()}>
          <Loading/>
        </Show>
        <Show when={drawingBarVisible()}>
          <DrawingBar
            locale={props.locale}
            onDrawingItemClick={overlay => { widget?.createOverlay(overlay) }}
            onModeChange={mode => { widget?.overrideOverlay({ mode: mode as OverlayMode }) }}
            onLockChange={lock => { widget?.overrideOverlay({ lock }) }}
            onVisibleChange={visible => { widget?.overrideOverlay({ visible }) }}
            onRemoveClick={(groupId) => { widget?.removeOverlay({ groupId }) }}/>
        </Show>
        <div
          ref={widgetRef}
          class='klinecharts-pro-widget'
          data-drawing-bar-visible={drawingBarVisible()}/>
      </div>
    </>
  )
}

export default ChartProComponent