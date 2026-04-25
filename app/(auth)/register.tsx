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

import React, { useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Ionicons } from '@expo/vector-icons'
import * as Crypto from 'expo-crypto'

import { Button, Input } from '../../src/components/ui'
import { EmailVerificationModal } from '../../src/components/auth/EmailVerificationModal'
import { BrandLogo, KeyboardAvoidingWrapper, ScreenHeader } from '../../src/components/layout'
import { database } from '../../src/database'
import Business from '../../src/database/models/Business'
import { supabase } from '../../src/lib/supabase'
import { sendEmailOTP } from '../../src/lib/emailOTP'
import { isMissingRecoveryColumnsError } from '../../src/lib/businessRemote'
import {
  buildSupabaseEmailFromPhone,
  isValidOptionalLoginUsername,
  normalizeOptionalLoginUsername,
} from '../../src/lib/authIdentity'
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_FIELDS: Record<number, Array<keyof RegisterFormData>> = {
  1: ['businessName', 'businessType'],
  2: ['ownerName', 'phone', 'loginUsername', 'recoveryEmail', 'password', 'confirmPassword'],
  3: ['currency'],
}

const BUSINESS_TYPES = [
  'Retail Shop',
  'Hardware',
  'Salon/Barber',
  'Restaurant/Takeaway',
  'Pharmacy',
  'Other',
]

const CURRENCY_OPTIONS: { label: string; value: string }[] = [
  { label: 'USD ($)', value: 'usd' },
  { label: 'ZiG', value: 'zig' },
  { label: 'Both', value: 'both' },
]

const STEP_META = [
  { title: 'Your Business', subtitle: 'Tell us about your business', label: 'Business' },
  { title: 'Your Details', subtitle: 'How do we reach you?', label: 'Owner' },
  { title: 'Almost Done', subtitle: 'Set your preferences', label: 'Preferences' },
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
      {([1, 2, 3] as const).map((step, index) => {
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
            {index < 2 && <View style={styles.progressLine} />}
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
  const { setBusiness, setUser } = useAuthStore()

  const [currentStep, setCurrentStep] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [profitGoalText, setProfitGoalText] = useState('')
  const [pendingRecoveryVerify, setPendingRecoveryVerify] = useState<{
    businessId: string
    email: string
  } | null>(null)

  const {
    control,
    handleSubmit,
    trigger,
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
      recoveryEmail: '',
    },
    mode: 'onTouched',
  })

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const goBack = () => {
    if (currentStep === 1) {
      router.back()
    } else {
      setCurrentStep(prev => prev - 1)
    }
  }

  const handleNext = async () => {
    const valid = await trigger(STEP_FIELDS[currentStep])
    if (!valid) return
    if (currentStep < 3) {
      setCurrentStep(prev => prev + 1)
    } else {
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
      const email = buildSupabaseEmailFromPhone(data.phone)

      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password: data.password,
        options: {
          data: {
            phone: data.phone,
            login_username: loginUsername || null,
          },
        },
      })

      if (signUpError) {
        let msg = signUpError.message
        if (msg.includes('User already registered')) {
          msg =
            'An account with this phone number already exists. Please login instead.'
        } else if (
          /invalid/i.test(msg) &&
          (/email/i.test(msg) || /address/i.test(msg))
        ) {
          msg =
            'Could not create this account. Check your phone number and try again.'
        } else if (/network|fetch/i.test(msg)) {
          msg = 'No internet connection. Please check your connection and try again.'
        }
        Alert.alert('Registration Failed', msg)
        setIsLoading(false)
        return
      }

      const user = authData?.user
      if (!user) {
        Alert.alert('Registration Failed', 'Unable to create account. Please try again.')
        setIsLoading(false)
        return
      }

      let businessId: string

      if (database) {
        const db = database
        try {
          const record = await db.write(async () =>
            db.get<Business>('businesses').create(b => {
              b.name = data.businessName
              b.ownerName = data.ownerName
              b.phone = data.phone
              b.businessType = data.businessType
              b.currency = data.currency
              b.zigRatePerUsd = 1
              b.loginUsername = loginUsername || null
              b.supabaseId = user.id
              b.recoveryEmail = recoveryEmailTrimmed || null
              b.recoveryEmailVerified = false
            }),
          )
          businessId = record.id
        } catch (dbErr: unknown) {
          Alert.alert(
            'Registration Failed',
            (dbErr as Error)?.message ?? 'Failed to save business locally.',
          )
          setIsLoading(false)
          return
        }
      } else {
        businessId = Crypto.randomUUID()
      }

      const insertBase = {
        id: businessId,
        name: data.businessName,
        owner_name: data.ownerName,
        phone: data.phone,
        business_type: data.businessType,
        currency: data.currency,
        zig_rate_per_usd: 1,
        login_username: loginUsername || null,
        user_id: user.id,
        created_at: new Date().toISOString(),
      }

      let insertError = (
        await supabase.from('businesses').insert({
          ...insertBase,
          recovery_email: recoveryEmailTrimmed || null,
          recovery_email_verified: false,
        })
      ).error

      if (insertError && isMissingRecoveryColumnsError(insertError)) {
        const retry = await supabase.from('businesses').insert(insertBase)
        insertError = retry.error
      }

      if (insertError) {
        let insMsg = insertError.message
        if (/unique|duplicate|23505/i.test(insMsg) && loginUsername) {
          insMsg = 'This username is already taken. Please choose another.'
        }
        Alert.alert('Registration Failed', insMsg)
        setIsLoading(false)
        return
      }

      setBusiness({
        id: businessId,
        name: data.businessName,
        ownerName: data.ownerName,
        phone: data.phone,
        businessType: data.businessType,
        currency: data.currency,
        zigRatePerUsd: 1,
        loginUsername: loginUsername || null,
        recoveryEmail: recoveryEmailTrimmed || undefined,
        recoveryEmailVerified: false,
      })
      setUser(user)

      if (recoveryEmailTrimmed) {
        const sent = await sendEmailOTP(recoveryEmailTrimmed, 'add_email')
        if (!sent.success) {
          Alert.alert(
            'Email verification',
            sent.error ??
              'Could not send a verification code. You can verify your email later in Settings.',
          )
        }
        setIsLoading(false)
        setPendingRecoveryVerify({ businessId, email: recoveryEmailTrimmed })
        return
      }

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

  const renderStep1 = () => (
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

  const renderStep2 = () => (
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
            hint="Required. Your sign-in email is always based on this number, not your username"
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

  const renderStep3 = () => (
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
    </>
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const stepMeta = STEP_META[currentStep - 1]

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Create Account"
        leftAction={{ icon: 'arrow-back', onPress: goBack }}
      />

      <KeyboardAvoidingWrapper>
        <View style={styles.content}>
          <View style={styles.brandMark}>
            <BrandLogo variant="full" width={72} height={72} />
          </View>
          {/* Progress */}
          <View style={styles.progressWrapper}>
            <ProgressIndicator currentStep={currentStep} />
          </View>

          {/* Step heading */}
          <Text style={styles.stepTitle}>{stepMeta.title}</Text>
          <Text style={styles.stepSubtitle}>{stepMeta.subtitle}</Text>

          {/* Fields */}
          <View style={styles.fields}>
            {currentStep === 1 && renderStep1()}
            {currentStep === 2 && renderStep2()}
            {currentStep === 3 && renderStep3()}
          </View>

          {/* Push button to bottom */}
          <View style={styles.spacer} />

          {/* Primary action */}
          <Button
            label={currentStep === 3 ? 'Create Account' : 'Next'}
            onPress={handleNext}
            loading={isLoading}
            disabled={isLoading}
            fullWidth
          />

          {/* Login link */}
          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text style={styles.loginLink}>Login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingWrapper>

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
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  brandMark: {
    alignItems: 'center',
    marginBottom: 20,
  },

  // Progress indicator
  progressWrapper: {
    marginBottom: 32,
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
})
