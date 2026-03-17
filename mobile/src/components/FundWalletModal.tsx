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
import { Buffer } from 'buffer';
import BottomSheet from './BottomSheet';
import { getTokenIcon } from '../assets/token-icons';
import apiService from '../services/apiService';
import walletService from '../services/walletService';
import { getVault } from '../services/vaultStorage';
import { useWallet } from '../hooks/useWallet';
import type { WalletAsset } from '../types/earn';
import { logFundWalletModalOpen, logFundWalletConnect, logFundWalletTokenSelect, logFundWalletMaxPress, logFundWalletSubmit, logFundWalletSuccess, logFundWalletError } from '../services/analyticsService';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
// Reserve 0.01 SOL for tx fees when sending SOL
const MIN_SOL_RESERVE = BigInt(10_000_000);

type Step = 'select' | 'amount';

interface FundWalletModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function FundWalletModal({ visible, onClose, onSuccess }: FundWalletModalProps) {
  const { wallet, connect, isConnecting } = useWallet();
  const [step, setStep] = useState<Step>('select');
  const [assets, setAssets] = useState<WalletAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [selectedToken, setSelectedToken] = useState<WalletAsset | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      logFundWalletModalOpen();
      setStep('select');
      setSelectedToken(null);
      setAmount('');
      setLoading(false);
      setResult(null);
      setSearch('');
      setAssets([]);

      (async () => {
        const vault = await getVault();
        setVaultAddress(vault?.vaultAddress ?? null);
      })();
    }
  }, [visible]);

  // Fetch MWA wallet assets when wallet is connected and modal is visible
  useEffect(() => {
    if (visible && wallet?.publicKey) {
      fetchWalletAssets();
    }
  }, [visible, wallet?.publicKey]);

  const fetchWalletAssets = async () => {
    if (!wallet?.publicKey) return;
    setAssetsLoading(true);
    try {
      const res = await apiService.getAssets(wallet.publicKey as string);
      setAssets(res.assets);
    } catch (err) {
      console.error('Failed to fetch MWA wallet assets:', err);
    } finally {
      setAssetsLoading(false);
    }
  };

  const handleConnect = async () => {
    logFundWalletConnect();
    const account = await connect();
    if (account) {
      // Assets will be fetched by the useEffect above
    }
  };

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
    logFundWalletTokenSelect(asset.symbol);
    setSelectedToken(asset);
    setStep('amount');
    setAmount('');
    setResult(null);
  };

  const handleBack = () => {
    setStep('select');
    setSelectedToken(null);
    setAmount('');
    setResult(null);
  };

  const handleMaxPress = () => {
    if (!selectedToken) return;
    logFundWalletMaxPress(selectedToken.symbol);
    let maxRaw = BigInt(selectedToken.amount);
    // Reserve SOL for fees if sending native SOL
    if (selectedToken.mint === 'native' || selectedToken.mint === SOL_MINT) {
      maxRaw = maxRaw > MIN_SOL_RESERVE ? maxRaw - MIN_SOL_RESERVE : 0n;
    }
    setAmount(toUiAmount(maxRaw, selectedToken.decimals));
  };

  // Validation
  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const parsedRaw = isValidAmount && selectedToken ? toRawAmount(amount, selectedToken.decimals) : 0n;
  const isSol = selectedToken && (selectedToken.mint === 'native' || selectedToken.mint === SOL_MINT);
  const maxSendable = selectedToken
    ? (() => {
        const bal = BigInt(selectedToken.amount);
        if (isSol) return bal > MIN_SOL_RESERVE ? bal - MIN_SOL_RESERVE : 0n;
        return bal;
      })()
    : 0n;
  const exceedsBalance = selectedToken && isValidAmount && parsedRaw > maxSendable;
  const canSubmit = isValidAmount && !exceedsBalance && !loading && vaultAddress !== null;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedToken || !vaultAddress || !wallet?.publicKey) return;

    logFundWalletSubmit(selectedToken.symbol, amount);
    setLoading(true);
    setResult(null);

    try {
      const mint = selectedToken.mint === 'native' ? SOL_MINT : selectedToken.mint;

      // Build unsigned transaction on backend
      const { transaction } = await apiService.buildTransfer({
        fromAddress: wallet.publicKey as string,
        toAddress: vaultAddress,
        mint,
        amount: parsedRaw.toString(),
        decimals: selectedToken.decimals,
      });

      // Decode base64 transaction to Uint8Array for MWA signing
      const txBytes = new Uint8Array(Buffer.from(transaction, 'base64'));

      // Sign and send via MWA
      await walletService.signAndSendTransactions([txBytes]);

      logFundWalletSuccess(selectedToken.symbol, amount);
      onSuccess();
      onClose();
    } catch (err) {
      logFundWalletError(selectedToken.symbol, (err as Error).message || 'unknown');
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
      <View style={styles.header}>
        {step === 'amount' && (
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Svg width={24} height={24} viewBox="0 0 32 32" fill="none">
              <Path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M26.3328 16.0001C26.3328 15.4478 25.885 15.0001 25.3328 15.0001L9.08041 15.0001L15.3733 8.70723C15.7638 8.3167 15.7638 7.68354 15.3733 7.29302C14.9828 6.90249 14.3496 6.90249 13.9591 7.29302L5.95909 15.293C5.56857 15.6835 5.56857 16.3167 5.95909 16.7072L13.9591 24.7072C14.3496 25.0978 14.9828 25.0978 15.3733 24.7072C15.7638 24.3167 15.7638 23.6835 15.3733 23.293L9.08041 17.0001L25.3328 17.0001C25.885 17.0001 26.3328 16.5524 26.3328 16.0001Z"
                fill="#242729"
              />
            </Svg>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>Fund Wallet</Text>
      </View>

      {/* Not connected — show connect button */}
      {!wallet ? (
        <View style={styles.connectSection}>
          <Text style={styles.connectText}>
            Connect your Solana Mobile wallet to transfer tokens to your vault.
          </Text>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectButtonText}>Connect Wallet</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : step === 'select' ? (
        <>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name, symbol, or mint"
              placeholderTextColor="#B2B2B2"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ScrollView style={styles.tokenList} showsVerticalScrollIndicator={false}>
            {assetsLoading ? (
              <ActivityIndicator size="small" color="#175DA3" style={{ paddingVertical: 32 }} />
            ) : sendableAssets.length === 0 ? (
              <Text style={styles.emptyText}>{search ? 'No matching tokens' : 'No tokens with balance'}</Text>
            ) : (
              sendableAssets.map((asset) => {
                const localIcon = getTokenIcon(asset.mint);
                return (
                  <TouchableOpacity
                    key={asset.mint}
                    style={styles.tokenRow}
                    onPress={() => handleSelectToken(asset)}
                    activeOpacity={0.7}
                  >
                    <Image
                      source={localIcon ?? { uri: asset.logoUrl }}
                      style={styles.tokenIcon}
                    />
                    <View style={styles.tokenInfo}>
                      <Text style={styles.tokenSymbol}>{asset.symbol}</Text>
                      <Text style={styles.tokenName}>{asset.name}</Text>
                    </View>
                    <Text style={styles.tokenBalance}>
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
          <View style={styles.selectedHeader}>
            <Image
              source={getTokenIcon(selectedToken.mint) ?? { uri: selectedToken.logoUrl }}
              style={styles.selectedIcon}
            />
            <Text style={styles.selectedSymbol}>{selectedToken.symbol}</Text>
            <Text style={styles.selectedBalance}>
              {selectedToken.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })} available
            </Text>
          </View>

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
            <Text style={styles.inputSymbol}>{selectedToken.symbol}</Text>
            <TouchableOpacity style={styles.maxButton} onPress={handleMaxPress}>
              <Text style={styles.maxText}>MAX</Text>
            </TouchableOpacity>
          </View>

          {/* Validation errors */}
          {exceedsBalance && selectedToken && (
            <Text style={styles.validationError}>
              Max you can send is {toUiAmount(maxSendable, selectedToken.decimals)} {selectedToken.symbol}
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
              <Text style={styles.submitText}>Fund</Text>
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
    color: '#000',
  },
  connectSection: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 24,
  },
  connectText: {
    fontSize: 15,
    color: '#6B7B8D',
    textAlign: 'center',
    lineHeight: 22,
  },
  connectButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  connectButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  searchRow: {
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#000',
  },
  tokenList: {
    height: 350,
  },
  emptyText: {
    fontSize: 15,
    color: '#6B7B8D',
    textAlign: 'center',
    paddingVertical: 32,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EAF1',
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F4F4F4',
  },
  tokenInfo: {
    flex: 1,
    gap: 2,
  },
  tokenSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  tokenName: {
    fontSize: 13,
    color: '#6B7B8D',
  },
  tokenBalance: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
  },
  amountStep: {
    gap: 12,
  },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EEF4FB',
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
    color: '#000',
  },
  selectedBalance: {
    flex: 1,
    fontSize: 13,
    color: '#6B7B8D',
    textAlign: 'right',
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
    backgroundColor: '#000',
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
    marginTop: -4,
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
    backgroundColor: '#000',
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
