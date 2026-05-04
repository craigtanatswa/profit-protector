import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Ionicons } from '@expo/vector-icons'

import { Button, Card, Divider, Input } from '../../src/components/ui'
import { BrandLogo, KeyboardAvoidingWrapper } from '../../src/components/layout'
import { resolveEmailForSignIn } from '../../src/lib/authLogin'
import {
  businessInfoFromRemoteRow,
  fetchBusinessRowForUser,
} from '../../src/lib/businessRemote'
import { ensureLocalWatermelonForSession } from '../../src/lib/ensureLocalWatermelon'
import { refreshOwnerProductsFromSupabase } from '../../src/lib/sync'
import { supabase } from '../../src/lib/supabase'
import { useAuthStore } from '../../src/stores/authStore'
import { getDeviceId } from '../../src/lib/deviceId'
import { shopkeeperLogin } from '../../src/lib/shopkeeperAuth'
import { logActivity } from '../../src/lib/activityLogger'
import type { BusinessInfo } from '../../src/stores/authStore'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  identifier: z.string().min(1, 'Enter your phone number or username'),
  password: z.string().min(1, 'Enter your password'),
})

type LoginForm = z.infer<typeof loginSchema>

const shopkeeperSchema = z.object({
  businessId: z.string().min(1, 'Business ID is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

type ShopkeeperForm = z.infer<typeof shopkeeperSchema>
type LoginMode = 'owner' | 'shopkeeper'

// ---------------------------------------------------------------------------
// Shopkeeper sub-form — isolated component so its useForm state is never
// affected by re-renders of the parent LoginScreen (e.g. auth-store updates).
// ---------------------------------------------------------------------------

interface ShopkeeperFormProps {
  onSuccess: (values: ShopkeeperForm) => Promise<void>
  loading: boolean
}

function ShopkeeperSignInForm({ onSuccess, loading }: ShopkeeperFormProps) {
  const [showPassword, setShowPassword] = useState(false)

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ShopkeeperForm>({
    resolver: zodResolver(shopkeeperSchema),
    defaultValues: { businessId: '', username: '', password: '' },
  })

  return (
    <>
      <Controller
        control={control}
        name="businessId"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Business ID"
            hint="Ask your employer for this ID"
            placeholder="e.g. pp-abc123"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            autoCapitalize="none"
            autoCorrect={false}
            error={errors.businessId?.message}
            leftIcon={<Ionicons name="business-outline" size={18} color="#5A6A8A" />}
            editable={!loading}
          />
        )}
      />
      <Controller
        control={control}
        name="username"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Username"
            hint="The username your employer created for you"
            placeholder="e.g. farai.moyo"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            autoCapitalize="none"
            autoCorrect={false}
            error={errors.username?.message}
            leftIcon={<Ionicons name="person-outline" size={18} color="#5A6A8A" />}
            editable={!loading}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Password"
            placeholder="Your password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            secureTextEntry={!showPassword}
            error={errors.password?.message}
            leftIcon={<Ionicons name="lock-closed-outline" size={18} color="#5A6A8A" />}
            editable={!loading}
            rightIcon={
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color="#5A6A8A"
                />
              </TouchableOpacity>
            }
          />
        )}
      />

      <View style={styles.loginButtonWrapper}>
        <Button
          label="Sign in as Shopkeeper"
          onPress={handleSubmit(onSuccess)}
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          disabled={loading}
        />
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function LoginScreen() {
  const router = useRouter()

  // Use selectors so this component only re-renders when the specific pieces
  // it needs actually change, not on every background auth-store update.
  const setUser        = useAuthStore((s) => s.setUser)
  const setBusiness    = useAuthStore((s) => s.setBusiness)
  const triggerSync    = useAuthStore((s) => s.triggerSync)
  const setActiveRole  = useAuthStore((s) => s.setActiveRole)
  const setShopkeeperSession = useAuthStore((s) => s.setShopkeeperSession)

  // Session restored before this screen mounts (normal cold start): leave Login immediately.
  // Mid-submit login does not hit this — user was null on first paint.
  useEffect(() => {
    const { user, business, isLoading } = useAuthStore.getState()
    if (isLoading || !user) return
    if (business) {
      router.replace('/(app)')
    } else {
      router.replace('/(auth)/register?resume=1')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap-only routing from restored session
  }, [])

  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('owner')

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  })

  const handleForgotPassword = () => {
    router.push('/(auth)/forgot-password')
  }

  const onSubmit = async (values: LoginForm) => {
    setLoading(true)
    try {
      const idResult = await resolveEmailForSignIn(supabase, values.identifier)
      if (!idResult.ok) {
        Alert.alert('Login failed', idResult.message)
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
          msg = 'Incorrect phone number/username or password. Please try again.'
        } else if (/email not confirmed/i.test(msg)) {
          msg = 'Please verify your account. Check your messages.'
        } else if (/too many requests/i.test(msg)) {
          msg = 'Too many login attempts. Please wait a few minutes and try again.'
        } else if (/network|fetch/i.test(msg)) {
          msg = 'No internet connection. Please check your connection and try again.'
        }
        Alert.alert('Login failed', msg)
        setLoading(false)
        return
      }

      const user = data.user
      const session = data.session
      if (!user || !session) {
        Alert.alert('Login failed', 'Could not establish a session.')
        setLoading(false)
        return
      }

      const { data: au } = await supabase
        .from('app_users')
        .select('phone_verified')
        .eq('id', user.id)
        .maybeSingle()

      if (au != null && au.phone_verified !== true) {
        await supabase.auth.signOut()
        Alert.alert(
          'Phone not verified',
          'Your phone number must be verified before you can sign in. Complete signup verification or contact support.',
        )
        setLoading(false)
        return
      }

      const { data: biz, error: bizErr } = await fetchBusinessRowForUser(user.id)
      if (bizErr || !biz) {
        setUser(user)
        setBusiness(null)
        router.replace('/(auth)/register?resume=1')
        setLoading(false)
        return
      }

      setUser(user)
      setBusiness(businessInfoFromRemoteRow(biz))
      await ensureLocalWatermelonForSession(user, biz)
      await refreshOwnerProductsFromSupabase(biz.id)
      await triggerSync(biz.id)
      await logActivity({ action: 'account_login_owner', entityType: 'account' })

      router.replace('/(app)')
    } catch (e: unknown) {
      Alert.alert('Login failed', (e as Error)?.message ?? 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const handleShopkeeperLogin = useCallback(async (values: ShopkeeperForm) => {
    setLoading(true)
    try {
      const businessId = values.businessId.trim()
      const username = values.username.trim()
      const result = await shopkeeperLogin({
        businessId,
        username,
        password: values.password,
      })

      if (result.status === 'error') {
        Alert.alert('Sign In Failed', result.message ?? 'Please check your details and try again.')
        return
      }

      if (result.status === 'pending_approval') {
        router.push({
          pathname: '/(auth)/shopkeeper-pending',
          params: {
            businessId,
            username,
            deviceId: await getDeviceId(),
            shopkeeperName: 'Shopkeeper',
            message: result.message ?? '',
          },
        })
        return
      }

      if (result.status === 'approved' && result.session) {
        const biz: BusinessInfo = {
          id: result.session.businessId,
          name: result.session.businessName,
          ownerName: result.session.shopkeeper.fullName,
          phone: '',
          businessType: '',
          currency: 'USD',
          zigRatePerUsd: 1,
          recoveryEmailVerified: false,
        }
        setUser(null)
        setBusiness(biz)
        setActiveRole('shopkeeper')
        setShopkeeperSession(result.session)
        await logActivity({ action: 'account_login_shopkeeper', entityType: 'account' })
        router.replace('/(app)')
      }
    } catch (e: unknown) {
      Alert.alert('Sign In Failed', (e as Error)?.message ?? 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, setUser, setBusiness, setActiveRole, setShopkeeperSession])

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingWrapper>
        <View style={styles.content}>
          <View style={styles.logoArea}>
            <BrandLogo variant="full" width={120} height={120} />
            <Text style={styles.appName}>Profit Protector</Text>
            <Text style={styles.tagline}>Business in your pocket</Text>
          </View>

          <View style={styles.modeTabs}>
            <TouchableOpacity
              style={[styles.modePill, loginMode === 'owner' && styles.modePillActive]}
              onPress={() => setLoginMode('owner')}
              disabled={loading}
            >
              <Text style={[styles.modeText, loginMode === 'owner' && styles.modeTextActive]}>
                Business Owner
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modePill, loginMode === 'shopkeeper' && styles.modePillActive]}
              onPress={() => setLoginMode('shopkeeper')}
              disabled={loading}
            >
              <Text style={[styles.modeText, loginMode === 'shopkeeper' && styles.modeTextActive]}>
                I am a Shopkeeper
              </Text>
            </TouchableOpacity>
          </View>

          <Card padding="lg">
            <Text style={styles.formTitle}>Sign in</Text>

            {loginMode === 'owner' ? (
              <>
                <Controller
                  control={control}
                  name="identifier"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      label="Phone number or username"
                      placeholder="0771234567 or your username"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      autoCapitalize="none"
                      autoCorrect={false}
                      error={errors.identifier?.message}
                      leftIcon={<Ionicons name="person-outline" size={18} color="#5A6A8A" />}
                      editable={!loading}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="password"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      label="Password"
                      placeholder="Your password"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      secureTextEntry={!showPassword}
                      error={errors.password?.message}
                      editable={!loading}
                      rightIcon={
                        <TouchableOpacity
                          onPress={() => setShowPassword((v) => !v)}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        >
                          <Ionicons
                            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                            color="#5A6A8A"
                          />
                        </TouchableOpacity>
                      }
                    />
                  )}
                />

                <View style={styles.loginButtonWrapper}>
                  <Button
                    label="Sign in"
                    onPress={handleSubmit(onSubmit)}
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={loading}
                    disabled={loading}
                  />
                </View>

                <TouchableOpacity style={styles.forgotRow} onPress={handleForgotPassword}>
                  <Text style={styles.forgotText}>Forgot password? (recovery email)</Text>
                </TouchableOpacity>

                <Divider label="or" spacing={24} />

                <View style={styles.signUpRow}>
                  <Text style={styles.signUpMuted}>New here?</Text>
                  <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                    <Text style={styles.signUpLink}> Create business profile</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <ShopkeeperSignInForm onSuccess={handleShopkeeperLogin} loading={loading} />
            )}
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
    marginBottom: 24,
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
    marginBottom: 24,
  },
  modeTabs: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    padding: 4,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: '#DDE3F0',
  },
  modePill: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 0.5,
    borderColor: 'transparent',
  },
  modePillActive: {
    backgroundColor: '#0047AB',
  },
  modeText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#5A6A8A',
  },
  modeTextActive: {
    color: '#FFFFFF',
  },
  loginButtonWrapper: {
    marginTop: 24,
  },
  forgotRow: {
    alignItems: 'center',
    marginTop: 16,
  },
  forgotText: {
    fontSize: 13,
    color: '#0047AB',
    fontWeight: '500',
  },
  signUpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
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
