import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useState } from 'react'
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, Card, EmptyState, Input } from '../../../src/components/ui'
import { ScreenHeader, useKeyboardHeight } from '../../../src/components/layout'
import { MultiShopUpgradeModal } from '../../../src/components/modals/MultiShopUpgradeModal'
import { useAuthStore } from '../../../src/stores/authStore'
import { useSubscription } from '../../../src/hooks/useSubscription'
import { useShops } from '../../../src/hooks/useShops'
import { logActivity } from '../../../src/lib/activityLogger'
import {
  addNamedShop,
  createInitialShopPair,
  formatShopLabel,
  SHOP_ADDRESS_MAX,
  updateShopAddress,
  validateShopAddress,
} from '../../../src/lib/shops'
import type { Shop } from '../../../src/types'

export default function EstablishmentsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const business = useAuthStore((s) => s.business)
  const {
    canUseMultipleShops,
    maxShops,
    upgradeProration,
  } = useSubscription()
  const { shops, hasMultipleShops, refresh, reloadLocal } = useShops(business?.id ?? '')

  const [addVisible, setAddVisible] = useState(false)
  const [upgradeVisible, setUpgradeVisible] = useState(false)
  const [editing, setEditing] = useState<Shop | null>(null)
  const [currentAddress, setCurrentAddress] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const keyboardHeight = useKeyboardHeight(addVisible || editing != null)
  const keyboardLift =
    keyboardHeight > 0 ? Math.max(0, keyboardHeight - insets.bottom) : 0
  const topSafeGap = insets.top + 8
  const sheetMaxHeight =
    keyboardLift > 0
      ? Math.max(240, windowHeight - keyboardLift - topSafeGap)
      : Math.min(windowHeight * 0.9, windowHeight - topSafeGap)

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const isAtLimit = shops.length >= maxShops
  const addingFirstPair = shops.length === 0

  function handleAddPress() {
    if (!canUseMultipleShops) {
      setUpgradeVisible(true)
      return
    }
    if (isAtLimit) {
      Alert.alert(
        'Shop limit reached',
        `Your plan allows up to ${maxShops} shops.`,
      )
      return
    }
    setCurrentAddress('')
    setNewAddress('')
    setErrors({})
    setAddVisible(true)
  }

  async function saveNew() {
    if (!business?.id) return
    const nextErrors: Record<string, string> = {}
    if (addingFirstPair) {
      const currentErr = validateShopAddress(currentAddress)
      if (currentErr) nextErrors.currentAddress = currentErr
    }
    const newErr = validateShopAddress(newAddress)
    if (newErr) nextErrors.newAddress = newErr
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setSaving(true)
    try {
      if (addingFirstPair) {
        const result = await createInitialShopPair({
          businessId: business.id,
          currentAddress,
          newAddress,
        })
        if (result.error) {
          const isLimit = result.error.toLowerCase().includes('shop limit')
          Alert.alert(
            isLimit ? 'Shop limit reached' : 'Could not add shops',
            isLimit
              ? 'Upgrade to Pro+ to add up to 5 locations, keep stock per shop, and assign staff.'
              : result.error,
          )
          return
        }
        await logActivity({
          action: 'shop_added',
          entityType: 'shop',
          entityName: 'Shop 1 and Shop 2',
        })
      } else {
        const result = await addNamedShop({
          businessId: business.id,
          address: newAddress,
          existing: shops,
        })
        if (result.error) {
          const isLimit = result.error.toLowerCase().includes('shop limit')
          Alert.alert(
            isLimit ? 'Shop limit reached' : 'Could not add shop',
            isLimit
              ? 'Upgrade to Pro+ to add up to 5 locations, keep stock per shop, and assign staff.'
              : result.error,
          )
          return
        }
        await logActivity({
          action: 'shop_added',
          entityType: 'shop',
          entityId: result.shop?.id,
          entityName: result.shop ? formatShopLabel(result.shop) : 'Shop',
        })
      }
      setAddVisible(false)
      await reloadLocal()
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit() {
    if (!editing) return
    const err = validateShopAddress(editAddress)
    if (err) {
      setErrors({ editAddress: err })
      return
    }
    setSaving(true)
    try {
      const result = await updateShopAddress({ shop: editing, address: editAddress })
      if (result.error) {
        Alert.alert('Could not update shop', result.error)
        return
      }
      await logActivity({
        action: 'shop_edited',
        entityType: 'shop',
        entityId: editing.id,
        entityName: formatShopLabel({ name: editing.name, address: editAddress.trim() }),
      })
      setEditing(null)
      await reloadLocal()
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="Shops"
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
        rightAction={{ icon: 'add', onPress: handleAddPress }}
        showBorder
      />
      <FlatList
        data={shops}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <Card padding="md" style={styles.hintCard}>
            <View style={styles.hintRow}>
              <Ionicons name="storefront-outline" size={18} color="#0047AB" />
              <Text style={styles.hintTitle}>
                {hasMultipleShops
                  ? `${shops.length} shops`
                  : 'One shop (default)'}
              </Text>
            </View>
            <Text style={styles.hintBody}>
              {hasMultipleShops
                ? 'Staff must be assigned to a shop. When you record a sale, pick the shop that made it — it stays on the last shop you used.'
                : 'You have one location. Add another shop to record sales separately and assign staff to each establishment.'}
            </Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Card
            padding="md"
            style={styles.shopCard}
            onPress={() => {
              setEditAddress(item.address)
              setErrors({})
              setEditing(item)
            }}
          >
            <View style={styles.shopTop}>
              <View style={styles.shopIcon}>
                <Ionicons name="storefront-outline" size={18} color="#0047AB" />
              </View>
              <View style={styles.shopInfo}>
                <Text style={styles.shopName}>{item.name}</Text>
                <Text style={styles.shopAddress}>{item.address}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#DDE3F0" />
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="storefront-outline"
            title="One shop by default"
            subtitle="Add a second location when you start selling from another establishment. Shop 1 keeps your current products; Shop 2 gets a copy you can edit on its own. Extra shops are included on Pro+ (and during the trial)."
            actionLabel="Add another shop"
            onAction={handleAddPress}
          />
        }
      />

      <Modal
        visible={addVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setAddVisible(false)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={insets.bottom}
        >
          <View style={styles.modalRoot}>
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setAddVisible(false)} />
            <View
              style={[
                styles.sheet,
                {
                  paddingBottom: Math.max(insets.bottom, 16),
                  maxHeight: sheetMaxHeight,
                },
                keyboardLift > 0 && { marginBottom: keyboardLift },
              ]}
            >
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>
                {addingFirstPair ? 'Add another shop' : 'Add shop'}
              </Text>
              <Text style={styles.modalSubtitle}>
                {addingFirstPair
                  ? 'Your current location will be saved as Shop 1. Its products are copied to Shop 2 so each shop can keep its own stock from then on.'
                  : `This will be saved as Shop ${shops.reduce((max, shop) => Math.max(max, shop.shopNumber), 0) + 1}. Shop 1’s products will be copied in, then you can change this shop’s catalog independently.`}
              </Text>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={styles.sheetScrollContent}
              >
                <View style={styles.fields}>
                  {addingFirstPair ? (
                    <Input
                      label="Shop 1 address"
                      hint="Your current location"
                      placeholder="e.g. Avondale, Harare"
                      value={currentAddress}
                      onChangeText={setCurrentAddress}
                      maxLength={SHOP_ADDRESS_MAX}
                      error={errors.currentAddress}
                      leftIcon={<Ionicons name="location-outline" size={18} color="#5A6A8A" />}
                    />
                  ) : null}
                  <Input
                    label={addingFirstPair ? 'Shop 2 address' : 'Short address'}
                    hint="A short place name is enough"
                    placeholder="e.g. Borrowdale, Harare"
                    value={newAddress}
                    onChangeText={setNewAddress}
                    maxLength={SHOP_ADDRESS_MAX}
                    error={errors.newAddress}
                    leftIcon={<Ionicons name="location-outline" size={18} color="#5A6A8A" />}
                  />
                </View>
                <View style={styles.modalActions}>
                  <Button
                    label={addingFirstPair ? 'Save both shops' : 'Add shop'}
                    onPress={() => void saveNew()}
                    loading={saving}
                    disabled={saving}
                  />
                  <Button
                    label="Cancel"
                    onPress={() => setAddVisible(false)}
                    variant="secondary"
                    disabled={saving}
                  />
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={editing != null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditing(null)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={insets.bottom}
        >
          <View style={styles.modalRoot}>
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setEditing(null)} />
            <View
              style={[
                styles.sheet,
                {
                  paddingBottom: Math.max(insets.bottom, 16),
                  maxHeight: sheetMaxHeight,
                },
                keyboardLift > 0 && { marginBottom: keyboardLift },
              ]}
            >
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>{editing?.name ?? 'Shop'}</Text>
              <Text style={styles.modalSubtitle}>Update the short address used to tell this shop apart.</Text>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={styles.sheetScrollContent}
              >
                <View style={styles.fields}>
                  <Input
                    label="Short address"
                    value={editAddress}
                    onChangeText={setEditAddress}
                    maxLength={SHOP_ADDRESS_MAX}
                    error={errors.editAddress}
                    leftIcon={<Ionicons name="location-outline" size={18} color="#5A6A8A" />}
                  />
                </View>
                <View style={styles.modalActions}>
                  <Button label="Save" onPress={() => void saveEdit()} loading={saving} disabled={saving} />
                  <Button label="Cancel" onPress={() => setEditing(null)} variant="secondary" disabled={saving} />
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <MultiShopUpgradeModal
        visible={upgradeVisible}
        upgradeChargeCents={upgradeProration?.chargeCents}
        upgradeIsFree={upgradeProration?.isFree}
        onClose={() => setUpgradeVisible(false)}
        onUpgrade={() => {
          setUpgradeVisible(false)
          router.push('/(app)/settings/upgrade-plan')
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6FB' },
  listContent: { padding: 16, paddingBottom: 24 },
  hintCard: { marginBottom: 14, borderWidth: 1, borderColor: '#DDE3F0' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintTitle: { fontSize: 15, fontWeight: '600', color: '#0D1B3E' },
  hintBody: { fontSize: 13, color: '#5A6A8A', marginTop: 8, lineHeight: 19 },
  shopCard: { marginBottom: 8 },
  shopTop: { flexDirection: 'row', alignItems: 'center' },
  shopIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E6EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  shopInfo: { flex: 1 },
  shopName: { fontSize: 15, fontWeight: '600', color: '#0D1B3E' },
  shopAddress: { fontSize: 13, color: '#5A6A8A', marginTop: 2 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  kav: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE3F0',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#0D1B3E' },
  modalSubtitle: { fontSize: 13, color: '#5A6A8A', marginTop: 4, marginBottom: 16, lineHeight: 19 },
  fields: { gap: 14 },
  modalActions: { gap: 10, marginTop: 20, marginBottom: 8 },
  sheetScrollContent: { paddingBottom: 12 },
})
