import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenHeader } from '../layout'
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_POLICY_INTRO,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_SECTIONS,
} from '../../legal/privacyPolicyContent'

type PrivacyPolicyViewProps = {
  onBack: () => void
}

export function PrivacyPolicyView({ onBack }: PrivacyPolicyViewProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScreenHeader
        title="Privacy Policy"
        leftAction={{ icon: 'arrow-back', onPress: onBack }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        <Text style={styles.effective}>
          Last updated: {PRIVACY_POLICY_LAST_UPDATED}
        </Text>

        <View style={styles.block}>
          <Text style={styles.h1}>{PRIVACY_POLICY_INTRO.title}</Text>
          {PRIVACY_POLICY_INTRO.paragraphs.map((p, i) => (
            <Text key={i} style={styles.p}>
              {p}
            </Text>
          ))}
        </View>

        {PRIVACY_POLICY_SECTIONS.map((section) => (
          <View key={section.title} style={styles.block}>
            <Text style={styles.h2}>{section.title}</Text>
            {section.paragraphs.map((p, i) => (
              <Text key={i} style={styles.p}>
                {p}
              </Text>
            ))}
          </View>
        ))}

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Questions? {PRIVACY_CONTACT_EMAIL}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  effective: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 20,
  },
  block: {
    marginBottom: 24,
  },
  h1: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A202C',
    marginBottom: 12,
  },
  h2: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0047AB',
    marginBottom: 10,
  },
  p: {
    fontSize: 15,
    lineHeight: 24,
    color: '#2D3748',
    marginBottom: 12,
  },
  footerNote: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  footerText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#718096',
  },
})
