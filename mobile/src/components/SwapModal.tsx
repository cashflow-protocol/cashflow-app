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
import { getCloudPublicKey } from '../services/keypairStorage';
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

const DEFAULT_OUTPUT_TOKEN: SwapToken = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoUrl: '',
};

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

type Step = 'swap' | 'selectInput' | 'selectOutput';

interface SwapModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function formatWithCommas(value: string): string {
  if (!value) return '0';
  const parts = value.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function formatUsd(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SwapModal({ visible, onClose, onSuccess }: SwapModalProps) {
  const { colors } = useTheme();
  const { assets } = useAssets();
  const [step, setStep] = useState<Step>('swap');
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

  // Reset state when modal opens — default SOL → USDC
  useEffect(() => {
    if (visible) {
      setStep('swap');
      const solAsset = assets.find(a => a.mint === 'native');
      setInputToken(solAsset || null);
      setOutputToken(DEFAULT_OUTPUT_TOKEN);
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
      apiService.swapQuote({ inputMint, outputMint: outputToken.mint, amount: rawAmount })
        .then((data) => { setQuote(data); setQuoteLoading(false); })
        .catch(() => { setQuote(null); setQuoteLoading(false); });
    }, 300);

    return () => clearTimeout(timeout);
  }, [step, amount, inputToken?.mint, outputToken?.mint]);

  // ── Helpers ──

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

  // ── Token lists ──

  const sendableAssets = assets.filter((a) => {
    if (a.uiAmount <= 0) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.mint.toLowerCase().includes(q);
  });

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
        symbol: a.symbol, name: a.name, decimals: a.decimals, logoUrl: a.logoUrl,
      }));
    return { popular, userTokens };
  })();

  // ── Handlers ──

  const handleSelectInput = (asset: WalletAsset) => {
    logSwapInputTokenSelect(asset.symbol, asset.mint);
    setInputToken(asset);
    setStep('swap');
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

  const handlePercentPress = (pct: number) => {
    if (!inputToken) return;
    let raw = BigInt(inputToken.amount) * BigInt(pct) / 100n;
    if (inputToken.mint === 'native' || inputToken.mint === SOL_MINT) {
      const reserve = BigInt(SEND_MAX_RESERVE);
      const maxRaw = BigInt(inputToken.amount) > reserve ? BigInt(inputToken.amount) - reserve : 0n;
      if (raw > maxRaw) raw = maxRaw;
    }
    setAmount(toUiAmount(raw, inputToken.decimals));
  };

  const handleNumpad = (key: string) => {
    if (loading) return;
    setResult(null);
    if (key === 'MAX') { handleMaxPress(); return; }
    if (key === '75%') { handlePercentPress(75); return; }
    if (key === '50%') { handlePercentPress(50); return; }
    if (key === 'CLR') { setAmount(''); return; }
    if (key === 'DEL') { setAmount(prev => prev.slice(0, -1)); return; }
    if (key === '.') {
      if (amount.includes('.')) return;
      setAmount(prev => (prev || '0') + '.');
      return;
    }
    // Digit
    setAmount(prev => {
      if (prev === '0' && key !== '.') return key;
      return prev + key;
    });
  };

  const handleFlip = () => {
    if (!inputToken || !outputToken) return;
    logSwapFlipPress();
    const newInputAsset = assets.find(
      (a) => a.mint === outputToken.mint || (a.mint === 'native' && outputToken.mint === SOL_MINT),
    );
    const newOutput: SwapToken = {
      mint: inputToken.mint === 'native' ? SOL_MINT : inputToken.mint,
      symbol: inputToken.symbol, name: inputToken.name, decimals: inputToken.decimals, logoUrl: inputToken.logoUrl,
    };
    if (newInputAsset) {
      setInputToken(newInputAsset);
      setOutputToken(newOutput);
    } else {
      setOutputToken(newOutput);
      setInputToken(null);
      setStep('selectInput');
    }
    setAmount('');
    setQuote(null);
    setResult(null);
  };

  // ── Validation ──

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

  // USD values
  const inputPricePerToken = inputToken && inputToken.uiAmount > 0 ? inputToken.usdValue / inputToken.uiAmount : 0;
  const inputUsdValue = isValidAmount ? parsedAmount * inputPricePerToken : 0;

  // Exchange rate from quote
  const exchangeRate = quote && parsedAmount > 0 ? quote.outputUiAmount / parsedAmount : null;

  // Output USD approximation
  const outputUsd = quote ? inputUsdValue * (1 - quote.priceImpactPct / 100) : 0;

  // Button label
  const buttonLabel = (() => {
    if (loading) return '';
    if (!isValidAmount) return 'Enter an amount';
    if (exceedsBalance && inputToken) return `Insufficient ${inputToken.symbol} balance`;
    if (quoteLoading) return 'Fetching quote...';
    return 'Swap';
  })();
  const buttonDisabled = !canSubmit;

  // ── Submit ──

  const handleSubmit = async () => {
    if (!canSubmit || !inputToken || !outputToken || !vaultData) return;
    logSwapSubmit(inputToken.symbol, outputToken.symbol, amount);
    setLoading(true);
    setResult(null);
    try {
      const cloudKey = await getCloudPublicKey();
      if (!cloudKey) { setResult({ success: false, message: 'Cloud wallet not found' }); setLoading(false); return; }
      const inputMint = inputToken.mint === 'native' ? SOL_MINT : inputToken.mint;
      const res = await apiService.swapInstructions({
        inputMint, outputMint: outputToken.mint, amount: parsedRaw.toString(),
        walletAddress: cloudKey, ownerAddress: vaultData.vaultAddress,
      });
      await executeVaultTransaction(vaultData.multisigAddress, res.instructions, res.extraLookupTables, res.transactionId);
      logSwapSuccess(inputToken.symbol, outputToken.symbol, amount);
      setResult({ success: true, message: `Swapped ${amount} ${inputToken.symbol} for ${outputToken.symbol}` });
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (err) {
      const errMsg = (err as Error).message || 'unknown';
      logSwapError(inputToken.symbol, errMsg);
      const isSpendingLimit = errMsg.toLowerCase().includes('spending limit exceeded');
      setResult({
        success: false,
        message: isSpendingLimit ? 'Daily spending limit exceeded. You can increase your spending limit in Settings.' : errMsg || 'Something went wrong',
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Render helpers ──

  const renderTokenSelector = (
    token: { mint: string; symbol: string; logoUrl: string } | null,
    balance: string | null,
    onPress: () => void,
  ) => {
    if (!token) return null;
    const localIcon = getTokenIcon(token.mint);
    return (
      <TouchableOpacity style={[styles.tokenSelector, { backgroundColor: colors.cardSecondary }]} onPress={onPress} activeOpacity={0.7}>
        <Image source={localIcon ?? { uri: token.logoUrl }} style={styles.selectorIcon} />
        <View style={styles.selectorInfo}>
          <View style={styles.selectorNameRow}>
            <Text style={[styles.selectorSymbol, { color: colors.textPrimary }]}>{token.symbol}</Text>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path d="M9 18l6-6-6-6" stroke={colors.textSecondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          {balance !== null && (
            <Text style={[styles.selectorBalance, { color: colors.textSecondary }]}>{balance}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderTokenListRow = (token: { mint: string; symbol: string; name: string; logoUrl: string }, balance?: string, onPress?: () => void) => {
    const localIcon = getTokenIcon(token.mint);
    return (
      <TouchableOpacity key={token.mint} style={[styles.tokenRow, { borderBottomColor: colors.border }]} onPress={onPress} activeOpacity={0.7}>
        <Image source={localIcon ?? { uri: token.logoUrl }} style={[styles.tokenIcon, { backgroundColor: colors.cardSecondary }]} />
        <View style={styles.tokenInfo}>
          <Text style={[styles.tokenSymbol, { color: colors.textPrimary }]}>{token.symbol}</Text>
          <Text style={[styles.tokenName, { color: colors.textSecondary }]}>{token.name}</Text>
        </View>
        {balance && <Text style={[styles.tokenBalance, { color: colors.textPrimary }]}>{balance}</Text>}
      </TouchableOpacity>
    );
  };

  const NUMPAD_KEYS = [
    ['MAX', '1', '2', '3'],
    ['75%', '4', '5', '6'],
    ['50%', '7', '8', '9'],
    ['CLR', '.', '0', 'DEL'],
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard={step !== 'swap'}>

      {/* ── Token Selection Views ── */}
      {(step === 'selectInput' || step === 'selectOutput') && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => { setStep('swap'); setSearch(''); }}>
              <Svg width={24} height={24} viewBox="0 0 32 32" fill="none">
                <Path fillRule="evenodd" clipRule="evenodd" d="M26.3328 16.0001C26.3328 15.4478 25.885 15.0001 25.3328 15.0001L9.08041 15.0001L15.3733 8.70723C15.7638 8.3167 15.7638 7.68354 15.3733 7.29302C14.9828 6.90249 14.3496 6.90249 13.9591 7.29302L5.95909 15.293C5.56857 15.6835 5.56857 16.3167 5.95909 16.7072L13.9591 24.7072C14.3496 25.0978 14.9828 25.0978 15.3733 24.7072C15.7638 24.3167 15.7638 23.6835 15.3733 23.293L9.08041 17.0001L25.3328 17.0001C25.885 17.0001 26.3328 16.5524 26.3328 16.0001Z" fill={colors.textPrimary} />
              </Svg>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Select Token</Text>
          </View>
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.inputBackground, color: colors.textPrimary }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or symbol"
              placeholderTextColor={colors.placeholderColor}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ScrollView style={styles.tokenList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {step === 'selectInput' ? (
              sendableAssets.length === 0
                ? <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{search ? 'No matching tokens' : 'No tokens available'}</Text>
                : sendableAssets.map((asset) => renderTokenListRow(asset, asset.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 }), () => handleSelectInput(asset)))
            ) : (
              <>
                {outputTokenList.popular.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Popular</Text>
                    {outputTokenList.popular.map((token) => renderTokenListRow(token, undefined, () => handleSelectOutput(token)))}
                  </>
                )}
                {outputTokenList.userTokens.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Your tokens</Text>
                    {outputTokenList.userTokens.map((token) => renderTokenListRow(token, undefined, () => handleSelectOutput(token)))}
                  </>
                )}
                {outputTokenList.popular.length === 0 && outputTokenList.userTokens.length === 0 && (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No tokens found</Text>
                )}
              </>
            )}
          </ScrollView>
        </>
      )}

      {/* ── Main Swap View ── */}
      {step === 'swap' && (
        <View style={styles.swapView}>

          {/* Input token selector */}
          {renderTokenSelector(
            inputToken,
            inputToken ? `${inputToken.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : null,
            () => setStep('selectInput'),
          )}

          {/* Amount display */}
          <View style={styles.amountContainer}>
            <Text style={[styles.amountText, { color: amount ? colors.textPrimary : colors.textTertiary }]} numberOfLines={1} adjustsFontSizeToFit>
              {amount ? formatWithCommas(amount) : '0'}
            </Text>
            {isValidAmount && inputPricePerToken > 0 && (
              <Text style={[styles.amountUsd, { color: colors.textSecondary }]}>
                {formatUsd(inputUsdValue)}
              </Text>
            )}
          </View>

          {/* Flip button */}
          <View style={styles.flipRow}>
            <TouchableOpacity style={[styles.flipButton, { backgroundColor: colors.accentGreen }]} onPress={handleFlip} activeOpacity={0.7}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
          </View>

          {/* Output section */}
          <View style={[styles.outputSection, { backgroundColor: colors.cardSecondary }]}>
            <View style={styles.outputRow}>
              {/* Output token selector */}
              <TouchableOpacity style={styles.outputTokenLeft} onPress={() => setStep('selectOutput')} activeOpacity={0.7}>
                {outputToken && (
                  <>
                    <Image source={getTokenIcon(outputToken.mint) ?? { uri: outputToken.logoUrl }} style={styles.selectorIcon} />
                    <Text style={[styles.selectorSymbol, { color: colors.textPrimary }]}>{outputToken.symbol}</Text>
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path d="M9 18l6-6-6-6" stroke={colors.textSecondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </>
                )}
              </TouchableOpacity>
              {/* Output amount */}
              <View style={styles.outputAmountRight}>
                {quoteLoading && isValidAmount ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : quote ? (
                  <>
                    <Text style={[styles.outputAmount, { color: colors.textPrimary }]} numberOfLines={1}>
                      {quote.outputUiAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                    </Text>
                    <Text style={[styles.outputUsd, { color: colors.textSecondary }]}>
                      ~ {formatUsd(outputUsd)}{quote.priceImpactPct > 0.01 ? ` (${quote.priceImpactPct > 0 ? '-' : ''}${quote.priceImpactPct.toFixed(2)}%)` : ''}
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
          </View>

          {/* Exchange rate */}
          {exchangeRate !== null && inputToken && outputToken && (
            <View style={[styles.rateRow, { backgroundColor: colors.cardSecondary }]}>
              <Text style={[styles.rateText, { color: colors.textSecondary }]}>
                1 {inputToken.symbol} ≈ {exchangeRate.toLocaleString('en-US', { maximumFractionDigits: exchangeRate < 1 ? 6 : 2 })} {outputToken.symbol}
              </Text>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M9 18l6-6-6-6" stroke={colors.textSecondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          )}

          {/* Result banner */}
          {result && (
            <View style={[styles.resultBanner, result.success ? { backgroundColor: colors.successBackground } : { backgroundColor: colors.errorBackground }]}>
              <Text style={[styles.resultText, result.success ? { color: colors.successText } : { color: colors.errorText }]}>
                {result.message}
              </Text>
            </View>
          )}

          {/* Action button */}
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: buttonDisabled ? colors.primaryButton : colors.primaryButton }, buttonDisabled && { opacity: 0.6 }]}
            onPress={handleSubmit}
            activeOpacity={0.7}
            disabled={buttonDisabled}
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryButtonText} />
            ) : (
              <Text style={[styles.actionButtonText, { color: colors.primaryButtonText }]}>
                {buttonLabel}
              </Text>
            )}
          </TouchableOpacity>

          {/* Custom numpad */}
          <View style={styles.numpad}>
            {NUMPAD_KEYS.map((row, rowIdx) => (
              <View key={rowIdx} style={styles.numpadRow}>
                {row.map((key) => {
                  const isSpecial = ['MAX', '75%', '50%', 'CLR'].includes(key);
                  const isDel = key === 'DEL';
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[
                        styles.numpadKey,
                        isSpecial && [styles.numpadKeySpecial, { backgroundColor: colors.cardSecondary }],
                        isDel && [styles.numpadKeySpecial, { backgroundColor: colors.cardSecondary }],
                      ]}
                      onPress={() => handleNumpad(key)}
                      activeOpacity={0.5}
                    >
                      {isDel ? (
                        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                          <Path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" stroke={colors.textPrimary} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                          <Path d="M18 9l-6 6M12 9l6 6" stroke={colors.textPrimary} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      ) : (
                        <Text style={[
                          styles.numpadKeyText,
                          { color: isSpecial ? colors.accentGreen : colors.textPrimary },
                          !isSpecial && styles.numpadKeyTextLarge,
                        ]}>
                          {key}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // ── Header / Token Selection ──
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
  headerTitle: {
    fontSize: 20,
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

  // ── Swap View ──
  swapView: {
    gap: 6,
  },
  tokenSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  selectorIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  selectorInfo: {
    flex: 1,
    gap: 2,
  },
  selectorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectorSymbol: {
    fontSize: 16,
    fontWeight: '700',
  },
  selectorBalance: {
    fontSize: 13,
  },
  amountContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  amountText: {
    fontSize: 42,
    fontWeight: '600',
    letterSpacing: -1,
    maxWidth: '90%',
  },
  amountUsd: {
    fontSize: 14,
    marginTop: 2,
  },
  flipRow: {
    alignItems: 'center',
    marginVertical: -2,
  },
  flipButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outputSection: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  outputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  outputTokenLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  outputAmountRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  outputAmount: {
    fontSize: 18,
    fontWeight: '600',
  },
  outputUsd: {
    fontSize: 12,
    marginTop: 2,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rateText: {
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
  actionButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Numpad ──
  numpad: {
    gap: 6,
    marginTop: 4,
  },
  numpadRow: {
    flexDirection: 'row',
    gap: 6,
  },
  numpadKey: {
    flex: 1,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  numpadKeySpecial: {
    borderRadius: 10,
  },
  numpadKeyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  numpadKeyTextLarge: {
    fontSize: 22,
    fontWeight: '500',
  },
});
