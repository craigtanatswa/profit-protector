/*
 * Supabase setup (SQL Editor):
 * - Account deletion + clear data: run `supabase/sql/account_lifecycle.sql`
 * - Deploy the `delete-account` Edge Function (service role deletes auth user after RPC).
 * Optional audit trail for delete requests:
 *   create table if not exists deletion_requests (...); -- see git history or support docs
 *
 * -- ZiG per $1 USD (display conversion; ledger stays USD cents)
 * alter table businesses add column if not exists zig_rate_per_usd numeric default 1;
 *
 * -- Recovery email (run in Supabase SQL Editor)
 * alter table businesses add column if not exists recovery_email text;
 * alter table businesses add column if not exists recovery_email_verified boolean not null default false;
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import * as Clipboard from 'expo-clipboard'

import { Badge, Button, LoadingScreen } from '../../../src/components/ui'
import { BrandLogo, ScreenHeader } from '../../../src/components/layout'
import { DeferredSettingsModals } from '../../../src/components/settings/DeferredSettingsModals'
import { SettingsTutorialModal } from '../../../src/components/settings/SettingsTutorialModal'
import { SettingsRow } from '../../../src/components/settings/SettingsRow'
import { SettingsSection } from '../../../src/components/settings/SettingsSection'
import { useAuthStore } from '../../../src/stores/authStore'
import { supabase } from '../../../src/lib/supabase'
import { logActivity } from '../../../src/lib/activityLogger'
import { formatDate, formatDateTime, maskEmail } from '../../../src/lib/formatters'
import { getBusinessLogoDisplayUri } from '../../../src/lib/businessLogo'
import { useDeferredSettingsStats } from '../../../src/hooks/useDeferredSettingsStats'
import { useSubscription } from '../../../src/hooks/useSubscription'
import { formatPlanPrice, PLANS } from '../../../src/lib/plans'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getSyncIconColor(status: string): string {
  if (status === 'syncing') return '#0047AB'
  if (status === 'error') return '#C0152A'
  return '#0A7A4B'
}

function getSyncIconBg(status: string): string {
  if (status === 'syncing') return '#E6EEFF'
  if (status === 'error') return '#FCEBEB'
  return '#EAF3DE'
}

function getSyncValueText(status: string, lastSyncedAt: number | null): string {
  if (status === 'syncing') return 'Syncing...'
  if (status === 'error') return 'Sync failed'
  if (status === 'success' && lastSyncedAt) return `Synced ${timeAgo(lastSyncedAt)}`
  return 'Up to date'
}

function formatSubsBillingMethod(pm: string | null | undefined): string {
  const raw = (pm ?? '').trim().toLowerCase()
  if (raw.includes('ecocash')) return 'EcoCash'
  if (raw.includes('onemoney') || raw.includes('one_money')) return 'OneMoney'
  if (raw.includes('innbucks')) return 'InnBucks'
  if (raw.includes('card')) return 'Visa / Mastercard'
  return raw.length > 0 ? (pm ?? '') : '—'
}


function LazyShopkeeperSettings() {
  const [View, setView] = useState<React.ComponentType | null>(null)

  useEffect(() => {
    void import('../../../src/components/settings/ShopkeeperSettingsView').then((m) => {
      setView(() => m.ShopkeeperSettingsView)
    })
  }, [])

  if (!View) {
    return (
      <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Settings" showBorder />
      </SafeAreaView>
    )
  }

  return <View />
}

// ---------------------------------------------------------------------------
// Main Settings Screen
// ---------------------------------------------------------------------------

function SettingsScreen() {
  const router = useRouter()
  const { focus: focusParam } = useLocalSearchParams<{ focus?: string }>()
  const business = useAuthStore((s) => s.business)
  const user = useAuthStore((s) => s.user)
  const activeRole = useAuthStore((s) => s.activeRole)
  const setBusiness = useAuthStore((s) => s.setBusiness)
  const logout = useAuthStore((s) => s.logout)
  const syncStatus = useAuthStore((s) => s.syncStatus)
  const lastSyncedAt = useAuthStore((s) => s.lastSyncedAt)
  const triggerSync = useAuthStore((s) => s.triggerSync)

  const {
    subscription,
    daysRemainingInTrial,
    isTrialExpired,
    nextBillingDate,
    planTier,
    maxShopkeepers,
    canUpgrade,
  } = useSubscription()

  const currentPlan = PLANS[planTier]
  const isProPlus = planTier === 'pro_plus'

  // Modal visibility
  const [editBizVisible, setEditBizVisible] = useState(false)
  const [currencyVisible, setCurrencyVisible] = useState(false)
  const [receiptVisible, setReceiptVisible] = useState(false)
  const [logoModalVisible, setLogoModalVisible] = useState(false)
  const [changePassVisible, setChangePassVisible] = useState(false)
  const [addEmailVisible, setAddEmailVisible] = useState(false)
  const [deleteVisible, setDeleteVisible] = useState(false)
  const [clearDataVisible, setClearDataVisible] = useState(false)
  const [businessIdCopied, setBusinessIdCopied] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)

  const scrollRef = useRef<ScrollView>(null)
  const securitySectionY = useRef(0)

  const [heroLogoUri, setHeroLogoUri] = useState<string | null>(null)
  const refreshLogo = useCallback(() => {
    setHeroLogoUri(getBusinessLogoDisplayUri())
  }, [])

  useFocusEffect(
    useCallback(() => {
      refreshLogo()
    }, [refreshLogo]),
  )

  useFocusEffect(
    useCallback(() => {
      if (focusParam !== 'security' || securitySectionY.current <= 0) return
      const y = Math.max(0, securitySectionY.current - 24)
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y, animated: true })
      })
    }, [focusParam]),
  )

  // Notification settings
  const [lowStockAlertsEnabled, setLowStockAlertsEnabled] = useState(true)
  const [dailySummaryEnabled, setDailySummaryEnabled] = useState(false)

  // Restore state
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState('Restoring your data...')

  const stats = useDeferredSettingsStats(business?.id, user?.id)

  const anyModalVisible =
    editBizVisible ||
    currencyVisible ||
    receiptVisible ||
    logoModalVisible ||
    addEmailVisible ||
    changePassVisible ||
    deleteVisible ||
    clearDataVisible

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      void SecureStore.getItemAsync('setting_low_stock_alerts').then((v) => {
        setLowStockAlertsEnabled(v !== 'false')
      })
      void SecureStore.getItemAsync('setting_daily_summary').then((v) => {
        setDailySummaryEnabled(v === 'true')
      })
    })
    return () => task.cancel()
  }, [])

  // Show the settings tutorial once on the owner's first visit.
  useEffect(() => {
    if (activeRole === 'shopkeeper' || !business?.id) return
    let cancelled = false
    void (async () => {
      const key = `settings_tutorial_shown_${business.id}`
      const seen = await SecureStore.getItemAsync(key)
      if (!cancelled && seen !== 'true') {
        setShowTutorial(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeRole, business?.id])

  const toggleLowStock = useCallback(async (val: boolean) => {
    setLowStockAlertsEnabled(val)
    await SecureStore.setItemAsync('setting_low_stock_alerts', String(val))
  }, [])

  const toggleDailySummary = useCallback(async (val: boolean) => {
    setDailySummaryEnabled(val)
    await SecureStore.setItemAsync('setting_daily_summary', String(val))
  }, [])

  const handleSyncNow = useCallback(() => {
    if (business?.id) triggerSync(business.id)
  }, [business?.id, triggerSync])

  const handleBackupNow = useCallback(async () => {
    if (!business?.id) return
    try {
      await triggerSync(business.id)
      Alert.alert('Backup Complete', 'All your data is safely stored in the cloud.')
    } catch {
      Alert.alert('Backup Failed', 'Could not back up data. Please try again.')
    }
  }, [business?.id, triggerSync])

  const handleRestoreFromCloud = useCallback(() => {
    Alert.alert(
      'Restore from Cloud?',
      'This will replace all local data with your cloud backup. Any unsynced local changes will be lost. Make sure you have synced first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            if (!business?.id) return
            setRestoreMessage('Restoring your data...')
            setIsRestoring(true)
            try {
              const { syncAll } = await import('../../../src/lib/sync')
              await syncAll(business.id)
              router.replace('/(app)')
            } catch {
              Alert.alert('Restore Failed', 'Could not restore data. Please try again.')
              setIsRestoring(false)
            }
          },
        },
      ],
    )
  }, [business?.id, router])

  const handleExportAll = useCallback(async () => {
    if (!business) return
    try {
      const { exportReportCSV } = await import('../../../src/lib/reportCSV')
      await exportReportCSV({
        business: {
          id: business.id,
          name: business.name,
          currency: business.currency,
          zigRatePerUsd: business.zigRatePerUsd,
        },
        period: 'All Time',
        startMs: 0,
        endMs: Date.now(),
        businessId: business.id,
      })
      await logActivity({ action: 'data_exported', entityType: 'report', entityName: 'All data CSV' })
    } catch (err) {
      Alert.alert('Export Failed', (err as Error)?.message ?? 'Could not export data.')
    }
  }, [business])

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign Out?',
      'Your data is safely backed up. You can sign back in anytime on any device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await logActivity({ action: 'account_logout', entityType: 'account' })
            await supabase.auth.signOut()
            logout()
            router.replace('/(auth)/login')
          },
        },
      ],
    )
  }, [logout, router])

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account?',
      'This will permanently remove your login, business profile, and every record in the cloud and on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => setDeleteVisible(true),
        },
      ],
    )
  }, [])

  const handleClearBusinessData = useCallback(() => {
    Alert.alert(
      'Clear all data?',
      'This removes inventory, sales, and customers from the cloud and this phone. Your account and business settings stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => setClearDataVisible(true) },
      ],
    )
  }, [])

  const publicId = business?.publicId ?? (business?.id ? `pp-${business.id.slice(0, 8).toLowerCase()}` : '')

  const copyBusinessId = useCallback(async () => {
    if (!publicId) return
    await Clipboard.setStringAsync(publicId)
    setBusinessIdCopied(true)
    setTimeout(() => setBusinessIdCopied(false), 2000)
  }, [publicId])

  if (activeRole === 'shopkeeper') {
    return <LazyShopkeeperSettings />
  }

  if (isRestoring) {
    return <LoadingScreen message={restoreMessage} />
  }

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title="Settings" showBorder />

      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Business Profile Hero ── */}
        <View style={s.hero}>
          <TouchableOpacity style={s.profileCard} onPress={() => setEditBizVisible(true)} activeOpacity={0.8}>
            {/* Avatar / Logo */}
            <View style={s.profileAvatarWrap}>
              {heroLogoUri ? (
                <Image source={{ uri: heroLogoUri }} style={s.profileLogo} resizeMode="contain" />
              ) : (
                <BrandLogo variant="mark" color="blue" width={36} height={36} onBlueBackground />
              )}
            </View>
            {/* Info */}
            <View style={s.profileInfo}>
              <Text style={s.profileName} numberOfLines={1}>{business?.ownerName ?? business?.name ?? 'My Business'}</Text>
              <Text style={s.profileRole}>Business Owner</Text>
            </View>
            {/* Chevron */}
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>

        {/* ── Stats Row ── */}
        <View style={s.statsCard}>
          <View style={s.statCol}>
            <Text style={[s.statValue, { color: '#0047AB' }]}>{stats.totalSales}</Text>
            <Text style={s.statLabel}>Total Sales</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={s.statValue}>{stats.productCount}</Text>
            <Text style={s.statLabel}>Products</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={[s.statValue, { fontSize: 16 }]}>{stats.memberSince || '—'}</Text>
            <Text style={s.statLabel}>Since</Text>
          </View>
        </View>

        {/* ── Subscription (owner) ── */}
        {subscription?.status === 'active' || subscription?.status === 'grace' ? (
          <View style={isProPlus ? sub.activeCardProPlus : sub.activeCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={isProPlus ? sub.activeTitleProPlus : sub.activeTitle}>
                  Profit Protector {currentPlan.label}
                </Text>
                <Text style={isProPlus ? sub.activeTaglineProPlus : sub.activeTagline}>
                  {currentPlan.tagline}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <View style={isProPlus ? sub.paidBadgeProPlus : sub.paidBadge}>
                    <Text style={sub.paidBadgeTxt}>Active</Text>
                  </View>
                  {subscription?.status === 'grace' ? (
                    <Text style={isProPlus ? sub.smallProPlus : sub.smallGreen}>Grace access</Text>
                  ) : null}
                </View>
              </View>
              <Ionicons
                name="shield-checkmark"
                size={32}
                color={isProPlus ? '#7C3AED' : '#0A7A4B'}
              />
            </View>
            <View style={isProPlus ? sub.divProPlus : sub.divGreen} />
            <View style={sub.rowKV}>
              <Text style={isProPlus ? sub.kProPlus : sub.k}>Staff accounts</Text>
              <Text style={isProPlus ? sub.vProPlus : sub.v}>
                Up to {maxShopkeepers} staff member{maxShopkeepers === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={sub.rowKV}>
              <Text style={isProPlus ? sub.kProPlus : sub.k}>Next renewal</Text>
              <Text style={isProPlus ? sub.vProPlus : sub.v}>
                {nextBillingDate != null && !Number.isNaN(nextBillingDate.getTime())
                  ? formatDate(nextBillingDate.getTime())
                  : '—'}
              </Text>
            </View>
            <View style={sub.rowKV}>
              <Text style={isProPlus ? sub.kProPlus : sub.k}>Monthly</Text>
              <Text style={isProPlus ? sub.vProPlus : sub.v}>
                {formatPlanPrice(planTier)} / month
              </Text>
            </View>
            <View style={sub.rowKV}>
              <Text style={isProPlus ? sub.kProPlus : sub.k}>Payment method</Text>
              <Text style={isProPlus ? sub.vProPlus : sub.v}>
                {formatSubsBillingMethod(subscription.paymentMethod)}
              </Text>
            </View>
            {canUpgrade && (
              <TouchableOpacity
                onPress={() => router.push('/(app)/settings/upgrade-plan')}
                style={sub.upgradeBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-up-circle-outline" size={16} color="#7C3AED" />
                <Text style={sub.upgradeBtnText}>Upgrade to Pro+</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : subscription?.status === 'trial' && !isTrialExpired ? (
          <View style={sub.trialCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={sub.trialTitle}>Free Trial</Text>
              <View style={sub.amberBadge}>
                <Text style={sub.amberBadgeTxt}>Active</Text>
              </View>
            </View>
            <Text style={sub.trialLine}>
              Trial ends:{` `}
              {(() => {
                const t =
                  subscription != null ? Date.parse(subscription.trialEnd) : NaN
                return Number.isFinite(t) ? formatDate(t) : '—'
              })()}
            </Text>
            <Text style={sub.trialLine}>{daysRemainingInTrial} days remaining</Text>
            <View style={{ marginTop: 12 }}>
              <Button
                label={`Subscribe now — ${formatPlanPrice('pro')}/mo`}
                variant="primary"
                size="sm"
                fullWidth
                onPress={() => router.push('/(app)/paywall')}
              />
            </View>
          </View>
        ) : subscription != null ? (
          <View style={sub.expiredCard}>
            <Text style={sub.expiredTitle}>Trial Expired</Text>
            <Text style={sub.expiredSub}>Subscribe to keep access to your data</Text>
            <View style={{ marginTop: 14 }}>
              <Button
                label="Subscribe Now"
                variant="danger"
                size="md"
                fullWidth
                onPress={() => router.push('/(app)/paywall')}
              />
            </View>
          </View>
        ) : null}

        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <SettingsRow
            icon="receipt-outline"
            label="Payment History"
            description="View past payments"
            onPress={() => router.push('/(app)/settings/payments')}
          />
        </View>

        {/* ── Section 1: Business ── */}
        <SettingsSection title="Business">
          <SettingsRow
            icon="business-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Business Profile"
            description="Name, type, contact details"
            onPress={() => setEditBizVisible(true)}
          />
          <SettingsRow
            icon="key-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Business ID"
            showChevron={false}
            rightElement={
              <View style={s.businessIdRight}>
                <Text style={s.businessIdText}>{publicId || '—'}</Text>
                <TouchableOpacity style={s.copyBtn} onPress={copyBusinessId}>
                  <Text style={s.copyBtnText}>{businessIdCopied ? 'Copied!' : 'Copy'}</Text>
                </TouchableOpacity>
              </View>
            }
          />
          <SettingsRow
            icon="cash-outline"
            iconColor="#0A7A4B"
            iconBackground="#EAF3DE"
            label="Currency Settings"
            value={business?.currency ?? 'USD'}
            onPress={() => setCurrencyVisible(true)}
          />
          <SettingsRow
            icon="receipt-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Receipt Settings"
            description="Receipt number format, footer message"
            onPress={() => setReceiptVisible(true)}
          />
          <SettingsRow
            icon="image-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Business Logo"
            description="Shown on PDF reports and receipt headers"
            value={heroLogoUri ? 'Added' : undefined}
            onPress={() => setLogoModalVisible(true)}
          />
        </SettingsSection>

        {/* ── Section 2: Staff & Security ── */}
        <SettingsSection title="Staff & Security">
          <SettingsRow
            icon="people-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Manage Staff"
            description="Add or remove staff accounts"
            value="Manage"
            onPress={() => router.push('/(app)/settings/manage-staff')}
          />
          <SettingsRow
            icon="list-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Activity Log"
            description="Every action recorded here"
            onPress={() => router.push('/(app)/settings/activity-log')}
          />
        </SettingsSection>

        {/* ── Section 3: Sync & Backup ── */}
        <SettingsSection title="Sync & Backup">
          <SettingsRow
            icon="sync-outline"
            iconColor={getSyncIconColor(syncStatus)}
            iconBackground={getSyncIconBg(syncStatus)}
            label="Sync Status"
            value={getSyncValueText(syncStatus, lastSyncedAt)}
            showChevron={false}
            rightElement={
              syncStatus === 'syncing' ? (
                <ActivityIndicator size="small" color="#0047AB" style={{ marginLeft: 8 }} />
              ) : undefined
            }
          />
          <SettingsRow
            icon="cloud-upload-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Sync Now"
            description="Upload all local changes to cloud"
            onPress={handleSyncNow}
            disabled={syncStatus === 'syncing'}
            rightElement={
              syncStatus === 'syncing' ? (
                <ActivityIndicator size="small" color="#0047AB" style={{ marginRight: 8 }} />
              ) : undefined
            }
          />
          <SettingsRow
            icon="time-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Last Synced"
            value={lastSyncedAt ? formatDateTime(lastSyncedAt) : 'Never'}
            showChevron={false}
          />
          <SettingsRow
            icon="cloud-done-outline"
            iconColor="#0A7A4B"
            iconBackground="#EAF3DE"
            label="Backup Now"
            description="Save all data to cloud immediately"
            onPress={handleBackupNow}
          />
          <SettingsRow
            icon="cloud-download-outline"
            iconColor="#B45309"
            iconBackground="#FFF8F0"
            label="Restore from Cloud"
            description="Overwrite local data with cloud data"
            onPress={handleRestoreFromCloud}
          />
        </SettingsSection>

        {/* ── Section 3: Data Management ── */}
        <SettingsSection title="Data Management">
          <SettingsRow
            icon="download-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Export All Data"
            description="Download complete business data as CSV"
            onPress={handleExportAll}
          />
          <SettingsRow
            icon="cube-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Manage Products"
            value={`${stats.productCount} products`}
            onPress={() => router.push('/(app)/inventory')}
          />
          <SettingsRow
            icon="people-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Manage Customers"
            value={`${stats.customerCount} customers`}
            onPress={() => router.push('/(app)/customers')}
          />
        </SettingsSection>

        {/* ── Section 4: Security ── */}
        <View
          onLayout={(e) => {
            securitySectionY.current = e.nativeEvent.layout.y
          }}
        >
          <SettingsSection title="Security">
            <SettingsRow
              icon="mail-outline"
              iconColor="#0047AB"
              iconBackground="#E6EEFF"
              label="Recovery Email"
              description={
                business?.recoveryEmail != null &&
                business.recoveryEmail.trim() !== ''
                  ? undefined
                  : 'Add email for account recovery'
              }
              value={
                business?.recoveryEmail != null && business.recoveryEmail.trim() !== ''
                  ? undefined
                  : 'Not set'
              }
              showChevron={false}
              rightElement={
                business?.recoveryEmail != null && business.recoveryEmail.trim() !== '' ? (
                  <View style={s.recoveryEmailRight}>
                    <Text style={s.recoveryEmailValue} numberOfLines={1}>
                      {maskEmail(business.recoveryEmail.trim())}
                    </Text>
                    <Badge
                      variant={business.recoveryEmailVerified ? 'success' : 'warning'}
                      label={business.recoveryEmailVerified ? 'Verified' : 'Unverified'}
                      size="sm"
                    />
                  </View>
                ) : undefined
              }
              onPress={() => setAddEmailVisible(true)}
            />
            <SettingsRow
              icon="lock-closed-outline"
              iconColor="#0047AB"
              iconBackground="#E6EEFF"
              label="Change Password"
              description="Update your login password"
              onPress={() => setChangePassVisible(true)}
            />
            <SettingsRow
              icon="call-outline"
              iconColor="#5A6A8A"
              iconBackground="#F4F6FB"
              label="Phone Number"
              value={business?.phone}
              showChevron={false}
              description="Contact support to change phone number"
            />
          </SettingsSection>
        </View>

        {/* ── Section 5: Notifications ── */}
        <SettingsSection title="Notifications">
          <SettingsRow
            icon="notifications-outline"
            iconColor="#B45309"
            iconBackground="#FFF8F0"
            label="Low Stock Alerts"
            description="Alert when products run low"
            showChevron={false}
            rightElement={
              <Switch
                value={lowStockAlertsEnabled}
                onValueChange={toggleLowStock}
                trackColor={{ false: '#DDE3F0', true: '#0047AB' }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <SettingsRow
            icon="bar-chart-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Daily Summary"
            description="Remind me to review sales each evening"
            showChevron={false}
            rightElement={
              <Switch
                value={dailySummaryEnabled}
                onValueChange={toggleDailySummary}
                trackColor={{ false: '#DDE3F0', true: '#0047AB' }}
                thumbColor="#FFFFFF"
              />
            }
          />
        </SettingsSection>

        {/* ── Section 6: Display ── */}
        <SettingsSection title="Display">
          <SettingsRow
            icon="cash-outline"
            iconColor="#0A7A4B"
            iconBackground="#EAF3DE"
            label="Primary Currency"
            value={business?.currency ?? 'USD'}
            onPress={() => setCurrencyVisible(true)}
          />
          <SettingsRow
            icon="calendar-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Date Format"
            value="3 Apr 2025"
            showChevron={false}
            description="DD MMM YYYY format"
          />
        </SettingsSection>

        {/* ── Section 7: About ── */}
        <SettingsSection title="About">
          <SettingsRow
            icon="information-circle-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="App Version"
            value="1.0.0"
            showChevron={false}
          />
          <SettingsRow
            icon="help-circle-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Help & Support"
            description="FAQs and contact us"
            onPress={() => router.push('/(app)/settings/help-support')}
          />
          <SettingsRow
            icon="shield-checkmark-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Privacy Policy"
            onPress={() => router.push('/(app)/settings/privacy-policy')}
          />
          <SettingsRow
            icon="document-text-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Terms of Service"
            onPress={() => router.push('/(app)/settings/terms-of-service')}
          />
        </SettingsSection>

        {/* ── Section 8: Account ── */}
        <SettingsSection title="Account">
          <SettingsRow
            icon="log-out-outline"
            iconColor="#B45309"
            iconBackground="#FFF8F0"
            label="Sign Out"
            description="Your data stays saved in the cloud"
            onPress={handleSignOut}
          />
          <SettingsRow
            icon="layers-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Clear All Business Data"
            description="Remove inventory & sales; keep your account"
            onPress={handleClearBusinessData}
          />
          <SettingsRow
            icon="trash-outline"
            destructive
            label="Delete Account"
            description="Remove login and everything in the cloud"
            onPress={handleDeleteAccount}
          />
        </SettingsSection>

        <View style={s.bottomPad} />
      </ScrollView>

      <DeferredSettingsModals
        anyVisible={anyModalVisible}
        editBizVisible={editBizVisible}
        onCloseEditBiz={() => setEditBizVisible(false)}
        currencyVisible={currencyVisible}
        onCloseCurrency={() => setCurrencyVisible(false)}
        receiptVisible={receiptVisible}
        onCloseReceipt={() => setReceiptVisible(false)}
        logoModalVisible={logoModalVisible}
        onCloseLogo={() => setLogoModalVisible(false)}
        onLogoChanged={refreshLogo}
        addEmailVisible={addEmailVisible}
        onCloseAddEmail={() => setAddEmailVisible(false)}
        changePassVisible={changePassVisible}
        onCloseChangePass={() => setChangePassVisible(false)}
        deleteVisible={deleteVisible}
        onCloseDelete={() => setDeleteVisible(false)}
        clearDataVisible={clearDataVisible}
        onCloseClearData={() => setClearDataVisible(false)}
        business={business}
        user={user}
        setBusiness={setBusiness}
      />

      <SettingsTutorialModal
        visible={showTutorial}
        ownerName={business?.ownerName ?? undefined}
        onComplete={() => {
          setShowTutorial(false)
          if (business?.id) {
            void SecureStore.setItemAsync(`settings_tutorial_shown_${business.id}`, 'true')
          }
        }}
        onDismiss={() => {
          setShowTutorial(false)
          if (business?.id) {
            void SecureStore.setItemAsync(`settings_tutorial_shown_${business.id}`, 'true')
          }
        }}
      />
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6FB' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  // Hero — horizontal profile card
  hero: {
    backgroundColor: '#0047AB',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  profileCard: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  profileAvatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileLogo: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden' },
  profileAvatarText: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  profileInfo: { flex: 1 },
  profileName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  profileRole: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },

  // Stats
  statsCard: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#DDE3F0',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statCol: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#0D1B3E' },
  statLabel: { fontSize: 11, color: '#5A6A8A', marginTop: 2, textAlign: 'center' },
  statDivider: { width: 1, height: 36, backgroundColor: '#DDE3F0' },

  recoveryEmailRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  recoveryEmailValue: {
    fontSize: 14,
    color: '#5A6A8A',
    flexShrink: 1,
  },

  businessIdRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  businessIdText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#0047AB',
    fontFamily: 'monospace',
  },
  copyBtn: {
    backgroundColor: '#E6EEFF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  copyBtnText: {
    color: '#0047AB',
    fontSize: 12,
    fontWeight: '600',
  },

  bottomPad: { height: 20 },
})

const sub = StyleSheet.create({
  activeCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#EAF3DE',
    borderWidth: 1,
    borderColor: '#0A7A4B',
  },
  activeCardProPlus: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F3EEFF',
    borderWidth: 1,
    borderColor: '#7C3AED',
  },
  activeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0A7A4B',
  },
  activeTitleProPlus: {
    fontSize: 16,
    fontWeight: '600',
    color: '#5B21B6',
  },
  activeTagline: {
    fontSize: 12,
    color: '#3B6D11',
    marginTop: 2,
  },
  activeTaglineProPlus: {
    fontSize: 12,
    color: '#6D28D9',
    marginTop: 2,
  },
  paidBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#0A7A4B',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
  },
  paidBadgeProPlus: {
    alignSelf: 'flex-start',
    backgroundColor: '#7C3AED',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
  },
  paidBadgeTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  smallGreen: { fontSize: 12, color: '#3B6D11' },
  smallProPlus: { fontSize: 12, color: '#6D28D9' },
  divGreen: {
    height: 1,
    backgroundColor: '#CDE5BD',
    marginVertical: 12,
  },
  divProPlus: {
    height: 1,
    backgroundColor: '#DDD6FE',
    marginVertical: 12,
  },
  rowKV: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  k: { fontSize: 13, color: '#3B6D11', flexShrink: 1 },
  v: { fontSize: 13, fontWeight: '600', color: '#3B6D11' },
  kProPlus: { fontSize: 13, color: '#6D28D9', flexShrink: 1 },
  vProPlus: { fontSize: 13, fontWeight: '600', color: '#5B21B6' },

  trialCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#FAEEDA',
    borderWidth: 1,
    borderColor: '#B45309',
  },
  trialTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#854F0B',
  },
  amberBadge: {
    backgroundColor: '#FFF8EC',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#D4A843',
  },
  amberBadgeTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: '#854F0B',
  },
  trialLine: {
    marginTop: 8,
    fontSize: 14,
    color: '#854F0B',
    lineHeight: 20,
  },

  expiredCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#FCEBEB',
    borderWidth: 1,
    borderColor: '#C0152A',
  },
  expiredTitle: { fontSize: 17, fontWeight: '600', color: '#C0152A' },
  expiredSub: {
    marginTop: 8,
    fontSize: 14,
    color: '#5A6A8A',
    lineHeight: 20,
  },

  upgradeBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F3EEFF',
    borderWidth: 1,
    borderColor: '#D4B8FF',
  },
  upgradeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7C3AED',
  },
})

export default SettingsScreen
