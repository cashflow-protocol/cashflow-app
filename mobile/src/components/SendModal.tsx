import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import BottomSheet from './BottomSheet';
import { getTokenIcon } from '../assets/token-icons';
import apiService from '../services/apiService';
import { getVault, type VaultData } from '../services/vaultStorage';
import { executeVaultTransaction } from '../services/squadsService';
import { useAssets } from '../hooks/useAssets';
import { useDomainResolution } from '../hooks/useDomainResolution';
import type { WalletAsset } from '../types/earn';
import { logSendTokenSelect, logSendMaxPress, logSendPasteAddress, logSendSubmit, logSendSuccess, logSendError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

import { SEND_MAX_RESERVE } from '../config/constants';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

type Step = 'select' | 'amount';

interface SendModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SendModal({ visible, onClose, onSuccess }: SendModalProps) {
  const { colors } = useTheme();
  const { assets } = useAssets();
  const [step, setStep] = useState<Step>('select');
  const [selectedToken, setSelectedToken] = useState<WalletAsset | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [vaultData, setVaultData] = useState<VaultData | null>(null);
  const [search, setSearch] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setStep('select');
      setSelectedToken(null);
      setAmount('');
      setRecipient('');
      setLoading(false);
      setResult(null);
      setVaultData(null);
      setSearch('');

      (async () => {
        const vault = await getVault();
        setVaultData(vault);
      })();
    }
  }, [visible]);

  // Filter assets with balance > 0, then by search query
  const sendableAssets = assets.filter((a) => {
    if (a.uiAmount <= 0) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return a.symbol.toLowerCase().includes(q)
      || a.name.toLowerCase().includes(q)
      || a.mint.toLowerCase().includes(q);
  });

  const toRawAmount = (uiStr: string, dec: number): bigint => {
    const parts = uiStr.split('.');
    const whole = BigInt(parts[0] || '0');
    const fracStr = (parts[1] || '').padEnd(dec, '0').slice(0, dec);
    return whole * BigInt(10 ** dec) + BigInt(fracStr);
  };

  const toUiAmount = (raw: bigint, dec: number): string => {
    const divisor = BigInt(10 ** dec);
    const whole = raw / divisor;
    const frac = raw % divisor;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(dec, '0').replace(/0+$/, '');
    return `${whole}.${fracStr}`;
  };

  const sanitizeAmount = (text: string) => {
    const sanitized = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setAmount(sanitized);
  };

  const handleSelectToken = (asset: WalletAsset) => {
    logSendTokenSelect(asset.symbol, asset.mint);
    setSelectedToken(asset);
    setStep('amount');
    setAmount('');
    setRecipient('');
    setResult(null);
  };

  const handleBack = () => {
    setStep('select');
    setSelectedToken(null);
    setAmount('');
    setRecipient('');
    setResult(null);
  };

  const handleMaxPress = () => {
    if (!selectedToken) return;
    logSendMaxPress(selectedToken.symbol);
    let maxRaw = BigInt(selectedToken.amount);
    // Reserve SOL for rent if sending native SOL
    if (selectedToken.mint === 'native' || selectedToken.mint === SOL_MINT) {
      maxRaw = maxRaw > BigInt(SEND_MAX_RESERVE) ? maxRaw - BigInt(SEND_MAX_RESERVE) : 0n;
    }
    setAmount(toUiAmount(maxRaw, selectedToken.decimals));
  };

  const handlePaste = async () => {
    logSendPasteAddress();
    const text = await Clipboard.getString();
    if (text) setRecipient(text.trim());
  };

  // Validation
  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const parsedRaw = isValidAmount && selectedToken ? toRawAmount(amount, selectedToken.decimals) : 0n;
  const isSol = selectedToken && (selectedToken.mint === 'native' || selectedToken.mint === SOL_MINT);
  const maxSendable = selectedToken
    ? (() => {
        const bal = BigInt(selectedToken.amount);
        if (isSol) return bal > BigInt(SEND_MAX_RESERVE) ? bal - BigInt(SEND_MAX_RESERVE) : 0n;
        return bal;
      })()
    : 0n;
  const exceedsBalance = selectedToken && isValidAmount && parsedRaw > maxSendable;
  const recipientTrimmed = recipient.trim();
  const { isDomain: isRecipientDomain, resolving: resolvingDomain, resolvedAddress, error: domainError } = useDomainResolution(recipient);
  const isRecipientAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipientTrimmed);
  const isValidRecipient = isRecipientAddress || (isRecipientDomain && !!resolvedAddress && !resolvingDomain && !domainError);
  const canSubmit = isValidAmount && !exceedsBalance && isValidRecipient && !loading && vaultData !== null;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedToken || !vaultData) return;

    logSendSubmit(selectedToken.symbol, amount);
    setLoading(true);
    setResult(null);

    try {
      const destinationAddress = isRecipientDomain && resolvedAddress ? resolvedAddress : recipientTrimmed;

      const mint = selectedToken.mint === 'native' ? SOL_MINT : selectedToken.mint;

      const res = await apiService.transferInstructions({
        mint,
        amount: parsedRaw.toString(),
        ownerAddress: vaultData.vaultAddress,
        destinationAddress,
        walletAddress: vaultData.vaultAddress,
        decimals: selectedToken.decimals,
      });

      const txResult = await executeVaultTransaction(
        vaultData.multisigAddress,
        res.instructions,
      );

      logSendSuccess(selectedToken.symbol, amount);
      onSuccess();
      onClose();
    } catch (err) {
      const errMsg = (err as Error).message || 'unknown';
      logSendError(selectedToken.symbol, errMsg);

      const isSpendingLimit = errMsg.toLowerCase().includes('spending limit exceeded');
      setResult({
        success: false,
        message: isSpendingLimit
          ? 'Daily spending limit exceeded. You can increase your spending limit in Settings.'
          : errMsg || 'Something went wrong',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard>
      <View style={styles.header}>
        {step === 'amount' && (
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Svg width={24} height={24} viewBox="0 0 32 32" fill="none">
              <Path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M26.3328 16.0001C26.3328 15.4478 25.885 15.0001 25.3328 15.0001L9.08041 15.0001L15.3733 8.70723C15.7638 8.3167 15.7638 7.68354 15.3733 7.29302C14.9828 6.90249 14.3496 6.90249 13.9591 7.29302L5.95909 15.293C5.56857 15.6835 5.56857 16.3167 5.95909 16.7072L13.9591 24.7072C14.3496 25.0978 14.9828 25.0978 15.3733 24.7072C15.7638 24.3167 15.7638 23.6835 15.3733 23.293L9.08041 17.0001L25.3328 17.0001C25.885 17.0001 26.3328 16.5524 26.3328 16.0001Z"
                fill={colors.textPrimary}
              />
            </Svg>
          </TouchableOpacity>
        )}
        <Text style={[styles.title, { color: colors.textPrimary }]}>Send</Text>
      </View>

      {step === 'select' ? (
        <>
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.inputBackground, color: colors.textPrimary }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name, symbol, or mint"
              placeholderTextColor={colors.placeholderColor}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ScrollView style={styles.tokenList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {sendableAssets.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{search ? 'No matching tokens' : 'No tokens available'}</Text>
            ) : (
              sendableAssets.map((asset) => {
                const localIcon = getTokenIcon(asset.mint);
                return (
                  <TouchableOpacity
                    key={asset.mint}
                    style={[styles.tokenRow, { borderBottomColor: colors.border }]}
                    onPress={() => handleSelectToken(asset)}
                    activeOpacity={0.7}
                  >
                    <Image
                      source={localIcon ?? { uri: asset.logoUrl }}
                      style={[styles.tokenIcon, { backgroundColor: colors.cardSecondary }]}
                    />
                    <View style={styles.tokenInfo}>
                      <Text style={[styles.tokenSymbol, { color: colors.textPrimary }]}>{asset.symbol}</Text>
                      <Text style={[styles.tokenName, { color: colors.textSecondary }]}>{asset.name}</Text>
                    </View>
                    <Text style={[styles.tokenBalance, { color: colors.textPrimary }]}>
                      {asset.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </>
      ) : selectedToken ? (
        <View style={styles.amountStep}>
          {/* Selected token header */}
          <View style={[styles.selectedHeader, { backgroundColor: colors.infoBackground }]}>
            <Image
              source={getTokenIcon(selectedToken.mint) ?? { uri: selectedToken.logoUrl }}
              style={styles.selectedIcon}
            />
            <Text style={[styles.selectedSymbol, { color: colors.textPrimary }]}>{selectedToken.symbol}</Text>
            <Text style={[styles.selectedBalance, { color: colors.textSecondary }]}>
              {selectedToken.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })} available
            </Text>
          </View>

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
            <Text style={[styles.inputSymbol, { color: colors.textSecondary }]}>{selectedToken.symbol}</Text>
            <TouchableOpacity style={[styles.maxButton, { backgroundColor: colors.pillButton }]} onPress={handleMaxPress}>
              <Text style={[styles.maxText, { color: colors.pillButtonText }]}>MAX</Text>
            </TouchableOpacity>
          </View>

          {/* Recipient input */}
          <View style={[styles.inputRow, { backgroundColor: colors.inputBackground }]}>
            <TextInput
              style={[styles.recipientInput, { color: colors.textPrimary }]}
              value={recipient}
              onChangeText={setRecipient}
              placeholder="Recipient address"
              placeholderTextColor={colors.placeholderColor}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            <TouchableOpacity style={[styles.pasteButton, { backgroundColor: colors.pillButton }]} onPress={handlePaste}>
              <Text style={[styles.pasteText, { color: colors.pillButtonText }]}>Paste</Text>
            </TouchableOpacity>
          </View>

          {/* Domain resolution helper */}
          {isRecipientDomain && resolvingDomain && (
            <View style={styles.helperRow}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={[styles.helperText, { color: colors.textSecondary }]}>Resolving {recipientTrimmed}...</Text>
            </View>
          )}
          {isRecipientDomain && resolvedAddress && !resolvingDomain && (
            <TouchableOpacity onPress={() => { Clipboard.setString(resolvedAddress); }} activeOpacity={0.7}>
              <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                → {truncateAddress(resolvedAddress)} (tap to copy)
              </Text>
            </TouchableOpacity>
          )}
          {isRecipientDomain && domainError && !resolvingDomain && (
            <Text style={[styles.validationError, { color: colors.errorText }]}>{domainError}</Text>
          )}

          {/* Validation errors */}
          {exceedsBalance && selectedToken && (
            <Text style={[styles.validationError, { color: colors.errorText }]}>
              Max you can send is {toUiAmount(maxSendable, selectedToken.decimals)} {selectedToken.symbol}
            </Text>
          )}
          {recipient.length > 0 && !isValidRecipient && !isRecipientDomain && !recipientTrimmed.includes('.') && (
            <Text style={[styles.validationError, { color: colors.errorText }]}>Invalid Solana address</Text>
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
              <Text style={[styles.submitText, { color: colors.primaryButtonText }]}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  backButton: {
    position: 'absolute',
    left: 0,
    padding: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  searchRow: {
    marginBottom: 8,
  },
  searchInput: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
  },
  tokenList: {
    height: 350,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 32,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  tokenInfo: {
    flex: 1,
    gap: 2,
  },
  tokenSymbol: {
    fontSize: 16,
    fontWeight: '600',
  },
  tokenName: {
    fontSize: 13,
  },
  tokenBalance: {
    fontSize: 15,
    fontWeight: '600',
  },
  amountStep: {
    gap: 12,
  },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectedIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  selectedSymbol: {
    fontSize: 16,
    fontWeight: '600',
  },
  selectedBalance: {
    flex: 1,
    fontSize: 13,
    textAlign: 'right',
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
  recipientInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 14,
  },
  pasteButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pasteText: {
    fontSize: 12,
    fontWeight: '700',
  },
  validationError: {
    fontSize: 13,
    marginTop: -4,
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
  },
  helperText: {
    fontSize: 13,
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
