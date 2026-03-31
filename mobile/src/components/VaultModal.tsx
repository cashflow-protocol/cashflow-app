import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  ImageSourcePropType,
} from 'react-native';
import BottomSheet from './BottomSheet';
import type { EarnTokenType, EarnPosition } from '../types/earn';
import { getTokenIcon } from '../assets/token-icons';
import apiService from '../services/apiService';
import walletService from '../services/walletService';
import { getVault, type VaultData } from '../services/vaultStorage';
import { executeVaultTransaction } from '../services/squadsService';
import { useWallet } from '../hooks/useWallet';
import { getCloudPublicKey } from '../services/keypairStorage';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { logVaultModalOpen, logVaultModeSwitch, logVaultMaxPress, logVaultSubmit, logVaultSuccess, logVaultError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

const PROTOCOL_LABELS: Record<EarnTokenType, string> = {
  jupiter: 'Jupiter',
  kamino: 'Kamino',
  drift: 'Drift',
};
const PROTOCOL_ICONS: Record<EarnTokenType, ImageSourcePropType> = {
  jupiter: require('../assets/protocol-icons/jupiter.png'),
  kamino: require('../assets/protocol-icons/kamino.png'),
  drift: require('../assets/protocol-icons/drift.png'),
};
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_RENT_RESERVE = BigInt(10_000_000); // 0.01 SOL in lamports

/** Format amount with up to 9 decimals, trimming trailing zeros. Avoids scientific notation. */
function formatAmount(value: number): string {
  if (value === 0) return '0';
  const str = value.toFixed(9);
  return str.replace(/\.?0+$/, '');
}

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
  minDepositAmount?: string;
  minWithdrawAmount?: string;
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
  minDepositAmount,
  minWithdrawAmount,
}: VaultModalProps) {
  const { colors } = useTheme();
  const { wallet, connect, isConnecting } = useWallet();
  const walletAddress = wallet?.publicKey as string | undefined;
  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [vaultData, setVaultData] = useState<VaultData | null>(null);
  const [feePreview, setFeePreview] = useState<{ feeUiAmount: number; profitUiAmount: number } | null>(null);

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

  // Reset state and fetch balance when modal opens
  useEffect(() => {
    if (visible) {
      logVaultModalOpen(symbol, 'deposit');
      setMode('deposit');
      setAmount('');
      setLoading(false);
      setResult(null);
      setWalletBalance(null);
      setVaultData(null);

      (async () => {
        const vault = await getVault();
        setVaultData(vault);

        // Use vault address for balance if available, otherwise connected wallet
        const balanceAddr = vault?.vaultAddress ?? walletAddress;
        if (!balanceAddr) return;
        try {
          const { amount } = await apiService.getWalletBalance(balanceAddr, mint);
          setWalletBalance(BigInt(amount));
        } catch {
          setWalletBalance(null);
        }
      })();
    }
  }, [visible, mint, walletAddress]);

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

  // Fetch fee preview when withdraw amount changes (debounced)
  useEffect(() => {
    if (mode !== 'withdraw' || !isValidAmount || !vaultData?.vaultAddress) {
      setFeePreview(null);
      return;
    }
    const rawAmount = parsedRaw.toString();
    const timeout = setTimeout(() => {
      apiService.getFeePreview(vaultData.vaultAddress, mint, rawAmount)
        .then((data) => setFeePreview({ feeUiAmount: data.feeUiAmount, profitUiAmount: data.profitUiAmount }))
        .catch(() => setFeePreview(null));
    }, 300);
    return () => clearTimeout(timeout);
  }, [mode, amount, mint, vaultData?.vaultAddress]);
  const exceedsBalance =
    (mode === 'withdraw' && hasPosition && parsedRaw > BigInt(position!.balance.amount)) ||
    (mode === 'deposit' && walletBalance !== null && parsedRaw > walletBalance);
  const minAmountRaw = mode === 'deposit'
    ? BigInt(minDepositAmount || '0')
    : BigInt(minWithdrawAmount || '0');
  const belowMinimum = isValidAmount && minAmountRaw > 0n && parsedRaw < minAmountRaw;
  const canSubmit = isValidAmount && !exceedsBalance && !belowMinimum && !loading;

  const handleMaxPress = () => {
    logVaultMaxPress(mode, symbol);
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

    logVaultSubmit(mode, symbol, amount, type);
    setLoading(true);
    setResult(null);

    try {
      // Use cloud wallet as the template signer for Jupiter API calls.
      // The backend replaces this with the vault PDA in the actual instructions.
      const addr = await getCloudPublicKey();
      if (!addr) {
        setResult({ success: false, message: 'Cloud wallet not found' });
        setLoading(false);
        return;
      }

      const rawAmount = parsedRaw.toString();
      let signature: string;

      if (vaultData) {
        // Squads vault flow: get raw instructions, execute via multisig
        const instrParams = {
          type,
          mint,
          vaultAddress,
          amount: rawAmount,
          walletAddress: addr,
          ownerAddress: vaultData.vaultAddress,
        };

        const res = mode === 'deposit'
          ? await apiService.depositInstructions(instrParams)
          : await apiService.withdrawInstructions(instrParams);

        const result = await executeVaultTransaction(
          vaultData.multisigAddress,
          res.instructions,
          res.extraLookupTables,
        );
        signature = result.signature;

        // Submit bundle signatures so backend can match Helius webhook notifications
        apiService.submitBundleSignatures(res.transactionId, result.bundleSignatures).catch((err) => {
          console.error('Failed to submit bundle signatures:', err);
        });
      } else {
        // Legacy flow: get full unsigned transaction, sign with MWA
        const params = {
          type,
          mint,
          vaultAddress,
          amount: rawAmount,
          walletAddress: addr,
        };

        const res = mode === 'deposit'
          ? await apiService.deposit(params)
          : await apiService.withdraw(params);

        const txBytes = new Uint8Array(Buffer.from(res.transaction, 'base64'));
        const [sigBytes] = await walletService.signAndSendTransactions([txBytes]);
        signature = bs58.encode(sigBytes);
      }

      logVaultSuccess(mode, symbol, amount, type);
      console.log(`[VaultModal] ${mode} success, signature: ${signature}`);
      setResult({
        success: true,
        message: `Sent: ${signature.slice(0, 8)}...`,
      });

      // Refresh parent data after short delay so user sees the success message
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err) {
      logVaultError(mode, symbol, (err as Error).message || 'unknown');
      console.error(`[VaultModal] ${mode} error:`, (err as Error).message);
      setResult({
        success: false,
        message: (err as Error).message || 'Something went wrong',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard>

              {/* Vault header */}
              <View style={styles.vaultHeader}>
                <View style={styles.iconStack}>
                  <View style={[styles.tokenIconContainer, { backgroundColor: colors.cardSecondary }]}>
                    <Image source={localIcon ?? { uri: logoUrl }} style={styles.tokenIcon} />
                  </View>
                  <View style={[styles.protocolBadge, { backgroundColor: colors.sheetBackground, borderColor: colors.border }]}>
                    <Image source={PROTOCOL_ICONS[type]} style={styles.protocolIcon} />
                  </View>
                </View>
                <View style={styles.vaultInfo}>
                  <Text style={[styles.vaultTitle, { color: colors.textPrimary }]} numberOfLines={1}>{vaultTitle || `${PROTOCOL_LABELS[type]} - ${symbol}`}</Text>
                  <Text style={[styles.vaultApy, { color: colors.accentGreenDark }]}>{apyPercent}% APY</Text>
                </View>
              </View>

              {/* Mode toggle */}
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeButton, mode === 'deposit' && { backgroundColor: colors.pillButton }]}
                  onPress={() => { logVaultModeSwitch('deposit'); setMode('deposit'); setAmount(''); setResult(null); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modeText, { color: colors.textSecondary }, mode === 'deposit' && { color: colors.pillButtonText }]}>
                    Deposit
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeButton, mode === 'withdraw' && { backgroundColor: colors.pillButton }]}
                  onPress={() => { logVaultModeSwitch('withdraw'); setMode('withdraw'); setAmount(''); setResult(null); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modeText, { color: colors.textSecondary }, mode === 'withdraw' && { color: colors.pillButtonText }]}>
                    Withdraw
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Balance info - contextual per mode */}
              {mode === 'deposit' && (
                <View style={[styles.positionBar, { backgroundColor: colors.infoBackground }]}>
                  <Text style={[styles.positionLabel, { color: colors.textSecondary }]}>{vaultData ? 'Vault balance' : 'Wallet balance'}</Text>
                  <Text style={[styles.positionAmount, { color: colors.accentBlueDark }]}>
                    {walletBalance !== null ? `${toUiAmount(walletBalance, decimals)} ${symbol}` : '—'}
                  </Text>
                </View>
              )}
              {mode === 'withdraw' && hasPosition && (
                <View style={[styles.positionBar, { backgroundColor: colors.infoBackground }]}>
                  <Text style={[styles.positionLabel, { color: colors.textSecondary }]}>Your deposit</Text>
                  <Text style={[styles.positionAmount, { color: colors.accentBlueDark }]}>
                    {formatAmount(position!.balance.uiAmount)} {symbol}
                  </Text>
                </View>
              )}

              {/* Amount input */}
              <View style={[styles.inputRow, { backgroundColor: colors.inputBackground }]}>
                <TextInput
                  style={[styles.amountInput, { color: colors.textPrimary }]}
                  value={amount}
                  onChangeText={sanitizeAmount}
                  placeholder="0.00"
                  placeholderTextColor={colors.placeholderColor}
                  keyboardType="decimal-pad"
                  editable={!loading}
                />
                <Text style={[styles.inputSymbol, { color: colors.textSecondary }]}>{symbol}</Text>
                {((mode === 'withdraw' && hasPosition) || (mode === 'deposit' && walletBalance !== null)) && (
                  <TouchableOpacity style={[styles.maxButton, { backgroundColor: colors.pillButton }]} onPress={handleMaxPress}>
                    <Text style={[styles.maxText, { color: colors.pillButtonText }]}>MAX</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Validation error */}
              {exceedsBalance && (
                <Text style={[styles.validationError, { color: colors.errorText }]}>
                  {mode === 'withdraw' ? 'Exceeds your deposit balance' : 'Exceeds your wallet balance'}
                </Text>
              )}
              {belowMinimum && (
                <Text style={[styles.validationError, { color: colors.errorText }]}>
                  Minimum {mode} is {toUiAmount(minAmountRaw, decimals)} {symbol}
                </Text>
              )}


              {/* Result banner */}
              {result && (
                <View style={[styles.resultBanner, result.success ? { backgroundColor: colors.successBackground } : { backgroundColor: colors.errorBackground }]}>
                  <Text style={[styles.resultText, result.success ? { color: colors.successText } : { color: colors.errorText }]}>
                    {result.message}
                  </Text>
                </View>
              )}

              {/* Submit button */}
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: colors.primaryButton }, !canSubmit && { backgroundColor: colors.disabledButton }]}
                onPress={handleSubmit}
                activeOpacity={0.7}
                disabled={!canSubmit}
              >
                {loading ? (
                  <ActivityIndicator color={colors.primaryButtonText} />
                ) : (
                  <Text style={[styles.submitText, { color: colors.primaryButtonText }]}>
                    {mode === 'deposit' ? 'Deposit' : 'Withdraw'}
                  </Text>
                )}
              </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  vaultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconStack: {
    width: 48,
    height: 48,
  },
  tokenIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  tokenIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  protocolBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  protocolIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  vaultInfo: {
    flex: 1,
    gap: 2,
  },
  vaultTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  vaultApy: {
    fontSize: 14,
    fontWeight: '600',
  },
  positionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  positionLabel: {
    fontSize: 13,
  },
  positionAmount: {
    fontSize: 14,
    fontWeight: '600',
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
  modeText: {
    fontSize: 15,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: 14,
  },
  inputSymbol: {
    fontSize: 15,
    fontWeight: '600',
  },
  maxButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  maxText: {
    fontSize: 12,
    fontWeight: '700',
  },
  validationError: {
    fontSize: 13,
    marginTop: -8,
  },
  feeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  feeLabel: {
    fontSize: 13,
  },
  feeAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  resultBanner: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resultText: {
    fontSize: 14,
    fontWeight: '500',
  },
  submitButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
