import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Circle, Polyline } from 'react-native-svg'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import * as SecureStore from 'expo-secure-store'
import { useAuthStore } from '../../../src/stores/authStore'
import { useReports } from '../../../src/hooks/useReports'
import { formatQty } from '../../../src/lib/quantity'
import { exportReportPDF } from '../../../src/lib/reportPDF'
import { exportReportCSV } from '../../../src/lib/reportCSV'
import { formatCurrency, formatPaymentMethod } from '../../../src/lib/formatters'
import { ScreenHeader } from '../../../src/components/layout'
import { ReportsTutorialModal } from '../../../src/components/reports/ReportsTutorialModal'
import { Button, Card, MetricCard } from '../../../src/components/ui'
import type { DailyDataPoint, PaymentBreakdownItem, TopProduct } from '../../../src/hooks/useReports'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'all'
  | 'custom'

type TopProductSort = 'revenue' | 'quantity' | 'profit'
type ExportType = 'pdf' | 'csv'

interface ChartPoint {
  label: string
  totalCents: number
  date: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THEME = {
  primary: '#0047AB',
  primaryDark: '#003380',
  primaryLight: '#E6EEFF',
  bg: '#F4F6FB',
  card: '#FFFFFF',
  border: '#DDE3F0',
  textPrimary: '#0D1B3E',
  textSecondary: '#5A6A8A',
  success: '#0A7A4B',
  warning: '#B45309',
  danger: '#C0152A',
} as const

const PAYMENT_COLORS: Record<string, string> = {
  cash_usd: '#0047AB',
  cash_zig: '#003380',
  ecocash: '#0A7A4B',
  bank_transfer: '#B45309',
  credit: '#C0152A',
}

const ALL_TIME_START_MS = 0

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// ---------------------------------------------------------------------------
// Date helpers (no external library)
// ---------------------------------------------------------------------------

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function endOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime()
}

function startOfWeek(date: Date): number {
  const d = new Date(date)
  const day = d.getDay()
  // Monday = 1, Sunday = 0; shift to Monday start
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return startOfDay(d)
}

function startOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

function endOfMonth(date: Date): number {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

function startOfYear(date: Date): number {
  return new Date(date.getFullYear(), 0, 1).getTime()
}

function getDateRange(
  period: Period,
  customStart: Date,
  customEnd: Date,
): { startMs: number; endMs: number } {
  const now = new Date()
  switch (period) {
    case 'today':
      return { startMs: startOfDay(now), endMs: endOfDay(now) }
    case 'yesterday': {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      return { startMs: startOfDay(yesterday), endMs: endOfDay(yesterday) }
    }
    case 'this_week':
      return { startMs: startOfWeek(now), endMs: now.getTime() }
    case 'this_month':
      return { startMs: startOfMonth(now), endMs: now.getTime() }
    case 'last_month': {
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastDayPrevMonth = new Date(firstOfThisMonth)
      lastDayPrevMonth.setDate(0)
      return {
        startMs: startOfMonth(lastDayPrevMonth),
        endMs: endOfMonth(lastDayPrevMonth),
      }
    }
    case 'this_year':
      return { startMs: startOfYear(now), endMs: now.getTime() }
    case 'all':
      // Sentinel: useReports omits `created_at` lower bound; end is now
      return { startMs: ALL_TIME_START_MS, endMs: now.getTime() }
    case 'custom':
      return { startMs: startOfDay(customStart), endMs: endOfDay(customEnd) }
  }
}

function formatDateDisplay(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

function getPeriodDisplayLabel(period: Period): string {
  const map: Record<Period, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    this_week: 'This Week',
    this_month: 'This Month',
    last_month: 'Last Month',
    this_year: 'This Year',
    all: 'All Time',
    custom: 'Custom Range',
  }
  return map[period]
}

// ---------------------------------------------------------------------------
// Chart data aggregation
// ---------------------------------------------------------------------------

const ONE_DAY_MS = 86_400_000

function aggregateForChart(
  dailyData: DailyDataPoint[],
  startMs: number,
  endMs: number,
): ChartPoint[] {
  if (dailyData.length === 0) return []

  // useReports already outputs daily or monthly series for all-time / long ranges
  if (startMs === ALL_TIME_START_MS) {
    return dailyData.map(d => ({ label: d.label, totalCents: d.totalCents, date: d.date }))
  }

  const rangeMs = endMs - startMs
  const isSingleDay = rangeMs <= ONE_DAY_MS
  const numDays = Math.ceil(rangeMs / ONE_DAY_MS)

  if (isSingleDay || numDays <= 14) {
    return dailyData.map(d => ({ label: d.label, totalCents: d.totalCents, date: d.date }))
  }

  if (numDays <= 60) {
    // Weekly aggregation
    const weekMap = new Map<number, { totalCents: number; date: number }>()
    const rangeStart = startOfDay(new Date(startMs))
    for (const point of dailyData) {
      const dayOffset = Math.floor((point.date - rangeStart) / ONE_DAY_MS)
      const weekIdx = Math.floor(dayOffset / 7)
      const prev = weekMap.get(weekIdx) ?? { totalCents: 0, date: point.date }
      weekMap.set(weekIdx, { totalCents: prev.totalCents + point.totalCents, date: prev.date })
    }
    return Array.from(weekMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([idx, { totalCents, date }]) => ({
        label: `Wk ${idx + 1}`,
        totalCents,
        date,
      }))
  }

  // Monthly aggregation
  const monthMap = new Map<string, { totalCents: number; label: string; date: number }>()
  for (const point of dailyData) {
    const d = new Date(point.date)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const prev = monthMap.get(key) ?? {
      totalCents: 0,
      label: MONTHS_SHORT[d.getMonth()],
      date: point.date,
    }
    monthMap.set(key, { totalCents: prev.totalCents + point.totalCents, label: prev.label, date: prev.date })
  }
  return Array.from(monthMap.values()).sort((a, b) => a.date - b.date)
}

function formatChartYLabel(cents: number, currency: string, zigRatePerUsd: number): string {
  const usd = cents / 100
  const rate = zigRatePerUsd > 0 && Number.isFinite(zigRatePerUsd) ? zigRatePerUsd : 1
  if (currency === 'ZiG') {
    const z = usd * rate
    if (z >= 1_000_000) return `${(z / 1_000_000).toFixed(1)}M`
    if (z >= 1000) return `${(z / 1000).toFixed(0)}k`
    if (z >= 100) return z.toFixed(0)
    return z.toFixed(2)
  }
  if (currency === 'Both') {
    if (cents >= 1_000_00) return `$${(cents / 1_000_00).toFixed(0)}k`
    if (cents >= 100) return `$${(cents / 100).toFixed(0)}`
    return `$${(cents / 100).toFixed(2)}`
  }
  if (cents >= 1_000_00) return `$${(cents / 1_000_00).toFixed(0)}k`
  if (cents >= 100) return `$${(cents / 100).toFixed(0)}`
  return `$${(cents / 100).toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ label }: { label: string }) {
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '600',
        color: THEME.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        paddingBottom: 8,
        marginTop: 4,
      }}
    >
      {label}
    </Text>
  )
}

// ── Sales Chart (bar / line) ─────────────────────────────────────────────────

const CHART_BAR_H = 120
const CHART_LABEL_H = 20
const MIN_BAR_W = 8
const MAX_BAR_W = 32
const CHART_Y_AXIS_W = 40

type ChartViewMode = 'bar' | 'line'

const CHART_TOGGLE_SEGMENT = 32
const CHART_TOGGLE_PADDING = 3

function ChartViewToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: ChartViewMode
  onViewModeChange: (mode: ChartViewMode) => void
}) {
  const slideAnim = useRef(new Animated.Value(viewMode === 'bar' ? 0 : 1)).current

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: viewMode === 'bar' ? 0 : 1,
      useNativeDriver: true,
      tension: 220,
      friction: 22,
    }).start()
  }, [viewMode, slideAnim])

  const slideX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, CHART_TOGGLE_SEGMENT],
  })

  return (
    <View style={styles.chartToggleTrack}>
      <Animated.View
        style={[
          styles.chartToggleSlider,
          { transform: [{ translateX: slideX }] },
        ]}
      />
      <TouchableOpacity
        style={styles.chartToggleSegment}
        onPress={() => onViewModeChange('bar')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected: viewMode === 'bar' }}
        accessibilityLabel="Bar chart"
      >
        <Ionicons
          name="bar-chart-outline"
          size={16}
          color={viewMode === 'bar' ? '#FFFFFF' : THEME.textSecondary}
        />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.chartToggleSegment}
        onPress={() => onViewModeChange('line')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected: viewMode === 'line' }}
        accessibilityLabel="Line chart"
      >
        <Ionicons
          name="analytics-outline"
          size={16}
          color={viewMode === 'line' ? '#FFFFFF' : THEME.textSecondary}
        />
      </TouchableOpacity>
    </View>
  )
}

interface SalesChartProps {
  data: ChartPoint[]
  selectedBar: number | null
  onSelectBar: (idx: number | null) => void
  currency: string
  zigRatePerUsd: number
  viewMode: ChartViewMode
}

function SalesChart({ data, selectedBar, onSelectBar, currency, zigRatePerUsd, viewMode }: SalesChartProps) {
  const { width: screenW } = useWindowDimensions()
  const chartAreaW = screenW - 32 - CHART_Y_AXIS_W - 8
  const numBars = data.length || 1
  const barWidth = Math.max(MIN_BAR_W, Math.min(MAX_BAR_W, Math.floor((chartAreaW - numBars * 4) / numBars)))
  const maxValue = Math.max(...data.map(d => d.totalCents), 1)
  const isEmpty = data.length === 0 || data.every(d => d.totalCents === 0)

  const gridPcts = [1, 0.75, 0.5, 0.25]
  const pointSpacing = barWidth + 4

  const linePoints = data.map((item, idx) => {
    const barH =
      item.totalCents > 0
        ? Math.max(2, (item.totalCents / maxValue) * (CHART_BAR_H - 4))
        : 0
    return {
      x: idx * pointSpacing + pointSpacing / 2,
      y: CHART_BAR_H - barH,
      idx,
    }
  })

  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        {/* Y-axis labels */}
        <View style={{ width: CHART_Y_AXIS_W, height: CHART_BAR_H }}>
          {gridPcts.map(pct => (
            <Text
              key={pct}
              style={{
                position: 'absolute',
                top: (1 - pct) * CHART_BAR_H - 6,
                right: 4,
                fontSize: 8,
                color: THEME.textSecondary,
                textAlign: 'right',
              }}
            >
              {formatChartYLabel(maxValue * pct, currency, zigRatePerUsd)}
            </Text>
          ))}
          <Text
            style={{
              position: 'absolute',
              bottom: 0,
              right: 4,
              fontSize: 8,
              color: THEME.textSecondary,
              textAlign: 'right',
            }}
          >
            {currency === 'ZiG' ? '0' : '$0'}
          </Text>
        </View>

        {/* Chart area */}
        <View style={{ flex: 1 }}>
          {isEmpty ? (
            <View style={{ height: CHART_BAR_H, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 13, color: THEME.textSecondary }}>No sales data</Text>
            </View>
          ) : (
            <View style={{ height: CHART_BAR_H, position: 'relative' }}>
              {/* Fixed grid lines */}
              {gridPcts.map(pct => (
                <View
                  key={pct}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: Math.round((1 - pct) * CHART_BAR_H),
                    left: 0,
                    right: 0,
                    height: 1,
                    backgroundColor: '#EEF0F7',
                    zIndex: 0,
                  }}
                />
              ))}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 1,
                  backgroundColor: THEME.border,
                  zIndex: 0,
                }}
              />

              {/* Scrollable chart + x-axis labels */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: -CHART_LABEL_H }}
                contentContainerStyle={{ paddingHorizontal: 4 }}
              >
                <View>
                  {viewMode === 'bar' ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'flex-end',
                        height: CHART_BAR_H,
                      }}
                    >
                      {data.map((item, idx) => {
                        const barH =
                          item.totalCents > 0
                            ? Math.max(2, (item.totalCents / maxValue) * (CHART_BAR_H - 4))
                            : 0
                        const isSelected = selectedBar === idx
                        return (
                          <TouchableOpacity
                            key={idx}
                            onPress={() => onSelectBar(isSelected ? null : idx)}
                            hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
                            style={{
                              width: barWidth + 4,
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              height: CHART_BAR_H,
                              paddingHorizontal: 2,
                            }}
                          >
                            <View
                              style={{
                                position: 'absolute',
                                bottom: 0,
                                width: barWidth,
                                height: CHART_BAR_H,
                                backgroundColor: '#F4F6FB',
                                borderRadius: 2,
                              }}
                            />
                            {barH > 0 && (
                              <View
                                style={{
                                  width: barWidth,
                                  height: barH,
                                  backgroundColor: isSelected ? THEME.primaryDark : THEME.primary,
                                  borderTopLeftRadius: 2,
                                  borderTopRightRadius: 2,
                                }}
                              />
                            )}
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  ) : (
                    <Svg width={data.length * pointSpacing} height={CHART_BAR_H}>
                      {linePoints.length > 1 && (
                        <Polyline
                          points={linePoints.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke={THEME.primary}
                          strokeWidth={2}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      )}
                      {linePoints.map(p => {
                        const isSelected = selectedBar === p.idx
                        return (
                          <Circle
                            key={p.idx}
                            cx={p.x}
                            cy={p.y}
                            r={isSelected ? 5 : 3.5}
                            fill={isSelected ? THEME.primaryDark : THEME.primary}
                            stroke={THEME.card}
                            strokeWidth={2}
                            onPress={() => onSelectBar(isSelected ? null : p.idx)}
                          />
                        )
                      })}
                    </Svg>
                  )}

                  {/* X-axis labels row */}
                  <View
                    style={{
                      flexDirection: 'row',
                      paddingHorizontal: 4,
                      height: CHART_LABEL_H,
                    }}
                  >
                    {data.map((item, idx) => (
                      <View
                        key={idx}
                        style={{
                          width: barWidth + 4,
                          alignItems: 'center',
                          paddingTop: 3,
                        }}
                      >
                        {item.label !== '' && (
                          <Text
                            style={{ fontSize: 8, color: THEME.textSecondary }}
                            numberOfLines={1}
                          >
                            {item.label}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      {/* Selected bar info */}
      {selectedBar !== null && data[selectedBar] != null && (
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <View
            style={{
              backgroundColor: THEME.textPrimary,
              borderRadius: 6,
              paddingHorizontal: 12,
              paddingVertical: 5,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '500' }}>
              {data[selectedBar].label !== ''
                ? data[selectedBar].label
                : `Hour ${new Date(data[selectedBar].date).getHours()}:00`}
              {': '}
              {formatCurrency(data[selectedBar].totalCents, currency, zigRatePerUsd)}
            </Text>
          </View>
        </View>
      )}
    </View>
  )
}

// ── Export Options Modal ─────────────────────────────────────────────────────

interface ExportModalProps {
  visible: boolean
  onClose: () => void
  /** One line, e.g. "This Month · 1 Jan 2025 to 28 Feb 2025" */
  rangeDescription: string
  onExport: (type: ExportType) => Promise<void>
}

function ExportOptionsModal({
  visible,
  onClose,
  rangeDescription,
  onExport,
}: ExportModalProps) {
  const [selectedType, setSelectedType] = useState<ExportType>('pdf')
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = useCallback(async () => {
    setIsExporting(true)
    try {
      await onExport(selectedType)
      onClose()
    } catch (err) {
      console.error('[ExportModal] export error:', err)
    } finally {
      setIsExporting(false)
    }
  }, [selectedType, onExport, onClose])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={styles.modalSheet}>
          {/* Handle */}
          <View style={styles.modalHandle} />

          <Text style={styles.modalTitle}>Export Report</Text>
          <Text style={styles.modalSubtitle}>{rangeDescription}</Text>

          {/* PDF option */}
          <TouchableOpacity
            style={[
              styles.exportCard,
              selectedType === 'pdf' && styles.exportCardSelected,
            ]}
            onPress={() => setSelectedType('pdf')}
            activeOpacity={0.85}
          >
            <Ionicons name="document-text" size={32} color={THEME.danger} />
            <Text style={styles.exportCardTitle}>PDF Report</Text>
            <Text style={styles.exportCardDesc}>
              Formatted report — share via WhatsApp, email, or save to files
            </Text>
          </TouchableOpacity>

          {/* CSV option */}
          <TouchableOpacity
            style={[
              styles.exportCard,
              selectedType === 'csv' && styles.exportCardSelected,
            ]}
            onPress={() => setSelectedType('csv')}
            activeOpacity={0.85}
          >
            <Ionicons name="grid" size={32} color={THEME.success} />
            <Text style={styles.exportCardTitle}>CSV / Excel</Text>
            <Text style={styles.exportCardDesc}>
              Raw data — open in Excel or Google Sheets. Perfect for your accountant.
            </Text>
          </TouchableOpacity>

          <View style={{ marginTop: 20 }}>
            <Button
              label="Export"
              variant="primary"
              loading={isExporting}
              onPress={handleExport}
            />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ReportsScreen() {
  // ── Auth ──
  const business = useAuthStore(state => state.business)
  const businessId = business?.id ?? ''
  const currency = business?.currency ?? 'USD'
  const zigRatePerUsd = business?.zigRatePerUsd ?? 1

  // ── Date range state ──
  const [period, setPeriod] = useState<Period>('this_month')
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d
  })
  const [customEnd, setCustomEnd] = useState(new Date())
  const [showFromPicker, setShowFromPicker] = useState(false)
  const [showToPicker, setShowToPicker] = useState(false)

  // ── UI state ──
  const [showExportModal, setShowExportModal] = useState(false)
  const [topProductSort, setTopProductSort] = useState<TopProductSort>('revenue')
  const [selectedBar, setSelectedBar] = useState<number | null>(null)
  const [chartViewMode, setChartViewMode] = useState<ChartViewMode>('bar')
  const [isExportingPDF, setIsExportingPDF] = useState(false)
  const [isExportingCSV, setIsExportingCSV] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)

  // ── Computed date range ──
  const { startMs, endMs } = useMemo(
    () => getDateRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  )

  // ── Data ──
  const {
    totalRevenueCents,
    totalProfitCents,
    cogsCents,
    grossMarginPercent,
    transactionCount,
    totalQtySold,
    avgSaleValueCents,
    avgProfitCents,
    paymentBreakdown,
    dailyData,
    topProducts,
    earliestSaleMs,
    isLoading,
  } = useReports(businessId, startMs, endMs)

  // Show the reports tutorial once on the owner's first visit.
  useEffect(() => {
    if (isLoading || !businessId) return
    let cancelled = false
    void (async () => {
      const key = `reports_tutorial_shown_${businessId}`
      const seen = await SecureStore.getItemAsync(key)
      if (!cancelled && seen !== 'true') {
        setShowTutorial(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isLoading, businessId])

  // Reset selected bar when period changes
  useEffect(() => {
    setSelectedBar(null)
  }, [period])

  // ── Chart data ──
  const chartData = useMemo(
    () => aggregateForChart(dailyData, startMs, endMs),
    [dailyData, startMs, endMs],
  )

  // ── Top products (sorted) ──
  const sortedTopProducts = useMemo(() => {
    const arr = [...topProducts]
    if (topProductSort === 'revenue') arr.sort((a, b) => b.revenueCents - a.revenueCents)
    else if (topProductSort === 'quantity') arr.sort((a, b) => b.qtySold - a.qtySold)
    else arr.sort((a, b) => b.profitCents - a.profitCents)
    return arr.slice(0, 5)
  }, [topProducts, topProductSort])

  // ── Chart title info ──
  const chartPeakEntry = useMemo(() => {
    if (chartData.length === 0) return null
    return chartData.reduce((best, cur) =>
      cur.totalCents > best.totalCents ? cur : best,
    )
  }, [chartData])

  const chartPeriodDesc = useMemo(() => {
    if (period === 'all') {
      return earliestSaleMs != null
        ? `${formatDateDisplay(earliestSaleMs)} — ${formatDateDisplay(endMs)}`
        : `Through ${formatDateDisplay(endMs)}`
    }
    const rangeMs = endMs - startMs
    const numDays = Math.ceil(rangeMs / ONE_DAY_MS)
    if (rangeMs <= ONE_DAY_MS) {
      const d = new Date(startMs)
      return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()} · hourly`
    }
    return `${formatDateDisplay(startMs)} · ${numDays} day${numDays !== 1 ? 's' : ''}`
  }, [period, startMs, endMs, earliestSaleMs])

  const exportModalRangeDescription = useMemo(() => {
    const label = getPeriodDisplayLabel(period)
    if (period === 'all') {
      if (earliestSaleMs != null) {
        return `${label} · ${formatDateDisplay(earliestSaleMs)} to ${formatDateDisplay(endMs)}`
      }
      return `${label} · through ${formatDateDisplay(endMs)}`
    }
    return `${label} · ${formatDateDisplay(startMs)} to ${formatDateDisplay(endMs)}`
  }, [period, startMs, endMs, earliestSaleMs])

  // ── Export handlers ──
  const handleExportPDF = useCallback(async () => {
    if (!business) return
    setIsExportingPDF(true)
    try {
      await exportReportPDF({
        business: {
          id: business.id,
          name: business.name,
          currency: business.currency,
          zigRatePerUsd: business.zigRatePerUsd,
        },
        period: getPeriodDisplayLabel(period),
        startDate: new Date(period === 'all' ? (earliestSaleMs != null ? earliestSaleMs : endMs) : startMs),
        endDate: new Date(endMs),
        totalRevenueCents,
        totalProfitCents,
        cogsCents,
        grossMarginPercent,
        transactionCount,
        totalQtySold,
        paymentBreakdown,
        topProducts,
      })
    } catch (err) {
      console.error('[Reports] PDF export error:', err)
    } finally {
      setIsExportingPDF(false)
    }
  }, [
    business,
    period,
    earliestSaleMs,
    startMs,
    endMs,
    totalRevenueCents,
    totalProfitCents,
    cogsCents,
    grossMarginPercent,
    transactionCount,
    totalQtySold,
    paymentBreakdown,
    topProducts,
    earliestSaleMs,
  ])

  const handleExportCSV = useCallback(async () => {
    if (!business) return
    setIsExportingCSV(true)
    try {
      await exportReportCSV({
        business: {
          id: business.id,
          name: business.name,
          currency: business.currency,
          zigRatePerUsd: business.zigRatePerUsd,
        },
        period: getPeriodDisplayLabel(period),
        startMs,
        endMs,
        businessId,
      })
    } catch (err) {
      console.error('[Reports] CSV export error:', err)
    } finally {
      setIsExportingCSV(false)
    }
  }, [business, period, startMs, endMs, businessId])

  const handleModalExport = useCallback(
    async (type: ExportType) => {
      if (type === 'pdf') await handleExportPDF()
      else await handleExportCSV()
    },
    [handleExportPDF, handleExportCSV],
  )

  // ── Margin health indicator ──
  const marginHealth = useMemo(() => {
    const m = grossMarginPercent
    if (m >= 30)
      return { icon: 'happy-outline' as const, color: THEME.success, label: 'Strong margins — great work!' }
    if (m >= 15)
      return { icon: 'thumbs-up-outline' as const, color: THEME.primary, label: 'Healthy margins' }
    if (m >= 5)
      return { icon: 'alert-circle-outline' as const, color: THEME.warning, label: 'Thin margins — watch your costs' }
    return { icon: 'warning-outline' as const, color: THEME.danger, label: 'Very low margins — review pricing' }
  }, [grossMarginPercent])

  const hasData = transactionCount > 0

  // ── Date picker handlers ──
  const onFromPickerChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === 'android') setShowFromPicker(false)
      if (event.type === 'set' && date) {
        setCustomStart(date > customEnd ? customEnd : date)
      }
    },
    [customEnd],
  )

  const onToPickerChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === 'android') setShowToPicker(false)
      if (event.type === 'set' && date) {
        setCustomEnd(date < customStart ? customStart : date)
      }
    },
    [customStart],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.root}>
      {/* Header */}
      <ScreenHeader
        title="Reports"
        showBorder
        rightAction={{
          icon: 'download-outline',
          onPress: () => setShowExportModal(true),
        }}
      />

      {/* Date range selector */}
      <View style={styles.dateSelector}>
        {/* Period pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsRow}
        >
          {PERIODS.map(p => (
            <TouchableOpacity
              key={p.key}
              style={[styles.pill, period === p.key && styles.pillActive]}
              onPress={() => setPeriod(p.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.pillText, period === p.key && styles.pillTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Date range display */}
        <Text style={styles.dateRangeText}>
          {period === 'all'
            ? earliestSaleMs != null
              ? `All time · ${formatDateDisplay(earliestSaleMs)} — ${formatDateDisplay(endMs)}`
              : `All time · through ${formatDateDisplay(endMs)}`
            : `${formatDateDisplay(startMs)} — ${formatDateDisplay(endMs)}`}
        </Text>

        {/* Custom date pickers */}
        {period === 'custom' && (
          <View style={styles.customPickerRow}>
            <TouchableOpacity
              style={styles.datePickerBtn}
              onPress={() => setShowFromPicker(true)}
            >
              <Text style={styles.datePickerBtnLabel}>From:</Text>
              <Text style={styles.datePickerBtnValue}>
                {formatDateDisplay(startOfDay(customStart))}
              </Text>
            </TouchableOpacity>
            <Text style={{ color: THEME.textSecondary, marginHorizontal: 8 }}>—</Text>
            <TouchableOpacity
              style={styles.datePickerBtn}
              onPress={() => setShowToPicker(true)}
            >
              <Text style={styles.datePickerBtnLabel}>To:</Text>
              <Text style={styles.datePickerBtnValue}>
                {formatDateDisplay(startOfDay(customEnd))}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* DateTimePicker overlays */}
      {showFromPicker && (
        <DateTimePicker
          value={customStart}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
          onChange={onFromPickerChange}
          maximumDate={customEnd}
        />
      )}
      {showToPicker && (
        <DateTimePicker
          value={customEnd}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
          onChange={onToPickerChange}
          minimumDate={customStart}
          maximumDate={new Date()}
        />
      )}

      {/* Main scroll content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={THEME.primary} />
          </View>
        ) : (
          <>
            {/* ── Section 1: Summary Cards ── */}
            <SectionLabel label="Summary" />
            <SummaryCards
              totalRevenueCents={totalRevenueCents}
              totalProfitCents={totalProfitCents}
              transactionCount={transactionCount}
              grossMarginPercent={grossMarginPercent}
              totalQtySold={totalQtySold}
              topProductCount={topProducts.length}
              avgSaleValueCents={avgSaleValueCents}
              currency={currency}
              zigRatePerUsd={zigRatePerUsd}
            />

            {/* ── Empty state ── */}
            {!hasData && (
              <Card padding="lg" style={{ marginBottom: 12 }}>
                <View style={{ alignItems: 'center' }}>
                  <Ionicons name="bar-chart-outline" size={48} color={THEME.border} />
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '600',
                      color: THEME.textPrimary,
                      marginTop: 12,
                      textAlign: 'center',
                    }}
                  >
                    No sales in this period
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: THEME.textSecondary,
                      textAlign: 'center',
                      marginTop: 4,
                    }}
                  >
                    Try selecting a different date range
                  </Text>
                  <View style={{ marginTop: 16 }}>
                    <Button
                      label="View All Time"
                      variant="primary"
                      size="sm"
                      fullWidth={false}
                      onPress={() => setPeriod('all')}
                    />
                  </View>
                </View>
              </Card>
            )}

            {/* ── Section 2: Payment Methods ── */}
            {hasData && (
              <>
                <SectionLabel label="Payment Methods" />
                <Card padding="md" style={{ marginBottom: 12 }}>
                  <PaymentMethodSection
                    breakdown={paymentBreakdown}
                    currency={currency}
                    zigRatePerUsd={zigRatePerUsd}
                  />
                </Card>
              </>
            )}

            {/* ── Section 3: Sales Analytics (chart) ── */}
            {hasData && (
              <>
                <SectionLabel label="Sales Analytics" />
                <Card padding="md" style={{ marginBottom: 12 }}>
                  {/* Chart title row */}
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 12,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 13, color: THEME.textSecondary }}>
                        {chartPeriodDesc}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          color: THEME.textSecondary,
                          marginTop: 4,
                          fontWeight: '500',
                        }}
                      >
                        {transactionCount} sale{transactionCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <ChartViewToggle
                        viewMode={chartViewMode}
                        onViewModeChange={setChartViewMode}
                      />
                      {chartPeakEntry != null && chartPeakEntry.totalCents > 0 && (
                        <Text
                          style={{
                            fontSize: 12,
                            color: THEME.textSecondary,
                            textAlign: 'right',
                            maxWidth: 140,
                            marginTop: 8,
                          }}
                          numberOfLines={2}
                        >
                          {'Peak: '}
                          {chartPeakEntry.label !== ''
                            ? chartPeakEntry.label
                            : `Hr ${new Date(chartPeakEntry.date).getHours()}`}
                          {' · '}
                          {formatCurrency(chartPeakEntry.totalCents, currency, zigRatePerUsd)}
                        </Text>
                      )}
                    </View>
                  </View>
                  <SalesChart
                    data={chartData}
                    selectedBar={selectedBar}
                    onSelectBar={setSelectedBar}
                    currency={currency}
                    zigRatePerUsd={zigRatePerUsd}
                    viewMode={chartViewMode}
                  />
                </Card>
              </>
            )}

            {/* ── Section 4: Top Products ── */}
            {hasData && (
              <>
                <SectionLabel label="Top Products" />
                <TopProductsSection
                  products={sortedTopProducts}
                  sort={topProductSort}
                  onSortChange={setTopProductSort}
                  currency={currency}
                  zigRatePerUsd={zigRatePerUsd}
                />
              </>
            )}

            {/* ── Section 5: Profit Analysis ── */}
            {hasData && (
              <>
                <SectionLabel label="Profit Analysis" />
                <Card padding="md" style={{ marginBottom: 12 }}>
                  <ProfitAnalysisSection
                    totalRevenueCents={totalRevenueCents}
                    cogsCents={cogsCents}
                    totalProfitCents={totalProfitCents}
                    grossMarginPercent={grossMarginPercent}
                    avgProfitCents={avgProfitCents}
                    marginHealth={marginHealth}
                    currency={currency}
                    zigRatePerUsd={zigRatePerUsd}
                  />
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Fixed bottom export bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.bottomBtn, styles.bottomBtnSecondary, { opacity: isExportingPDF ? 0.6 : 1 }]}
          onPress={handleExportPDF}
          disabled={isExportingPDF || isExportingCSV}
          activeOpacity={0.85}
        >
          {isExportingPDF ? (
            <ActivityIndicator size="small" color={THEME.primary} />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={18} color={THEME.primary} />
              <Text style={[styles.bottomBtnText, { color: THEME.primary }]}>Export PDF</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bottomBtn, styles.bottomBtnPrimary, { opacity: isExportingCSV ? 0.6 : 1 }]}
          onPress={handleExportCSV}
          disabled={isExportingPDF || isExportingCSV}
          activeOpacity={0.85}
        >
          {isExportingCSV ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="grid-outline" size={18} color="#FFFFFF" />
              <Text style={[styles.bottomBtnText, { color: '#FFFFFF' }]}>Export CSV</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Export options modal */}
      <ExportOptionsModal
        visible={showExportModal}
        onClose={() => setShowExportModal(false)}
        rangeDescription={exportModalRangeDescription}
        onExport={handleModalExport}
      />

      <ReportsTutorialModal
        visible={showTutorial}
        ownerName={business?.ownerName ?? undefined}
        onComplete={() => {
          setShowTutorial(false)
          if (businessId) {
            void SecureStore.setItemAsync(`reports_tutorial_shown_${businessId}`, 'true')
          }
        }}
        onDismiss={() => {
          setShowTutorial(false)
          if (businessId) {
            void SecureStore.setItemAsync(`reports_tutorial_shown_${businessId}`, 'true')
          }
        }}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Sub-section components (defined outside main to avoid re-creation)
// ---------------------------------------------------------------------------

interface SummaryCardsProps {
  totalRevenueCents: number
  totalProfitCents: number
  transactionCount: number
  grossMarginPercent: number
  totalQtySold: number
  topProductCount: number
  avgSaleValueCents: number
  currency: string
  zigRatePerUsd: number
}

function SummaryCards({
  totalRevenueCents,
  totalProfitCents,
  transactionCount,
  grossMarginPercent,
  totalQtySold,
  topProductCount,
  avgSaleValueCents,
  currency,
  zigRatePerUsd,
}: SummaryCardsProps) {
  const { width } = useWindowDimensions()
  const cardWidth = (width - 32 - 10) / 2

  const profitVariant =
    totalProfitCents > 0 ? 'success' : totalProfitCents < 0 ? ('danger' as const) : ('default' as const)

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
      <View style={{ width: cardWidth }}>
        <MetricCard
          label="Total Revenue"
          value={formatCurrency(totalRevenueCents, currency, zigRatePerUsd)}
          subValue={`${transactionCount} transaction${transactionCount !== 1 ? 's' : ''}`}
          variant={totalRevenueCents > 0 ? 'success' : 'default'}
          icon={
            <Ionicons
              name="trending-up"
              size={20}
              color={totalRevenueCents > 0 ? THEME.success : THEME.textSecondary}
            />
          }
        />
      </View>
      <View style={{ width: cardWidth }}>
        <MetricCard
          label="Total Profit"
          value={formatCurrency(totalProfitCents, currency, zigRatePerUsd)}
          subValue={`${grossMarginPercent}% margin`}
          variant={profitVariant}
          icon={
            <Ionicons
              name="analytics"
              size={20}
              color={
                profitVariant === 'success'
                  ? THEME.success
                  : profitVariant === 'danger'
                  ? THEME.danger
                  : THEME.textSecondary
              }
            />
          }
        />
      </View>
      <View style={{ width: cardWidth }}>
        <MetricCard
          label="Items Sold"
          value={`${formatQty(totalQtySold)} units`}
          subValue={`${topProductCount} product${topProductCount !== 1 ? 's' : ''}`}
          variant="default"
          icon={<Ionicons name="cube" size={20} color={THEME.textSecondary} />}
        />
      </View>
      <View style={{ width: cardWidth }}>
        <MetricCard
          label="Avg Sale Value"
          value={formatCurrency(avgSaleValueCents, currency, zigRatePerUsd)}
          subValue="per transaction"
          variant="default"
          icon={<Ionicons name="receipt" size={20} color={THEME.textSecondary} />}
        />
      </View>
    </View>
  )
}

function PaymentMethodSection({
  breakdown,
  currency,
  zigRatePerUsd,
}: {
  breakdown: PaymentBreakdownItem[]
  currency: string
  zigRatePerUsd: number
}) {
  if (breakdown.length === 0) {
    return (
      <View style={{ paddingVertical: 16, alignItems: 'center' }}>
        <Text style={{ fontSize: 13, color: THEME.textSecondary }}>No sales in this period</Text>
      </View>
    )
  }

  return (
    <View>
      {breakdown.map((item, idx) => {
        const barColor = PAYMENT_COLORS[item.method] ?? THEME.primary
        const isLast = idx === breakdown.length - 1
        return (
          <View key={item.method}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 8,
                borderBottomWidth: isLast ? 0 : 0.5,
                borderBottomColor: '#F4F6FB',
              }}
            >
              {/* Left: dot + label */}
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: barColor,
                    marginRight: 8,
                  }}
                />
                <Text style={{ fontSize: 14, color: THEME.textPrimary }}>
                  {formatPaymentMethod(item.method)}
                </Text>
              </View>
              {/* Right: amount + count */}
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: THEME.textPrimary }}>
                  {formatCurrency(item.totalCents, currency, zigRatePerUsd)}
                </Text>
                <Text style={{ fontSize: 12, color: THEME.textSecondary }}>
                  {item.count} sale{item.count !== 1 ? 's' : ''} · {item.percent}%
                </Text>
              </View>
            </View>
            {/* Progress bar */}
            <View
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: '#F4F6FB',
                marginBottom: isLast ? 0 : 4,
              }}
            >
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: barColor,
                  width: `${item.percent}%`,
                }}
              />
            </View>
          </View>
        )
      })}
    </View>
  )
}

interface TopProductsSectionProps {
  products: TopProduct[]
  sort: TopProductSort
  onSortChange: (s: TopProductSort) => void
  currency: string
  zigRatePerUsd: number
}

const TOP_PRODUCTS_SORT_TABS: { key: TopProductSort; label: string }[] = [
  { key: 'revenue', label: 'By Revenue' },
  { key: 'quantity', label: 'By Quantity' },
  { key: 'profit', label: 'By Profit' },
]

function TopProductsSection({ products, sort, onSortChange, currency, zigRatePerUsd }: TopProductsSectionProps) {
  const sortTabs = TOP_PRODUCTS_SORT_TABS

  const topValue = products.length > 0
    ? sort === 'revenue'
      ? products[0].revenueCents
      : sort === 'quantity'
      ? products[0].qtySold
      : Math.abs(products[0].profitCents)
    : 1

  if (products.length === 0) {
    return (
      <Card padding="md" style={{ marginBottom: 12 }}>
        <View style={{ paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: THEME.textSecondary }}>
            No sales data for this period
          </Text>
        </View>
      </Card>
    )
  }

  return (
    <View>
      {/* Sort tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 8 }}
      >
        {sortTabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.sortPill, sort === tab.key && styles.sortPillActive]}
            onPress={() => onSortChange(tab.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.sortPillText, sort === tab.key && styles.sortPillTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Product rows */}
      {products.map((product, idx) => {
        let primaryValue: string
        let primaryColor: string
        let secondaryValue: string

        if (sort === 'revenue') {
          primaryValue = formatCurrency(product.revenueCents, currency, zigRatePerUsd)
          primaryColor = THEME.primary
          secondaryValue = `${formatQty(product.qtySold)} sold`
        } else if (sort === 'quantity') {
          primaryValue = `${formatQty(product.qtySold)} units`
          primaryColor = THEME.textPrimary
          secondaryValue = `${formatCurrency(product.revenueCents, currency, zigRatePerUsd)} revenue`
        } else {
          primaryValue = formatCurrency(product.profitCents, currency, zigRatePerUsd)
          primaryColor = product.profitCents >= 0 ? THEME.success : THEME.danger
          secondaryValue = `${product.marginPercent}% margin`
        }

        const barValue =
          sort === 'revenue'
            ? product.revenueCents
            : sort === 'quantity'
            ? product.qtySold
            : Math.abs(product.profitCents)

        const barPercent = topValue > 0 ? Math.min(100, (barValue / topValue) * 100) : 0

        return (
          <Card padding="md" style={{ marginBottom: 8 }} key={product.productId}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {/* Left: rank + name */}
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: '700',
                    color: THEME.primary,
                    width: 28,
                  }}
                >
                  {idx + 1}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '600',
                      color: THEME.textPrimary,
                    }}
                    numberOfLines={1}
                  >
                    {product.productName}
                  </Text>
                  <Text style={{ fontSize: 12, color: THEME.textSecondary }}>
                    {formatQty(product.qtySold)} units sold
                  </Text>
                </View>
              </View>
              {/* Right: metric */}
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: '700',
                    color: primaryColor,
                  }}
                >
                  {primaryValue}
                </Text>
                <Text style={{ fontSize: 12, color: THEME.textSecondary }}>{secondaryValue}</Text>
              </View>
            </View>
            {/* Progress bar */}
            <View
              style={{
                height: 3,
                borderRadius: 2,
                backgroundColor: '#F4F6FB',
                marginTop: 8,
              }}
            >
              <View
                style={{
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: THEME.primary,
                  width: `${barPercent}%`,
                }}
              />
            </View>
          </Card>
        )
      })}
    </View>
  )
}

interface ProfitAnalysisSectionProps {
  totalRevenueCents: number
  cogsCents: number
  totalProfitCents: number
  grossMarginPercent: number
  avgProfitCents: number
  marginHealth: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; label: string }
  currency: string
  zigRatePerUsd: number
}

function ProfitAnalysisSection({
  totalRevenueCents,
  cogsCents,
  totalProfitCents,
  grossMarginPercent,
  avgProfitCents,
  marginHealth,
  currency,
  zigRatePerUsd,
}: ProfitAnalysisSectionProps) {
  const profitColor =
    totalProfitCents > 0 ? THEME.success : totalProfitCents < 0 ? THEME.danger : THEME.textSecondary

  return (
    <View>
      {/* Revenue row */}
      <View style={styles.profitRow}>
        <Text style={{ fontSize: 14, color: THEME.textPrimary }}>Total Revenue</Text>
        <Text style={{ fontSize: 14, color: THEME.textPrimary }}>
          {formatCurrency(totalRevenueCents, currency, zigRatePerUsd)}
        </Text>
      </View>

      {/* COGS row */}
      <View style={styles.profitRow}>
        <Text style={{ fontSize: 14, color: THEME.danger }}>Cost of Goods Sold</Text>
        <Text style={{ fontSize: 14, color: THEME.danger }}>
          − {formatCurrency(cogsCents, currency, zigRatePerUsd)}
        </Text>
      </View>

      {/* Divider */}
      <View style={{ height: 1, backgroundColor: THEME.textPrimary, opacity: 0.15, marginVertical: 8 }} />

      {/* Gross profit */}
      <View style={styles.profitRow}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: profitColor }}>Gross Profit</Text>
        <Text style={{ fontSize: 15, fontWeight: '600', color: profitColor }}>
          {formatCurrency(totalProfitCents, currency, zigRatePerUsd)}
        </Text>
      </View>

      {/* Margin % */}
      <View style={styles.profitRow}>
        <Text style={{ fontSize: 14, color: profitColor }}>Profit Margin</Text>
        <Text style={{ fontSize: 14, color: profitColor }}>{grossMarginPercent}%</Text>
      </View>

      {/* Avg profit per sale */}
      <View style={styles.profitRow}>
        <Text style={{ fontSize: 14, color: THEME.textSecondary }}>Avg Profit Per Sale</Text>
        <Text style={{ fontSize: 14, color: THEME.textSecondary }}>
          {formatCurrency(avgProfitCents, currency, zigRatePerUsd)}
        </Text>
      </View>

      {/* Margin health indicator */}
      <View
        style={{
          backgroundColor: '#F4F6FB',
          borderRadius: 8,
          padding: 10,
          marginTop: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Ionicons name={marginHealth.icon} size={20} color={marginHealth.color} />
        <Text
          style={{ fontSize: 13, fontWeight: '500', color: marginHealth.color, flex: 1 }}
        >
          {marginHealth.label}
        </Text>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100,
  },

  // Date range selector
  dateSelector: {
    backgroundColor: THEME.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    paddingVertical: 12,
  },
  pillsRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  pill: {
    backgroundColor: THEME.bg,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  pillActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '500',
    color: THEME.textSecondary,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  dateRangeText: {
    fontSize: 13,
    color: THEME.textSecondary,
    textAlign: 'center',
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  customPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  datePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
  },
  datePickerBtnLabel: {
    fontSize: 13,
    color: THEME.textSecondary,
  },
  datePickerBtnValue: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.primary,
  },

  // Sort tabs (top products)
  sortPill: {
    backgroundColor: THEME.bg,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  sortPillActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary,
  },
  sortPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: THEME.textSecondary,
  },
  sortPillTextActive: {
    color: '#FFFFFF',
  },

  chartToggleTrack: {
    flexDirection: 'row',
    backgroundColor: THEME.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: CHART_TOGGLE_PADDING,
    width: CHART_TOGGLE_SEGMENT * 2 + CHART_TOGGLE_PADDING * 2,
  },
  chartToggleSlider: {
    position: 'absolute',
    top: CHART_TOGGLE_PADDING,
    left: CHART_TOGGLE_PADDING,
    width: CHART_TOGGLE_SEGMENT,
    height: CHART_TOGGLE_SEGMENT,
    backgroundColor: THEME.primary,
    borderRadius: 6,
  },
  chartToggleSegment: {
    width: CHART_TOGGLE_SEGMENT,
    height: CHART_TOGGLE_SEGMENT,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },

  // Profit analysis rows
  profitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },

  // Bottom export bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: THEME.card,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    gap: 10,
  },
  bottomBtn: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bottomBtnPrimary: {
    backgroundColor: THEME.primary,
  },
  bottomBtnSecondary: {
    backgroundColor: THEME.card,
    borderWidth: 1,
    borderColor: THEME.primary,
  },
  bottomBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Export modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: THEME.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: THEME.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  exportCard: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  exportCardSelected: {
    borderWidth: 2,
    borderColor: THEME.primary,
  },
  exportCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: THEME.textPrimary,
    marginTop: 8,
    textAlign: 'center',
  },
  exportCardDesc: {
    fontSize: 13,
    color: THEME.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
})
