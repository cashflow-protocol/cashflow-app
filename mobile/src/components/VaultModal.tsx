import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import type { EarnTokenType, EarnPosition } from '../types/earn';
import { getTokenIcon } from '../assets/token-icons';
import apiService from '../services/apiService';
import { getDevWalletAddress, signAndSendTransaction } from '../services/signingService';

const PROTOCOL_LABELS: Record<EarnTokenType, string> = {
  jupiter: 'Jupiter',
  kamino: 'Kamino',
  drift: 'Drift',
};
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_RENT_RESERVE = BigInt(10_000_000); // 0.01 SOL in lamports

interface VaultModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  type: EarnTokenType;
  mint: string;
  vaultAddress: string;
  vaultTitle: string;
  symbol: string;
  decimals: number;
  logoUrl: string;
  rewardsRate: number;
  position?: EarnPosition;
}

type Mode = 'deposit' | 'withdraw';

export default function VaultModal({
  visible,
  onClose,
  onSuccess,
  type,
  mint,
  vaultAddress,
  vaultTitle,
  symbol,
  decimals,
  logoUrl,
  rewardsRate,
  position,
}: VaultModalProps) {
  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  // Convert raw bigint amount to UI display string
  const toUiAmount = (raw: bigint, dec: number): string => {
    const divisor = BigInt(10 ** dec);
    const whole = raw / divisor;
    const frac = raw % divisor;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(dec, '0').replace(/0+$/, '');
    return `${whole}.${fracStr}`;
  };

  // Convert UI amount string to raw bigint
  const toRawAmount = (uiStr: string, dec: number): bigint => {
    const parts = uiStr.split('.');
    const whole = BigInt(parts[0] || '0');
    const fracStr = (parts[1] || '').padEnd(dec, '0').slice(0, dec);
    return whole * BigInt(10 ** dec) + BigInt(fracStr);
  };

  // Reset state and fetch wallet balance when modal opens
  useEffect(() => {
    if (visible) {
      setMode('deposit');
      setAmount('');
      setLoading(false);
      setResult(null);
      setWalletBalance(null);
      getDevWalletAddress().then((addr) => {
        setWalletAddress(addr);
        apiService.getWalletBalance(addr, mint)
          .then(({ amount }) => setWalletBalance(BigInt(amount)))
          .catch(() => setWalletBalance(null));
      });
    }
  }, [visible, mint]);

  const apyPercent = (rewardsRate / 100).toFixed(2);
  const localIcon = getTokenIcon(mint);
  const hasPosition = position != null && position.balance.uiAmount > 0;

  const sanitizeAmount = (text: string) => {
    const sanitized = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setAmount(sanitized);
  };

  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const parsedRaw = isValidAmount ? toRawAmount(amount, decimals) : 0n;
  const exceedsBalance =
    (mode === 'withdraw' && hasPosition && parsedRaw > BigInt(position!.balance.amount)) ||
    (mode === 'deposit' && walletBalance !== null && parsedRaw > walletBalance);
  const canSubmit = isValidAmount && !exceedsBalance && !loading && walletAddress !== null;

  const handleMaxPress = () => {
    if (mode === 'withdraw' && hasPosition) {
      setAmount(toUiAmount(BigInt(position!.balance.amount), decimals));
    } else if (mode === 'deposit' && walletBalance !== null) {
      let maxRaw = walletBalance;
      if (mint === SOL_MINT) {
        maxRaw = walletBalance > SOL_RENT_RESERVE ? walletBalance - SOL_RENT_RESERVE : 0n;
      }
      setAmount(toUiAmount(maxRaw, decimals));
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setLoading(true);
    setResult(null);

    const rawAmount = parsedRaw.toString();
    const params = {
      type,
      mint,
      vaultAddress,
      amount: rawAmount,
      walletAddress: walletAddress!,
    };

    try {
      // 1. Get unsigned transaction from backend
      const res = mode === 'deposit'
        ? await apiService.deposit(params)
        : await apiService.withdraw(params);

      // 2. Sign and send on-chain
      const { signature } = await signAndSendTransaction(res.transaction, res.transactionId);

      setResult({
        success: true,
        message: `Sent: ${signature.slice(0, 8)}...`,
      });

      // Refresh parent data after short delay so user sees the success message
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err) {
      setResult({
        success: false,
        message: (err as Error).message || 'Something went wrong',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalContent}>
              {/* Handle bar */}
              <View style={styles.handleContainer}>
                <View style={styles.handle} />
              </View>

              {/* Vault header */}
              <View style={styles.vaultHeader}>
                <View style={styles.tokenIconContainer}>
                  <Image source={localIcon ?? { uri: logoUrl }} style={styles.tokenIcon} />
                </View>
                <View style={styles.vaultInfo}>
                  <Text style={styles.vaultTitle} numberOfLines={1}>{vaultTitle || `${PROTOCOL_LABELS[type]} - ${symbol}`}</Text>
                  <Text style={styles.vaultApy}>{apyPercent}% APY</Text>
                </View>
              </View>

              {/* Mode toggle */}
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeButton, mode === 'deposit' && styles.modeButtonActive]}
                  onPress={() => { setMode('deposit'); setAmount(''); setResult(null); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modeText, mode === 'deposit' && styles.modeTextActive]}>
                    Deposit
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeButton, mode === 'withdraw' && styles.modeButtonActive]}
                  onPress={() => { setMode('withdraw'); setAmount(''); setResult(null); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modeText, mode === 'withdraw' && styles.modeTextActive]}>
                    Withdraw
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Balance info - contextual per mode */}
              {mode === 'deposit' && (
                <View style={styles.positionBar}>
                  <Text style={styles.positionLabel}>Wallet balance</Text>
                  <Text style={styles.positionAmount}>
                    {walletBalance !== null ? `${toUiAmount(walletBalance, decimals)} ${symbol}` : '—'}
                  </Text>
                </View>
              )}
              {mode === 'withdraw' && hasPosition && (
                <View style={styles.positionBar}>
                  <Text style={styles.positionLabel}>Your deposit</Text>
                  <Text style={styles.positionAmount}>
                    {position!.balance.uiAmount.toFixed(2)} {symbol}
                  </Text>
                </View>
              )}

              {/* Amount input */}
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={sanitizeAmount}
                  placeholder="0.00"
                  placeholderTextColor="#B2B2B2"
                  keyboardType="decimal-pad"
                  editable={!loading}
                />
                <Text style={styles.inputSymbol}>{symbol}</Text>
                {((mode === 'withdraw' && hasPosition) || (mode === 'deposit' && walletBalance !== null)) && (
                  <TouchableOpacity style={styles.maxButton} onPress={handleMaxPress}>
                    <Text style={styles.maxText}>MAX</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Validation error */}
              {exceedsBalance && (
                <Text style={styles.validationError}>
                  {mode === 'withdraw' ? 'Exceeds your deposit balance' : 'Exceeds your wallet balance'}
                </Text>
              )}

              {/* Result banner */}
              {result && (
                <View style={[styles.resultBanner, result.success ? styles.resultSuccess : styles.resultError]}>
                  <Text style={[styles.resultText, result.success ? styles.resultTextSuccess : styles.resultTextError]}>
                    {result.message}
                  </Text>
                </View>
              )}

              {/* Submit button */}
              <TouchableOpacity
                style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                activeOpacity={0.7}
                disabled={!canSubmit}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>
                    {mode === 'deposit' ? 'Deposit' : 'Withdraw'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  keyboardView: {
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 16,
  },
  handleContainer: {
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D0D0D0',
  },
  vaultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tokenIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F4F4F4',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  tokenIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  vaultInfo: {
    flex: 1,
    gap: 2,
  },
  vaultTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  vaultApy: {
    fontSize: 14,
    fontWeight: '600',
    color: '#138001',
  },
  positionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#EEF4FB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  positionLabel: {
    fontSize: 13,
    color: '#6B7B8D',
  },
  positionAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#175DA3',
  },
  modeToggle: {
    flexDirection: 'row',
    gap: 8,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#000000',
  },
  modeText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7B8D',
  },
  modeTextActive: {
    color: '#fff',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    paddingVertical: 14,
  },
  inputSymbol: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7B8D',
  },
  maxButton: {
    backgroundColor: '#000000',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  maxText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  validationError: {
    fontSize: 13,
    color: '#F95357',
    marginTop: -8,
  },
  resultBanner: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resultSuccess: {
    backgroundColor: '#E8F5E9',
  },
  resultError: {
    backgroundColor: '#FFEBEE',
  },
  resultText: {
    fontSize: 14,
    fontWeight: '500',
  },
  resultTextSuccess: {
    color: '#2E7D32',
  },
  resultTextError: {
    color: '#F95357',
  },
  submitButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#B2B2B2',
  },
  submitText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
});
