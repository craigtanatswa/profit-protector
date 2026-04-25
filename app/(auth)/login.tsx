import React, { useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as SecureStore from 'expo-secure-store'
import { useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Ionicons } from '@expo/vector-icons'

import { Button, Card, Divider, Input, LoadingScreen } from '../../src/components/ui'
import { BrandLogo, KeyboardAvoidingWrapper } from '../../src/components/layout'
import { resolveEmailForSignIn } from '../../src/lib/authLogin'
import { fetchBusinessRowForUser } from '../../src/lib/businessRemote'
import { supabase } from '../../src/lib/supabase'
import { useAuthStore } from '../../src/stores/authStore'
import { database } from '../../src/database'
import Business from '../../src/database/models/Business'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  phone: z
    .string()
    .length(10, 'Phone number must be 10 digits')
    .regex(/^07/, 'Phone number must start with 07'),
  password: z.string().min(1, 'Please enter your password'),
})

type LoginForm = z.infer<typeof loginSchema>

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function LoginScreen() {
  const router = useRouter()
  const { setUser, setBusiness } = useAuthStore()

  const [showPassword, setShowPassword] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: '', password: '' },
  })

  const handleForgotPassword = () => {
    router.push('/(auth)/forgot-password')
  }

  const onSubmit = async (values: LoginForm) => {
    setLoading(true)
    try {
      const idResult = await resolveEmailForSignIn(supabase, values.phone)
      if (!idResult.ok) {
        Alert.alert('Login Failed', idResult.message)
        setLoading(false)
        return
      }

      const trySignIn = (email: string) =>
        supabase.auth.signInWithPassword({ email, password: values.password })

      let { data, error } = await trySignIn(idResult.email)

      if (
        error &&
        idResult.legacyEmail &&
        /invalid login credentials|invalid email or password/i.test(error.message)
      ) {
        const second = await trySignIn(idResult.legacyEmail)
        data = second.data
        error = second.error
      }

      if (error) {
        let msg = error.message
        if (/invalid login credentials|invalid email or password/i.test(msg)) {
          msg = 'Incorrect phone number or password. Please try again.'
        } else if (/email not confirmed/i.test(msg)) {
          msg = 'Please verify your account. Check your messages.'
        } else if (/too many requests/i.test(msg)) {
          msg = 'Too many login attempts. Please wait a few minutes and try again.'
        } else if (/network|fetch/i.test(msg)) {
          msg = 'No internet connection. Please check your connection and try again.'
        }
        Alert.alert('Login Failed', msg)
        setLoading(false)
        return
      }

      const user = data.user
      const session = data.session
      if (!user || !session) {
        Alert.alert('Login Failed', 'No session returned. Please try again.')
        setLoading(false)
        return
      }

      setUser(user)

      const { data: biz, error: bizError } = await fetchBusinessRowForUser(user.id)

      if (bizError || !biz) {
        Alert.alert('Login Failed', bizError?.message ?? 'Could not load your business data.')
        setLoading(false)
        return
      }

      const zigRate =
        typeof biz.zig_rate_per_usd === 'number' && biz.zig_rate_per_usd > 0
          ? biz.zig_rate_per_usd
          : 1

      const recoveryEmailVerified = biz.recovery_email_verified === true
      const recoveryEmail =
        typeof biz.recovery_email === 'string' && biz.recovery_email.trim() !== ''
          ? biz.recovery_email.trim()
          : undefined

      setBusiness({
        id: biz.id,
        name: biz.name,
        ownerName: biz.owner_name,
        phone: biz.phone,
        businessType: biz.business_type,
        currency: biz.currency,
        zigRatePerUsd: zigRate,
        loginUsername: biz.login_username ?? null,
        recoveryEmail,
        recoveryEmailVerified,
      })

      if (!recoveryEmailVerified) {
        await SecureStore.setItemAsync('shown_email_prompt', 'false')
      } else {
        await SecureStore.setItemAsync('shown_email_prompt', 'true')
      }

      // WatermelonDB: restore business on new device if not already present locally
      if (database) {
        try {
          const businessCollection = database.get<Business>('businesses')
          const existing = await businessCollection.query().fetch()
          const alreadyLocal = existing.some((r) => r.supabaseId === user.id)

          if (!alreadyLocal) {
            setLoading(false)
            setRestoreMessage('Restoring your data...')

            await database.write(async () => {
              await businessCollection.create((record) => {
                record.name = biz.name
                record.ownerName = biz.owner_name
                record.phone = biz.phone
                record.businessType = biz.business_type
                record.currency = biz.currency
                record.zigRatePerUsd = zigRate
                record.loginUsername = biz.login_username ?? null
                record.supabaseId = user.id
                record.recoveryEmail = recoveryEmail ?? null
                record.recoveryEmailVerified = recoveryEmailVerified
              })
            })

            // Step 1 — Restore products
            setRestoreMessage('Restoring your products...')
            try {
              const { data: products } = await supabase
                .from('products')
                .select('*')
                .eq('business_id', biz.id)
              if (products?.length) {
                await database.write(async () => {
                  for (const p of products) {
                    await database.get('products').create((record) => {
                      record._raw.id = p.id
                      record.businessId = p.business_id
                      record.name = p.name
                      record.category = p.category ?? ''
                      record.unit = p.unit
                      record.costPriceCents = p.cost_price_cents
                      record.sellingPriceCents = p.selling_price_cents
                      record.stockQty = p.stock_qty
                      record.lowStockThreshold = p.low_stock_threshold
                      record.isActive = p.is_active
                      record.createdAt = new Date(p.created_at).getTime()
                      record.updatedAt = new Date(p.updated_at).getTime()
                    })
                  }
                })
              }
            } catch (err) {
              console.warn('[login] product restore error:', err)
            }

            // Step 2 — Restore customers
            setRestoreMessage('Restoring your customers...')
            try {
              const { data: customers } = await supabase
                .from('customers')
                .select('*')
                .eq('business_id', biz.id)
              if (customers?.length) {
                await database.write(async () => {
                  for (const c of customers) {
                    await database.get('customers').create((record) => {
                      record._raw.id = c.id
                      record.businessId = c.business_id
                      record.name = c.name
                      record.phone = c.phone ?? ''
                      record.outstandingBalanceCents = c.outstanding_balance_cents
                      record.createdAt = new Date(c.created_at).getTime()
                    })
                  }
                })
              }
            } catch (err) {
              console.warn('[login] customer restore error:', err)
            }

            // Step 3 — Restore sales and sale_items
            setRestoreMessage('Restoring your sales history...')
            try {
              const { data: sales } = await supabase
                .from('sales')
                .select('*, sale_items(*)')
                .eq('business_id', biz.id)
                .order('created_at', { ascending: true })
              if (sales?.length) {
                await database.write(async () => {
                  for (const s of sales) {
                    await database.get('sales').create((record) => {
                      record._raw.id = s.id
                      record.businessId = s.business_id
                      record.totalCents = s.total_cents
                      record.discountCents = s.discount_cents
                      record.paymentMethod = s.payment_method
                      record.receiptNumber = s.receipt_number
                      record.note = s.note ?? ''
                      record.createdAt = new Date(s.created_at).getTime()
                    })
                    for (const item of s.sale_items ?? []) {
                      await database.get('sale_items').create((record) => {
                        record._raw.id = item.id
                        record.saleId = s.id
                        record.productId = item.product_id
                        record.productNameSnapshot = item.product_name_snapshot
                        record.qty = item.qty
                        record.unitPriceCents = item.unit_price_cents
                        record.costPriceCents = item.cost_price_cents
                      })
                    }
                  }
                })
              }
            } catch (err) {
              console.warn('[login] sales restore error:', err)
            }

            setRestoreMessage('Almost done...')
          }
        } catch (dbErr) {
          console.warn('[login] WatermelonDB restore error:', dbErr)
          setRestoreMessage(null)
          Alert.alert('Restore Failed', 'Could not restore your data. Please try again.')
          setLoading(false)
          return
        }
      }

      router.replace('/(app)')
    } catch (e: unknown) {
      Alert.alert('Login Failed', (e as Error)?.message ?? 'Something went wrong.')
      setLoading(false)
    }
  }

  if (restoreMessage) {
    return <LoadingScreen message={restoreMessage} />
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingWrapper>
        <View style={styles.content}>
          {/* Logo area */}
          <View style={styles.logoArea}>
            <BrandLogo variant="full" width={120} height={120} />
            <Text style={styles.appName}>Profit Protector</Text>
            <Text style={styles.tagline}>Business in your pocket</Text>
          </View>

          {/* Form card */}
          <Card padding="lg">
            <Text style={styles.formTitle}>Welcome back</Text>
            <Text style={styles.formSubtitle}>Enter your details to continue</Text>

            <View style={styles.fields}>
              {/* Phone number */}
              <Controller
                control={control}
                name="phone"
                render={({ field: { onChange, value } }) => (
                  <Input
                    label="Phone Number"
                    placeholder="e.g. 0771234567"
                    value={value}
                    onChangeText={onChange}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    error={errors.phone?.message}
                    hint="The number you registered with"
                    leftIcon={<Ionicons name="call-outline" size={18} color="#718096" />}
                    editable={!loading}
                  />
                )}
              />

              {/* Password */}
              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, value } }) => (
                  <Input
                    label="Password"
                    placeholder="Enter your password"
                    value={value}
                    onChangeText={onChange}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    error={errors.password?.message}
                    leftIcon={<Ionicons name="lock-closed-outline" size={18} color="#718096" />}
                    rightIcon={
                      <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={18}
                          color="#718096"
                        />
                      </TouchableOpacity>
                    }
                    editable={!loading}
                  />
                )}
              />
            </View>

            {/* Forgot password */}
            <View style={styles.forgotRow}>
              <TouchableOpacity onPress={handleForgotPassword}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>

            {/* Login button */}
            <View style={styles.loginButtonWrapper}>
              <Button
                label="Login"
                onPress={handleSubmit(onSubmit)}
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                disabled={loading}
              />
            </View>

            {/* Divider */}
            <Divider label="or" spacing={24} />

            {/* Sign up row */}
            <View style={styles.signUpRow}>
              <Text style={styles.signUpMuted}>Don't have an account?</Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                <Text style={styles.signUpLink}> Sign up</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </View>
      </KeyboardAvoidingWrapper>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 40,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0047AB',
    marginTop: 16,
  },
  tagline: {
    fontSize: 14,
    color: '#718096',
    marginTop: 4,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A202C',
    marginBottom: 4,
  },
  formSubtitle: {
    fontSize: 14,
    color: '#718096',
    marginBottom: 24,
  },
  fields: {
    gap: 16,
  },
  forgotRow: {
    alignItems: 'flex-end',
    marginTop: 8,
  },
  forgotText: {
    fontSize: 13,
    color: '#0047AB',
    fontWeight: '500',
  },
  loginButtonWrapper: {
    marginTop: 24,
  },
  signUpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signUpMuted: {
    fontSize: 14,
    color: '#718096',
  },
  signUpLink: {
    fontSize: 14,
    color: '#0047AB',
    fontWeight: '600',
  },
})
