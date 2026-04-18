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
import BottomSheet from './BottomSheet';
import { getTokenIcon } from '../assets/token-icons';
import apiService from '../services/apiService';
import { getVault, type VaultData } from '../services/vaultStorage';
import { executeVaultTransaction } from '../services/squadsService';
import { useAssets } from '../hooks/useAssets';
import type { WalletAsset } from '../types/earn';
import {
  logSwapInputTokenSelect,
  logSwapOutputTokenSelect,
  logSwapMaxPress,
  logSwapFlipPress,
  logSwapSubmit,
  logSwapSuccess,
  logSwapError,
} from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

import { SEND_MAX_RESERVE } from '../config/constants';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

interface SwapToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
}

interface SwapQuote {
  outputAmount: string;
  outputUiAmount: number;
  priceImpactPct: number;
  minimumReceived: string;
  minimumReceivedUi: number;
}

type Step = 'selectInput' | 'selectOutput' | 'swap';

interface SwapModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SwapModal({ visible, onClose, onSuccess }: SwapModalProps) {
  const { colors } = useTheme();
  const { assets } = useAssets();
  const [step, setStep] = useState<Step>('selectInput');
  const [inputToken, setInputToken] = useState<WalletAsset | null>(null);
  const [outputToken, setOutputToken] = useState<SwapToken | null>(null);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [vaultData, setVaultData] = useState<VaultData | null>(null);
  const [popularTokens, setPopularTokens] = useState<SwapToken[]>([]);
  const [search, setSearch] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setStep('selectInput');
      setInputToken(null);
      setOutputToken(null);
      setAmount('');
      setQuote(null);
      setQuoteLoading(false);
      setLoading(false);
      setResult(null);
      setVaultData(null);
      setSearch('');

      (async () => {
        const vault = await getVault();
        setVaultData(vault);

        try {
          const tokens = await apiService.getPopularTokens();
          setPopularTokens(tokens);
        } catch {
          setPopularTokens([]);
        }
      })();
    }
  }, [visible]);

  // Debounced quote fetch
  useEffect(() => {
    if (step !== 'swap' || !inputToken || !outputToken || !isValidAmount) {
      setQuote(null);
      return;
    }

    setQuoteLoading(true);
    const inputMint = inputToken.mint === 'native' ? SOL_MINT : inputToken.mint;
    const rawAmount = toRawAmount(amount, inputToken.decimals).toString();

    const timeout = setTimeout(() => {
      apiService.swapQuote({
        inputMint,
        outputMint: outputToken.mint,
        amount: rawAmount,
      })
        .then((data) => { setQuote(data); setQuoteLoading(false); })
        .catch(() => { setQuote(null); setQuoteLoading(false); });
    }, 300);

    return () => clearTimeout(timeout);
  }, [step, amount, inputToken?.mint, outputToken?.mint]);

  // Filter assets with balance > 0, then by search
  const sendableAssets = assets.filter((a) => {
    if (a.uiAmount <= 0) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return a.symbol.toLowerCase().includes(q)
      || a.name.toLowerCase().includes(q)
      || a.mint.toLowerCase().includes(q);
  });

  // Output token list: popular tokens + user's other assets, excluding input token
  const outputTokenList = (() => {
    const inputMint = inputToken?.mint;
    const q = search.toLowerCase();

    const popular = popularTokens.filter((t) => {
      if (t.mint === inputMint || (inputMint === 'native' && t.mint === SOL_MINT)) return false;
      if (!search) return true;
      return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
    });

    const popularMints = new Set(popular.map(t => t.mint));
    const userTokens = assets
      .filter((a) => {
        if (a.mint === inputMint) return false;
        if (popularMints.has(a.mint) || (a.mint === 'native' && popularMints.has(SOL_MINT))) return false;
        if (!search) return true;
        return a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
      })
      .map((a): SwapToken => ({
        mint: a.mint === 'native' ? SOL_MINT : a.mint,
        symbol: a.symbol,
        name: a.name,
        decimals: a.decimals,
        logoUrl: a.logoUrl,
      }));

    return { popular, userTokens };
  })();

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

  const handleSelectInput = (asset: WalletAsset) => {
    logSwapInputTokenSelect(asset.symbol, asset.mint);
    setInputToken(asset);
    setStep('selectOutput');
    setSearch('');
    setAmount('');
    setQuote(null);
    setResult(null);
  };

  const handleSelectOutput = (token: SwapToken) => {
    logSwapOutputTokenSelect(token.symbol, token.mint);
    setOutputToken(token);
    setStep('swap');
    setSearch('');
    setAmount('');
    setQuote(null);
    setResult(null);
  };

  const handleBack = () => {
    if (step === 'swap') {
      setStep('selectOutput');
    } else if (step === 'selectOutput') {
      setStep('selectInput');
      setInputToken(null);
    }
    setSearch('');
    setAmount('');
    setQuote(null);
    setResult(null);
  };

  const handleMaxPress = () => {
    if (!inputToken) return;
    logSwapMaxPress(inputToken.symbol);
    let maxRaw = BigInt(inputToken.amount);
    if (inputToken.mint === 'native' || inputToken.mint === SOL_MINT) {
      maxRaw = maxRaw > BigInt(SEND_MAX_RESERVE) ? maxRaw - BigInt(SEND_MAX_RESERVE) : 0n;
    }
    setAmount(toUiAmount(maxRaw, inputToken.decimals));
  };

  const handleFlip = () => {
    if (!inputToken || !outputToken) return;
    logSwapFlipPress();

    // Find the output token in user assets to make it the new input
    const newInputAsset = assets.find(
      (a) => a.mint === outputToken.mint || (a.mint === 'native' && outputToken.mint === SOL_MINT),
    );

    const newOutput: SwapToken = {
      mint: inputToken.mint === 'native' ? SOL_MINT : inputToken.mint,
      symbol: inputToken.symbol,
      name: inputToken.name,
      decimals: inputToken.decimals,
      logoUrl: inputToken.logoUrl,
    };

    if (newInputAsset) {
      setInputToken(newInputAsset);
      setOutputToken(newOutput);
    } else {
      // User doesn't hold the output token — can't flip
      setOutputToken(newOutput);
      setInputToken(null);
      setStep('selectInput');
    }
    setAmount('');
    setQuote(null);
    setResult(null);
  };

  // Validation
  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const parsedRaw = isValidAmount && inputToken ? toRawAmount(amount, inputToken.decimals) : 0n;
  const isSol = inputToken && (inputToken.mint === 'native' || inputToken.mint === SOL_MINT);
  const maxSendable = inputToken
    ? (() => {
        const bal = BigInt(inputToken.amount);
        if (isSol) return bal > BigInt(SEND_MAX_RESERVE) ? bal - BigInt(SEND_MAX_RESERVE) : 0n;
        return bal;
      })()
    : 0n;
  const exceedsBalance = inputToken && isValidAmount && parsedRaw > maxSendable;
  const canSubmit = isValidAmount && !exceedsBalance && quote !== null && !quoteLoading && !loading && vaultData !== null;

  const handleSubmit = async () => {
    if (!canSubmit || !inputToken || !outputToken || !vaultData) return;

    logSwapSubmit(inputToken.symbol, outputToken.symbol, amount);
    setLoading(true);
    setResult(null);

    try {
      const inputMint = inputToken.mint === 'native' ? SOL_MINT : inputToken.mint;

      const res = await apiService.swapInstructions({
        inputMint,
        outputMint: outputToken.mint,
        amount: parsedRaw.toString(),
        walletAddress: vaultData.vaultAddress,
        ownerAddress: vaultData.vaultAddress,
      });

      await executeVaultTransaction(
        vaultData.multisigAddress,
        res.instructions,
        res.extraLookupTables,
        res.transactionId,
      );

      logSwapSuccess(inputToken.symbol, outputToken.symbol, amount);
      setResult({
        success: true,
        message: `Swapped ${amount} ${inputToken.symbol} for ${outputToken.symbol}`,
      });

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      const errMsg = (err as Error).message || 'unknown';
      logSwapError(inputToken.symbol, errMsg);

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

  const renderTokenRow = (token: { mint: string; symbol: string; name: string; logoUrl: string }, balance?: string, onPress?: () => void) => {
    const localIcon = getTokenIcon(token.mint);
    return (
      <TouchableOpacity
        key={token.mint}
        style={[styles.tokenRow, { borderBottomColor: colors.border }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <Image
          source={localIcon ?? { uri: token.logoUrl }}
          style={[styles.tokenIcon, { backgroundColor: colors.cardSecondary }]}
        />
        <View style={styles.tokenInfo}>
          <Text style={[styles.tokenSymbol, { color: colors.textPrimary }]}>{token.symbol}</Text>
          <Text style={[styles.tokenName, { color: colors.textSecondary }]}>{token.name}</Text>
        </View>
        {balance && (
          <Text style={[styles.tokenBalance, { color: colors.textPrimary }]}>{balance}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard>
      <View style={styles.header}>
        {step !== 'selectInput' && (
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
        <Text style={[styles.title, { color: colors.textPrimary }]}>Convert</Text>
      </View>

      {/* Step: Select Input Token */}
      {step === 'selectInput' && (
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
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {search ? 'No matching tokens' : 'No tokens available'}
              </Text>
            ) : (
              sendableAssets.map((asset) =>
                renderTokenRow(
                  asset,
                  asset.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 }),
                  () => handleSelectInput(asset),
                ),
              )
            )}
          </ScrollView>
        </>
      )}

      {/* Step: Select Output Token */}
      {step === 'selectOutput' && (
        <>
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.inputBackground, color: colors.textPrimary }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search tokens"
              placeholderTextColor={colors.placeholderColor}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ScrollView style={styles.tokenList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {outputTokenList.popular.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Popular</Text>
                {outputTokenList.popular.map((token) =>
                  renderTokenRow(token, undefined, () => handleSelectOutput(token)),
                )}
              </>
            )}
            {outputTokenList.userTokens.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Your tokens</Text>
                {outputTokenList.userTokens.map((token) =>
                  renderTokenRow(token, undefined, () => handleSelectOutput(token)),
                )}
              </>
            )}
            {outputTokenList.popular.length === 0 && outputTokenList.userTokens.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No tokens found</Text>
            )}
          </ScrollView>
        </>
      )}

      {/* Step: Swap */}
      {step === 'swap' && inputToken && outputToken && (
        <View style={styles.swapStep}>
          {/* Input token header */}
          <View style={[styles.selectedHeader, { backgroundColor: colors.infoBackground }]}>
            <Image
              source={getTokenIcon(inputToken.mint) ?? { uri: inputToken.logoUrl }}
              style={styles.selectedIcon}
            />
            <Text style={[styles.selectedSymbol, { color: colors.textPrimary }]}>{inputToken.symbol}</Text>
            <Text style={[styles.selectedBalance, { color: colors.textSecondary }]}>
              {inputToken.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })} available
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
            <Text style={[styles.inputSymbol, { color: colors.textSecondary }]}>{inputToken.symbol}</Text>
            <TouchableOpacity style={[styles.maxButton, { backgroundColor: colors.pillButton }]} onPress={handleMaxPress}>
              <Text style={[styles.maxText, { color: colors.pillButtonText }]}>MAX</Text>
            </TouchableOpacity>
          </View>

          {/* Flip button */}
          <TouchableOpacity style={[styles.flipButton, { backgroundColor: colors.cardSecondary }]} onPress={handleFlip} activeOpacity={0.7}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" stroke={colors.textPrimary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>

          {/* Output token header */}
          <TouchableOpacity
            style={[styles.selectedHeader, { backgroundColor: colors.infoBackground }]}
            onPress={() => { setStep('selectOutput'); setSearch(''); setQuote(null); }}
            activeOpacity={0.7}
          >
            <Image
              source={getTokenIcon(outputToken.mint) ?? { uri: outputToken.logoUrl }}
              style={styles.selectedIcon}
            />
            <Text style={[styles.selectedSymbol, { color: colors.textPrimary }]}>{outputToken.symbol}</Text>
            <Text style={[styles.changeText, { color: colors.accentBlueDark }]}>Change</Text>
          </TouchableOpacity>

          {/* Quote display */}
          {quoteLoading && isValidAmount && (
            <View style={styles.quoteRow}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={[styles.quoteText, { color: colors.textSecondary }]}>Fetching quote...</Text>
            </View>
          )}
          {quote && !quoteLoading && (
            <View style={[styles.quoteContainer, { backgroundColor: colors.infoBackground }]}>
              <View style={styles.quoteRow}>
                <Text style={[styles.quoteLabel, { color: colors.textSecondary }]}>You receive</Text>
                <Text style={[styles.quoteValue, { color: colors.textPrimary }]}>
                  ~{quote.outputUiAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} {outputToken.symbol}
                </Text>
              </View>
              {quote.priceImpactPct > 0.01 && (
                <View style={styles.quoteRow}>
                  <Text style={[styles.quoteLabel, { color: colors.textSecondary }]}>Price impact</Text>
                  <Text style={[styles.quoteValue, { color: quote.priceImpactPct > 1 ? colors.errorText : colors.textSecondary }]}>
                    {quote.priceImpactPct.toFixed(2)}%
                  </Text>
                </View>
              )}
              <View style={styles.quoteRow}>
                <Text style={[styles.quoteLabel, { color: colors.textSecondary }]}>Minimum received</Text>
                <Text style={[styles.quoteValue, { color: colors.textSecondary }]}>
                  {quote.minimumReceivedUi.toLocaleString('en-US', { maximumFractionDigits: 6 })} {outputToken.symbol}
                </Text>
              </View>
            </View>
          )}

          {/* Validation errors */}
          {exceedsBalance && inputToken && (
            <Text style={[styles.validationError, { color: colors.errorText }]}>
              Max you can swap is {toUiAmount(maxSendable, inputToken.decimals)} {inputToken.symbol}
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
              <Text style={[styles.submitText, { color: colors.primaryButtonText }]}>Swap</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  swapStep: {
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
  changeText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
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
  flipButton: {
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quoteText: {
    fontSize: 13,
  },
  quoteContainer: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  quoteLabel: {
    fontSize: 13,
  },
  quoteValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  validationError: {
    fontSize: 13,
    marginTop: -4,
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
