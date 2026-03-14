import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

function FaceIdIcon({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7 3H5a2 2 0 0 0-2 2v2" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M17 3h2a2 2 0 0 1 2 2v2" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7 21H5a2 2 0 0 1-2-2v-2" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M17 21h2a2 2 0 0 0 2-2v-2" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 11V9" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M16 11V9" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M12 11v2a1 1 0 0 1-1 1" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 16s1.5 2 4 2 4-2 4-2" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function FingerprintIcon({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2a10 10 0 0 1 7.38 16.75" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M12 2a10 10 0 0 0-7.38 16.75" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M12 6a6 6 0 0 1 6 6 13.5 13.5 0 0 1-1.14 5.46" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M6 12a6 6 0 0 1 6-6" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M12 10a2 2 0 0 1 2 2c0 2.17-.58 4.2-1.58 5.96" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M10 12a2 2 0 0 1 2-2" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M6.26 17.35A9.94 9.94 0 0 0 8.5 12" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

const PIN_LENGTH = 4;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BUTTON_SIZE = Math.min((SCREEN_WIDTH - 120) / 3, 80);

interface PinPadProps {
  title: string;
  subtitle?: string;
  error?: string;
  onComplete: (pin: string) => void;
  onCancel?: () => void;
  /** Optional callback to trigger biometric auth (shows Face ID / Biometrics button) */
  biometricAction?: () => void;
}

export default function PinPad({ title, subtitle, error, onComplete, onCancel, biometricAction }: PinPadProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const [shakeAnim] = useState(() => new Animated.Value(0));

  // Shake animation on error
  useEffect(() => {
    if (error) {
      setDigits([]);
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }
  }, [error, shakeAnim]);

  const handlePress = useCallback(
    (digit: string) => {
      setDigits((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = [...prev, digit];
        if (next.length === PIN_LENGTH) {
          // Small delay so the last dot fills before callback
          setTimeout(() => onComplete(next.join('')), 100);
        }
        return next;
      });
    },
    [onComplete],
  );

  const handleDelete = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1));
  }, []);

  const renderDots = () => (
    <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
      {Array.from({ length: PIN_LENGTH }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i < digits.length && styles.dotFilled]}
        />
      ))}
    </Animated.View>
  );

  const renderButton = (label: string, onPress: () => void) => (
    <TouchableOpacity
      key={label}
      style={styles.numButton}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Text style={styles.numText}>{label}</Text>
    </TouchableOpacity>
  );

  const renderEmpty = () => <View key="empty" style={styles.numButton} />;

  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {renderDots()}

      <View style={styles.grid}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((d) => renderButton(d, () => handlePress(d)))}
          </View>
        ))}
        <View style={styles.row}>
          {biometricAction ? (
            <TouchableOpacity
              key="biometric"
              style={styles.numButton}
              onPress={biometricAction}
              activeOpacity={0.6}
            >
              {Platform.OS === 'ios' ? (
                <FaceIdIcon size={32} />
              ) : (
                <FingerprintIcon size={32} />
              )}
            </TouchableOpacity>
          ) : renderEmpty()}
          {renderButton('0', () => handlePress('0'))}
          {renderButton('\u232B', handleDelete)}
        </View>
      </View>

      {onCancel && (
        <TouchableOpacity style={styles.cancelLink} onPress={onCancel}>
          <Text style={styles.cancelLinkText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 4,
    textAlign: 'center',
  },
  error: {
    fontSize: 14,
    color: '#FF6B6B',
    marginBottom: 4,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
    marginBottom: 40,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  grid: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'center',
  },
  numButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: {
    fontSize: 28,
    fontWeight: '400',
    color: '#fff',
  },
  cancelLink: {
    marginTop: 24,
    paddingVertical: 8,
  },
  cancelLinkText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.7)',
  },
});
