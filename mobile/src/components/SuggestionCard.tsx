import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import type { Suggestion } from '../types/earn';
import { logSuggestionCardPress } from '../services/analyticsService';

interface SuggestionCardProps {
  suggestion: Suggestion;
  compact?: boolean;
  onFundWallet?: () => void;
  onTransferPosition?: (suggestion: Suggestion) => void;
  onAddRecovery?: () => void;
}

export default function SuggestionCard({ suggestion, compact, onFundWallet, onTransferPosition, onAddRecovery }: SuggestionCardProps) {
  const accent = suggestion.color;

  const handlePress = () => {
    logSuggestionCardPress(suggestion.id, suggestion.type);
    switch (suggestion.type) {
      case 'link':
        if (suggestion.url) Linking.openURL(suggestion.url);
        break;
      case 'fund_wallet_from_seeker':
        onFundWallet?.();
        break;
      case 'transfer_position':
        onTransferPosition?.(suggestion);
        break;
      case 'add_recovery':
        onAddRecovery?.();
        break;
    }
  };

  return (
    <View style={[styles.card, { borderLeftColor: accent }, compact && styles.cardCompact]}>
      <View style={styles.content}>
        <Text style={styles.title}>{suggestion.title}</Text>
        <Text style={styles.description}>{suggestion.description}</Text>
      </View>
      {suggestion.buttonTitle && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: accent }]}
          onPress={handlePress}
        >
          <Text style={styles.buttonText}>{suggestion.buttonTitle}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderLeftWidth: 4,
    padding: 16,
    gap: 12,
  },
  cardCompact: {
    width: 260,
  },
  content: {
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
  },
  description: {
    fontSize: 13,
    color: '#6B7B8D',
    lineHeight: 18,
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
