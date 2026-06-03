import { Ionicons } from '@expo/vector-icons'
import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { HELP_SUPPORT_FAQS, HELP_SUPPORT_INTRO } from '../../legal/helpSupportContent'
import { ScreenHeader } from '../layout'
import { SupportMessageModal } from './SupportMessageModal'

type HelpSupportViewProps = {
  onBack: () => void
}

function FaqAccordionItem({
  question,
  answer,
  expanded,
  onToggle,
}: {
  question: string
  answer: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <View style={styles.faqCard}>
      <TouchableOpacity
        style={styles.faqHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={styles.faqQuestion}>{question}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color="#0047AB"
          style={styles.faqChevron}
        />
      </TouchableOpacity>
      {expanded && (
        <View style={styles.faqBody}>
          <Text style={styles.faqAnswer}>{answer}</Text>
        </View>
      )}
    </View>
  )
}

export function HelpSupportView({ onBack }: HelpSupportViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [messageModalVisible, setMessageModalVisible] = useState(false)

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="Help & Support"
        leftAction={{ icon: 'arrow-back', onPress: onBack }}
        rightAction={{
          label: 'Send us a message',
          onPress: () => setMessageModalVisible(true),
          compact: true,
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        <Text style={styles.intro}>{HELP_SUPPORT_INTRO}</Text>
        {HELP_SUPPORT_FAQS.map((item) => (
          <FaqAccordionItem
            key={item.id}
            question={item.question}
            answer={item.answer}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId((current) => (current === item.id ? null : item.id))}
          />
        ))}
      </ScrollView>
      <SupportMessageModal
        visible={messageModalVisible}
        onClose={() => setMessageModalVisible(false)}
      />
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  intro: {
    fontSize: 14,
    color: '#5A6A8A',
    lineHeight: 21,
    marginBottom: 16,
  },
  faqCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E8ECF4',
    overflow: 'hidden',
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  faqQuestion: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#0D1B3E',
    lineHeight: 21,
  },
  faqChevron: {
    flexShrink: 0,
  },
  faqBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#F0F3F8',
  },
  faqAnswer: {
    fontSize: 14,
    color: '#5A6A8A',
    lineHeight: 21,
    paddingTop: 12,
  },
})
