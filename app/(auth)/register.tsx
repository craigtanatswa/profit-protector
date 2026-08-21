/*
 * Run this SQL in your Supabase SQL Editor before testing registration:
 *
 * create table businesses (
 *   id text primary key,
 *   user_id uuid references auth.users(id),
 *   name text not null,
 *   owner_name text not null,
 *   phone text not null,
 *   business_type text not null,
 *   currency text not null,
 *   login_username text,
 *   created_at timestamptz default now()
 * );
 *
 * -- If you already created `businesses` without login_username:
 * -- alter table businesses add column if not exists login_username text;
 *
 * -- ZiG display rate (ZiG per $1 USD); defaults to 1 if missing
 * -- alter table businesses add column if not exists zig_rate_per_usd numeric default 1;
 *
 * alter table businesses enable row level security;
 *
 * create policy "Users can manage their own business"
 * on businesses for all
 * using (auth.uid() = user_id);
 *
 * -- Username login: map username → same phone-based auth email used at sign-up (must match AUTH_EMAIL_DOMAIN in app).
 * create or replace function public.auth_email_for_login_username(p_username text)
 * returns text
 * language sql
 * stable
 * security definer
 * set search_path = public
 * as $$
 *   select ('u' || b.phone || '@profitprotector.app')::text
 *   from businesses b
 *   where lower(trim(b.login_username)) = lower(trim(p_username))
 *   limit 1;
 * $$;
 *
 * grant execute on function public.auth_email_for_login_username(text) to anon, authenticated;
 *
 * create unique index if not exists businesses_login_username_lower_key
 * on businesses (lower(trim(login_username)))
 * where login_username is not null and trim(login_username) <> '';
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Ionicons } from '@expo/vector-icons'

import { Button, Input, OTPInput } from '../../src/components/ui'
import { EmailVerificationModal } from '../../src/components/auth/EmailVerificationModal'
import { BrandLogo, ScreenHeader } from '../../src/components/layout'
import { database } from '../../src/database'
import Business from '../../src/database/models/Business'
import { supabase } from '../../src/lib/supabase'
import { getPersonalisation } from '../../src/lib/appPersonalisation'
import {
  clearPendingBusinessProfile,
  createBusinessProfile,
  savePendingBusinessProfile,
} from '../../src/lib/createAccount'
import {
  buildSupabaseEmailFromPhone,
  isValidOptionalLoginUsername,
  normalizeOptionalLoginUsername,
} from '../../src/lib/authIdentity'
import { isMissingRecoveryColumnsError } from '../../src/lib/businessRemote'
import { sendPhoneOtp, verifySignupOtp } from '../../src/lib/phoneOTP'
import { useAuthStore } from '../../src/stores/authStore'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const registerSchema = z
  .object({
    businessName: z.string().min(2, 'Business name must be at least 2 characters'),
    businessType: z.string().min(1, 'Please select a business type'),
    ownerName: z.string().min(2, 'Owner name must be at least 2 characters'),
    phone: z
      .string()
      .length(10, 'Phone number must be 10 digits')
      .regex(/^07/, 'Phone number must start with 07'),
    loginUsername: z
      .string()
      .max(30, 'Username must be at most 30 characters')
      .transform(s => normalizeOptionalLoginUsername(s))
      .refine(isValidOptionalLoginUsername, {
        message:
          'Username must be 3–30 characters, start with a letter, and use only letters, numbers, or underscores',
      }),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
    currency: z.string().min(1, 'Please select a currency'),
    monthlyProfitGoalCents: z.number().optional(),
    agreedToLegal: z
      .boolean()
      .refine(v => v === true, {
        message: 'You must accept the Terms of Service and Privacy Policy to create an account',
      }),
    recoveryEmail: z
      .string()
      .transform(s => s.trim())
      .refine(s => s === '' || z.string().email().safeParse(s).success, {
        message: 'Please enter a valid email address',
      }),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine(
    data =>
      data.loginUsername === '' ||
      (data.phone.length === 10 && /^07\d{8}$/.test(data.phone)),
    {
      message:
        'A valid phone number is required. You cannot create an account with only a username.',
      path: ['phone'],
    },
  )

type RegisterFormData = z.infer<typeof registerSchema>

function parseOnboardingStepParam(
  raw: string | string[] | undefined,
): number | null {
  if (raw === undefined) return null
  const s = Array.isArray(raw) ? raw[0] : raw
  if (s === '' || s == null) return null
  const n = parseInt(String(s), 10)
  if (!Number.isFinite(n) || n < 1 || n > 4) return null
  return n
}

function parseFromOnboardingParam(raw: string | string[] | undefined): boolean {
  if (raw === undefined) return false
  const s = Array.isArray(raw) ? raw[0] : raw
  return s === '1' || s === 'true'
}

function parseResumeParam(raw: string | string[] | undefined): boolean {
  if (raw === undefined) return false
  const s = Array.isArray(raw) ? raw[0] : raw
  return s === '1' || s === 'true'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_FIELDS: Record<number, Array<keyof RegisterFormData>> = {
  1: ['businessName', 'businessType'],
  2: [
    'ownerName',
    'phone',
    'loginUsername',
    'recoveryEmail',
    'password',
    'confirmPassword',
  ],
  3: [],
  4: ['currency', 'agreedToLegal'],
}

const BUSINESS_TYPES: PillOption[] = [
  { label: 'Tuck shop / Grocery', value: 'tuck_shop' },
  { label: 'Hardware', value: 'hardware' },
  { label: 'Tech shop / Gadgets', value: 'tech_shop' },
  { label: 'Salon / Barber', value: 'salon' },
  { label: 'Clothing / Boutique', value: 'clothing' },
  { label: 'Pharmacy', value: 'pharmacy' },
  { label: 'Restaurant / Takeaway', value: 'restaurant' },
  { label: 'Other', value: 'other' },
]

const CURRENCY_OPTIONS: { label: string; value: string }[] = [
  { label: 'USD ($)', value: 'usd' },
  { label: 'ZiG', value: 'zig' },
  { label: 'Both', value: 'both' },
]

const STEP_META = [
  { title: 'Your Business', subtitle: 'Tell us about your business', label: 'Business' },
  { title: 'Owner', subtitle: 'Contact details & login', label: 'Owner' },
  { title: 'Verify Phone', subtitle: 'Enter the code sent by SMS', label: 'SMS' },
  { title: 'Almost Done', subtitle: 'Preferences & legal', label: 'Done' },
]

// ---------------------------------------------------------------------------
// PillSelector
// ---------------------------------------------------------------------------

interface PillOption {
  label: string
  value: string
}

interface PillSelectorProps {
  options: (string | PillOption)[]
  selected: string
  onSelect: (value: string) => void
  error?: string
}

function PillSelector({ options, selected, onSelect, error }: PillSelectorProps) {
  const normalised: PillOption[] = options.map(o =>
    typeof o === 'string' ? { label: o, value: o } : o,
  )

  return (
    <View>
      <View style={styles.pillRow}>
        {normalised.map(opt => {
          const active = selected === opt.value
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}
              activeOpacity={0.8}
            >
              <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextIdle]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      {error != null && <Text style={styles.errorText}>{error}</Text>}
    </View>
  )
}

// ---------------------------------------------------------------------------
// ProgressIndicator
// ---------------------------------------------------------------------------

function ProgressIndicator({ currentStep }: { currentStep: number }) {
  return (
    <View style={styles.progressRow}>
      {([1, 2, 3, 4] as const).map((step, index) => {
        const completed = step < currentStep
        const active = step === currentStep
        const highlight = completed || active

        return (
          <React.Fragment key={step}>
            <View style={styles.progressStep}>
              <View
                style={[
                  styles.progressDot,
                  highlight ? styles.progressDotActive : styles.progressDotIdle,
                ]}
              >
                {completed && <Ionicons name="checkmark" size={8} color="#FFFFFF" />}
              </View>
              <Text
                style={[
                  styles.progressLabel,
                  highlight ? styles.progressLabelActive : styles.progressLabelIdle,
                ]}
              >
                {STEP_META[index].label}
              </Text>
            </View>
            {index < 3 && <View style={styles.progressLine} />}
          </React.Fragment>
        )
      })}
    </View>
  )
}

// ---------------------------------------------------------------------------
// RegisterScreen
// ---------------------------------------------------------------------------

export default function RegisterScreen() {
  const router = useRouter()
  const { step: stepParam, resume: resumeParam, fromOnboarding: fromOnboardingParam } =
    useLocalSearchParams<{
      step?: string | string[]
      resume?: string | string[]
      fromOnboarding?: string | string[]
    }>()
  const resumeRegistration = parseResumeParam(resumeParam)
  const fromOnboardingRef = useRef(false)
  if (parseFromOnboardingParam(fromOnboardingParam)) {
    fromOnboardingRef.current = true
  }
  const { setBusiness, setUser } = useAuthStore()

  const [currentStep, setCurrentStep] = useState(
    () =>
      resumeRegistration ? 1 : (parseOnboardingStepParam(stepParam) ?? 1),
  )

  useEffect(() => {
    router.setParams({
      step: String(currentStep),
      ...(resumeRegistration ? { resume: '1' } : {}),
      ...(fromOnboardingRef.current ? { fromOnboarding: '1' } : {}),
    })
  }, [currentStep, router, resumeRegistration])

  useFocusEffect(
    useCallback(() => {
      if (resumeRegistration) return
      const fromUrl = parseOnboardingStepParam(stepParam)
      if (fromUrl != null) setCurrentStep(fromUrl)
    }, [stepParam, resumeRegistration]),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [profitGoalText, setProfitGoalText] = useState('')
  const [pendingRecoveryVerify, setPendingRecoveryVerify] = useState<{
    businessId: string
    email: string
  } | null>(null)
  /** OTP entry on step 3; successful verify creates the business profile and enters the app. */
  const [smsOtp, setSmsOtp] = useState('')
  const scrollRef = useRef<ScrollView>(null)
  const scrollContentRef = useRef<View>(null)
  const otpBlockRef = useRef<View>(null)
  const keyboardPaddingRef = useRef(0)
  const [keyboardPadding, setKeyboardPadding] = useState(0)
  const insets = useSafeAreaInsets()
  const headerKeyboardOffset = insets.top + 56

  const scrollOtpIntoView = useCallback(() => {
    const otp = otpBlockRef.current
    const content = scrollContentRef.current
    if (!otp || !content) return

    const kh = keyboardPaddingRef.current
    otp.measureInWindow((_ox, oy, _ow, oh) => {
      content.measureInWindow((_cx, cy) => {
        const relativeTop = oy - cy
        const windowHeight = Dimensions.get('window').height
        const visibleBottom = windowHeight - kh - headerKeyboardOffset
        const otpBottom = oy + oh
        const overlap = otpBottom - visibleBottom + 24
        const extraScroll = overlap > 0 ? overlap : 0
        scrollRef.current?.scrollTo({
          y: Math.max(0, relativeTop - 48 + extraScroll),
          animated: true,
        })
      })
    })
  }, [headerKeyboardOffset])

  useEffect(() => {
    if (currentStep !== 3 || resumeRegistration) return
    const t = setTimeout(scrollOtpIntoView, 250)
    return () => clearTimeout(t)
  }, [currentStep, resumeRegistration, scrollOtpIntoView])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const kh = e.endCoordinates.height
      keyboardPaddingRef.current = kh
      setKeyboardPadding(kh)
      if (currentStep === 3 && !resumeRegistration) {
        setTimeout(scrollOtpIntoView, Platform.OS === 'ios' ? 80 : 200)
      }
    })
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardPaddingRef.current = 0
      setKeyboardPadding(0)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [currentStep, resumeRegistration, scrollOtpIntoView])

  const {
    control,
    handleSubmit,
    trigger,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      businessName: '',
      businessType: '',
      ownerName: '',
      phone: '',
      loginUsername: '',
      password: '',
      confirmPassword: '',
      currency: '',
      monthlyProfitGoalCents: undefined,
      agreedToLegal: false,
      recoveryEmail: '',
    },
    mode: 'onTouched',
  })

  /** Phone-verified auth users finishing signup after login / app guard (skip OTP send). */
  useEffect(() => {
    if (!resumeRegistration) return
    let cancelled = false
    ;(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid || cancelled) return
      const { data: au } = await supabase
        .from('app_users')
        .select('phone')
        .eq('id', uid)
        .maybeSingle()
      if (!cancelled && au?.phone) {
        setValue('phone', au.phone)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resumeRegistration, setValue])

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const capturePendingProfile = () => {
    const vals = getValues()
    void savePendingBusinessProfile({
      businessName: vals.businessName,
      ownerName: vals.ownerName,
      phone: vals.phone,
      businessType: vals.businessType,
      currency: vals.currency || getPersonalisation(vals.businessType).currencyDefault || 'usd',
      loginUsername: vals.loginUsername || undefined,
    })
  }

  const goToSignIn = async () => {
    capturePendingProfile()
    try {
      await supabase.auth.signOut()
    } catch {
      /* already signed out */
    }
    setUser(null)
    setBusiness(null)
    router.replace('/(auth)/login')
  }

  const goBack = async () => {
    if (currentStep === 1) {
      if (resumeRegistration) {
        await goToSignIn()
        return
      }
      if (fromOnboardingRef.current) {
        router.replace('/(onboarding)/welcome')
        return
      }
      router.back()
      return
    }
    if (currentStep === 4) {
      setSmsOtp('')
      if (!resumeRegistration) {
        await supabase.auth.signOut()
      }
      setCurrentStep(3)
      return
    }
    if (currentStep === 3) {
      if (!resumeRegistration) {
        await supabase.auth.signOut()
      }
      setSmsOtp('')
      setCurrentStep(2)
      return
    }
    if (currentStep === 2) {
      setSmsOtp('')
      setCurrentStep(1)
      return
    }
    setCurrentStep(prev => prev - 1)
  }

  const handleResendSignupSms = async () => {
    const ph = getValues('phone')
    setIsLoading(true)
    try {
      const sent = await sendPhoneOtp(ph)
      if (!sent.success) {
        Alert.alert('Could not send code', sent.error ?? 'Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifySmsStep = async () => {
    const ph = getValues('phone')
    const pwd = getValues('password')
    const len = smsOtp.trim().length
    if (len !== 4) {
      Alert.alert('Enter code', 'Enter the 4-digit verification code from your SMS.')
      return
    }
    capturePendingProfile()
    setIsLoading(true)
    try {
      const result = await verifySignupOtp(ph, smsOtp.trim(), pwd)
      if (!result.success) {
        Alert.alert('Verification failed', result.error ?? 'Invalid or expired code.')
        return
      }

      const email = buildSupabaseEmailFromPhone(ph.trim())
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password: pwd,
      })

      if (signErr) {
        Alert.alert(
          'Signed up but login failed',
          signErr.message +
            '\n\nTry signing in manually with the same phone and password.',
        )
        return
      }

      const vals = getValues()
      const currency =
        vals.currency ||
        getPersonalisation(vals.businessType).currencyDefault ||
        'usd'
      const profile = await createBusinessProfile({
        businessName: vals.businessName,
        ownerName: vals.ownerName,
        phone: vals.phone,
        businessType: vals.businessType,
        currency,
        loginUsername: vals.loginUsername || undefined,
      })

      if (!profile.success) {
        Alert.alert(
          'Phone verified',
          profile.error +
            '\n\nSign in with the same phone and password to finish opening your account.',
        )
        return
      }

      await clearPendingBusinessProfile()
      setBusiness(profile.business)
      setUser(profile.user)

      if (profile.pendingRecoveryEmailVerification) {
        const { businessId, email: recoveryEmail } = profile.pendingRecoveryEmailVerification
        setPendingRecoveryVerify({ businessId, email: recoveryEmail })
        return
      }

      router.replace('/(app)')
    } finally {
      setIsLoading(false)
    }
  }

  const handleNext = async () => {
    const fields = STEP_FIELDS[currentStep] ?? []
    if (fields.length > 0) {
      const valid = await trigger(fields)
      if (!valid) return
    }
    if (currentStep === 1) {
      setCurrentStep(2)
      return
    }
    if (currentStep === 2) {
      const vals = getValues()
      setIsLoading(true)
      try {
        if (resumeRegistration) {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          const uid = session?.user?.id
          if (!uid) {
            Alert.alert('Session expired', 'Please log in again to finish registering.')
            return
          }
          const { data: au, error: auErr } = await supabase
            .from('app_users')
            .select('phone')
            .eq('id', uid)
            .maybeSingle()
          if (auErr || !au?.phone) {
            Alert.alert(
              'Could not verify account',
              auErr?.message ?? 'Try logging in again.',
            )
            return
          }
          if (au.phone.trim() !== vals.phone.trim()) {
            Alert.alert(
              'Phone mismatch',
              'Use the same phone number verified on your account.',
            )
            return
          }
          capturePendingProfile()
          setSmsOtp('')
          setCurrentStep(3)
          return
        }

        const sent = await sendPhoneOtp(vals.phone)
        if (!sent.success) {
          Alert.alert('Could not send code', sent.error ?? 'Please try again.')
          return
        }
        capturePendingProfile()
        setSmsOtp('')
        setCurrentStep(3)
      } finally {
        setIsLoading(false)
      }
      return
    }
    if (currentStep === 4) {
      handleSubmit(onSubmit)()
    }
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true)
    try {
      const loginUsername = data.loginUsername
      const recoveryEmailTrimmed = data.recoveryEmail ?? ''

      const result = await createBusinessProfile({
        businessName: data.businessName,
        ownerName: data.ownerName,
        phone: data.phone,
        businessType: data.businessType,
        currency: data.currency,
        recoveryEmail: recoveryEmailTrimmed || undefined,
        loginUsername: loginUsername || undefined,
      })

      if (!result.success) {
        Alert.alert('Registration Failed', result.error)
        setIsLoading(false)
        return
      }

      setBusiness(result.business)
      setUser(result.user)

      if (result.pendingRecoveryEmailVerification) {
        const { businessId, email } = result.pendingRecoveryEmailVerification
        setIsLoading(false)
        setPendingRecoveryVerify({ businessId, email })
        return
      }

      setIsLoading(false)
      router.replace('/(app)')
    } catch (err: unknown) {
      Alert.alert(
        'Registration Failed',
        (err as Error)?.message ?? 'An unexpected error occurred.',
      )
      setIsLoading(false)
    }
  }

  const handleRecoveryVerified = async () => {
    if (!pendingRecoveryVerify || !database) {
      setPendingRecoveryVerify(null)
      router.replace('/(app)')
      return
    }
    const { businessId, email } = pendingRecoveryVerify
    try {
      const { error: remoteErr } = await supabase
        .from('businesses')
        .update({
          recovery_email: email,
          recovery_email_verified: true,
        })
        .eq('id', businessId)

      if (remoteErr) {
        if (isMissingRecoveryColumnsError(remoteErr)) {
          Alert.alert(
            'Database update needed',
            'Your Supabase project is missing recovery email columns. Add them in the SQL Editor (see Settings screen comments), then verify your email again in Settings.',
          )
        } else {
          Alert.alert('Error', remoteErr.message)
        }
      } else {
        const records = await database.get<Business>('businesses').query().fetch()
        const localRecord = records.find((r) => r.id === businessId) ?? records[0]
        if (localRecord) {
          await database.write(async () => {
            await localRecord.update((b) => {
              b.recoveryEmail = email
              b.recoveryEmailVerified = true
            })
          })
        }

        const prev = useAuthStore.getState().business
        if (prev) {
          setBusiness({
            ...prev,
            recoveryEmail: email,
            recoveryEmailVerified: true,
          })
        }
        Alert.alert('Email verified!', 'Your recovery email is confirmed.')
      }
    } catch {
      Alert.alert('Error', 'Could not save verification. You can try again in Settings.')
    } finally {
      setPendingRecoveryVerify(null)
      router.replace('/(app)')
    }
  }

  const handleRecoverySkipped = () => {
    Alert.alert(
      'Recovery email',
      'You can verify your email later in Settings.',
    )
    setPendingRecoveryVerify(null)
    router.replace('/(app)')
  }

  // -------------------------------------------------------------------------
  // Step renders
  // -------------------------------------------------------------------------

  const renderStep1Business = () => (
    <>
      <Controller
        control={control}
        name="businessName"
        render={({ field: { onChange, value } }) => (
          <Input
            label="Business Name"
            placeholder="e.g. Chipo's Hardware"
            value={value}
            onChangeText={onChange}
            error={errors.businessName?.message}
            maxLength={60}
            autoCapitalize="words"
            editable={!isLoading}
          />
        )}
      />

      <View>
        <Text style={styles.fieldLabel}>Business Type</Text>
        <Controller
          control={control}
          name="businessType"
          render={({ field: { onChange, value } }) => (
            <PillSelector
              options={BUSINESS_TYPES}
              selected={value}
              onSelect={onChange}
              error={errors.businessType?.message}
            />
          )}
        />
      </View>
    </>
  )

  const renderStep2OwnerAndCredentials = () => (
    <>
      <Controller
        control={control}
        name="ownerName"
        render={({ field: { onChange, value } }) => (
          <Input
            label="Owner Name"
            placeholder="e.g. Chipo Moyo"
            value={value}
            onChangeText={onChange}
            error={errors.ownerName?.message}
            maxLength={60}
            autoCapitalize="words"
            editable={!isLoading}
          />
        )}
      />

      <Controller
        control={control}
        name="phone"
        render={({ field: { onChange, value } }) => (
          <Input
            label="Phone Number"
            placeholder="e.g. 0771234567"
            value={value}
            onChangeText={onChange}
            error={errors.phone?.message}
            hint="Your login uses this number (with a secure email alias behind the scenes)"
            keyboardType="number-pad"
            autoCapitalize="none"
            editable={!isLoading}
          />
        )}
      />

      <Controller
        control={control}
        name="recoveryEmail"
        render={({ field: { onChange, value } }) => (
          <Input
            label="Recovery Email"
            placeholder="your@email.com"
            value={value}
            onChangeText={onChange}
            error={errors.recoveryEmail?.message}
            hint="Recommended — used to recover your account if you lose access"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            leftIcon={<Ionicons name="mail-outline" size={18} color="#5A6A8A" />}
          />
        )}
      />

      <Controller
        control={control}
        name="loginUsername"
        render={({ field: { onChange, value } }) => (
          <Input
            label="Username (optional)"
            placeholder="e.g. chipo_hardware"
            value={value}
            onChangeText={t => onChange(t.toLowerCase())}
            error={errors.loginUsername?.message}
            hint="Optional alias for login — does not replace your phone-based account email"
            autoCapitalize="none"
            editable={!isLoading}
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, value } }) => (
          <Input
            label="Password"
            placeholder="Create a password"
            value={value}
            onChangeText={onChange}
            error={errors.password?.message}
            hint="Minimum 6 characters"
            secureTextEntry
            autoCapitalize="none"
            editable={!isLoading}
          />
        )}
      />

      <Controller
        control={control}
        name="confirmPassword"
        render={({ field: { onChange, value } }) => (
          <Input
            label="Confirm Password"
            placeholder="Repeat your password"
            value={value}
            onChangeText={onChange}
            error={errors.confirmPassword?.message}
            secureTextEntry
            autoCapitalize="none"
            editable={!isLoading}
          />
        )}
      />
    </>
  )

  const renderStep3Sms = () =>
    resumeRegistration ? (
      <>
        <Text style={styles.smsLead}>
          Your phone{' '}
          <Text style={styles.smsPhone}>{getValues('phone') || 'your number'}</Text>
          {' '}
          is already verified on this account. Continue to choose preferences and create your business profile.
        </Text>
      </>
    ) : (
      <>
        <Text style={styles.smsLead}>
          We sent a verification code to{' '}
          <Text style={styles.smsPhone}>{getValues('phone') || 'your number'}</Text>. Enter the 4-digit code below.
        </Text>
        <OTPInput
          value={smsOtp}
          onChange={setSmsOtp}
          disabled={isLoading}
          length={4}
          containerStyle={styles.otpInput}
          onFocus={scrollOtpIntoView}
        />
        <Text style={styles.smsHint}>Did not receive it? Wait up to a minute or tap Resend.</Text>
      </>
    )

  const renderStep4Preferences = () => (
    <>
      <View>
        <Text style={styles.fieldLabel}>Currency</Text>
        <Controller
          control={control}
          name="currency"
          render={({ field: { onChange, value } }) => (
            <PillSelector
              options={CURRENCY_OPTIONS}
              selected={value}
              onSelect={onChange}
              error={errors.currency?.message}
            />
          )}
        />
      </View>

      <Controller
        control={control}
        name="monthlyProfitGoalCents"
        render={({ field: { onChange } }) => (
          <Input
            label="Monthly Profit Goal"
            placeholder="e.g. 500"
            value={profitGoalText}
            onChangeText={text => {
              setProfitGoalText(text)
              const n = parseFloat(text)
              onChange(text === '' || isNaN(n) ? undefined : n)
            }}
            hint="Optional — helps track your progress"
            keyboardType="numeric"
            leftIcon={<Text style={styles.currencyPrefix}>$</Text>}
            editable={!isLoading}
          />
        )}
      />

      <Controller
        control={control}
        name="agreedToLegal"
        render={({ field: { onChange, value } }) => (
          <View>
            <View style={styles.privacyRow}>
              <TouchableOpacity
                onPress={() => onChange(!value)}
                style={styles.privacyCheckboxTouch}
                disabled={isLoading}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: value }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={value ? 'checkbox' : 'square-outline'}
                  size={22}
                  color="#0047AB"
                />
              </TouchableOpacity>
              <Text style={styles.privacyLabel}>
                I have read and agree to the{' '}
                <Text
                  onPress={() => router.push('/(auth)/terms-of-service')}
                  style={styles.privacyLink}
                >
                  Terms of Service
                </Text>
                {' and the '}
                <Text
                  onPress={() => router.push('/(auth)/privacy-policy')}
                  style={styles.privacyLink}
                >
                  Privacy Policy
                </Text>
              </Text>
            </View>
            {errors.agreedToLegal?.message != null && (
              <Text style={styles.errorText}>{errors.agreedToLegal.message}</Text>
            )}
          </View>
        )}
      />
    </>
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const stepMeta =
    resumeRegistration && currentStep === 3
      ? {
          title: 'Phone verified',
          subtitle: 'Continue to preferences and create your business profile',
          label: STEP_META[2].label,
        }
      : STEP_META[currentStep - 1] ?? STEP_META[0]

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Create Account"
        leftAction={{ icon: 'arrow-back', onPress: goBack }}
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerKeyboardOffset}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            currentStep === 1 && styles.scrollContentGrow,
            {
              paddingBottom:
                Math.max(insets.bottom, 12) +
                (Platform.OS === 'android' ? keyboardPadding : 0) +
                (keyboardPadding > 0 ? 64 : 24),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          showsVerticalScrollIndicator={keyboardPadding > 0 || currentStep >= 2}
          nestedScrollEnabled
        >
          <View
            ref={scrollContentRef}
            collapsable={false}
            style={[styles.content, currentStep === 1 && styles.contentGrow]}
          >
          {currentStep !== 3 ? (
            <View style={styles.brandMark}>
              <BrandLogo variant="full" width={72} height={72} />
            </View>
          ) : null}
          {/* Progress */}
          <View style={[styles.progressWrapper, currentStep === 3 && styles.progressWrapperCompact]}>
            <ProgressIndicator currentStep={currentStep} />
          </View>

          {/* Step heading */}
          <Text style={styles.stepTitle}>{stepMeta.title}</Text>
          <Text style={styles.stepSubtitle}>{stepMeta.subtitle}</Text>

          {/* Fields */}
          <View style={styles.fields}>
            {currentStep === 1 && renderStep1Business()}
            {currentStep === 2 && renderStep2OwnerAndCredentials()}
            {currentStep === 3 && (
              <View style={styles.verifySection}>
                <View ref={otpBlockRef} collapsable={false}>
                  {renderStep3Sms()}
                </View>
              </View>
            )}
            {currentStep === 4 && renderStep4Preferences()}
          </View>

          {/* Push button to bottom — only stretch on step 1 so steps 2–4 scroll freely */}
          {currentStep === 1 ? (
            <View style={styles.spacer} />
          ) : (
            <View style={styles.step3BottomGap} />
          )}

          {/* Primary action */}
          {currentStep === 3 ? (
            resumeRegistration ? (
              <Button
                label="Continue"
                onPress={() => setCurrentStep(4)}
                loading={isLoading}
                disabled={isLoading}
                fullWidth
              />
            ) : (
              <View style={styles.step3Actions}>
                <Button
                  label="Verify & continue"
                  onPress={handleVerifySmsStep}
                  loading={isLoading}
                  disabled={
                    isLoading ||
                    smsOtp.trim().length !== 4
                  }
                  fullWidth
                />
                <Button
                  label="Resend SMS code"
                  variant="ghost"
                  onPress={handleResendSignupSms}
                  loading={isLoading}
                  disabled={isLoading}
                  fullWidth
                />
              </View>
            )
          ) : (
            <Button
              label={currentStep === 4 ? 'Create Account' : 'Next'}
              onPress={handleNext}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
            />
          )}

          {/* Login link */}
          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => void goToSignIn()} disabled={isLoading}>
              <Text style={styles.loginLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <EmailVerificationModal
        visible={pendingRecoveryVerify != null}
        email={pendingRecoveryVerify?.email ?? ''}
        purpose="add_email"
        onSuccess={handleRecoveryVerified}
        onCancel={handleRecoverySkipped}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContentGrow: {
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  contentGrow: {
    flexGrow: 1,
  },
  brandMark: {
    alignItems: 'center',
    marginBottom: 20,
  },

  // Progress indicator
  progressWrapper: {
    marginBottom: 32,
  },
  progressWrapperCompact: {
    marginBottom: 16,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  progressStep: {
    alignItems: 'center',
    width: 72,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  progressDotActive: {
    backgroundColor: '#0047AB',
  },
  progressDotIdle: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#E9ECEF',
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E9ECEF',
    marginTop: 4,
  },
  progressLabel: {
    fontSize: 11,
  },
  progressLabelActive: {
    color: '#0047AB',
  },
  progressLabelIdle: {
    color: '#718096',
  },

  // Step heading
  stepTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A202C',
    marginBottom: 4,
  },
  stepSubtitle: {
    fontSize: 14,
    color: '#718096',
    marginBottom: 24,
  },

  // Fields
  fields: {
    gap: 16,
  },
  verifySection: {
    width: '100%',
  },
  otpInput: {
    marginVertical: 16,
    paddingHorizontal: 8,
  },
  smsLead: {
    fontSize: 15,
    color: '#4A5568',
    lineHeight: 22,
    marginBottom: 4,
  },
  smsPhone: {
    fontWeight: '600',
    color: '#1A202C',
  },
  smsHint: {
    fontSize: 13,
    color: '#718096',
    marginTop: 12,
    paddingHorizontal: 4,
  },
  step3Actions: {
    gap: 12,
  },
  step3BottomGap: {
    height: 24,
  },
  fieldLabel: {
    fontSize: 14,
    color: '#1A202C',
    fontWeight: '500',
    marginBottom: 8,
  },

  // Pills
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillActive: {
    backgroundColor: '#0047AB',
    borderColor: '#0047AB',
  },
  pillIdle: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E9ECEF',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  pillTextIdle: {
    color: '#718096',
  },

  // Error
  errorText: {
    fontSize: 12,
    color: '#E53E3E',
    marginTop: 4,
  },

  // Currency prefix
  currencyPrefix: {
    fontSize: 16,
    color: '#1A202C',
    fontWeight: '500',
  },

  // Bottom
  spacer: {
    flex: 1,
    minHeight: 24,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  loginText: {
    fontSize: 14,
    color: '#718096',
  },
  loginLink: {
    fontSize: 14,
    color: '#0047AB',
    fontWeight: '600',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  privacyCheckboxTouch: {
    marginTop: 2,
  },
  privacyLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#1A202C',
  },
  privacyLink: {
    color: '#0047AB',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
})
