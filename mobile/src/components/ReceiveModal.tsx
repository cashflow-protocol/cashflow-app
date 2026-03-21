import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import Clipboard from '@react-native-clipboard/clipboard';
import BottomSheet from './BottomSheet';
import { getVault } from '../services/vaultStorage';
import { logReceiveAddressCopy, logError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

const cashflowLogo = require('../assets/cashflow-logo-rounded.png');

import { IS_SOLANA_MOBILE } from '../config/constants';

interface ReceiveModalProps {
  visible: boolean;
  onClose: () => void;
  onFundFromSeeker?: () => void;
}

export default function ReceiveModal({ visible, onClose, onFundFromSeeker }: ReceiveModalProps) {
  const { colors } = useTheme();
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) {
      setAddress(null);
      setError(false);
      setCopied(false);
      (async () => {
        const vault = await getVault();
        if (vault?.vaultAddress) {
          setAddress(vault.vaultAddress);
        } else {
          logError('receive_modal', 'vault_address_not_found');
          setError(true);
        }
      })();
    }
  }, [visible]);

  const handleCopy = () => {
    if (!address) return;
    logReceiveAddressCopy();
    Clipboard.setString(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Receive</Text>

        {error ? (
          <View style={styles.errorContainer}>
            <Text style={[styles.errorText, { color: colors.errorText }]}>
              Unable to load vault address. Please set up your Squad vault first.
            </Text>
          </View>
        ) : !address ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.accentBlueDark} />
          </View>
        ) : (
          <>
            {/* QR Code */}
            <View style={styles.qrContainer}>
              <View style={[styles.qrWrapper, { borderColor: colors.border }]}>
                <QRCodeStyled
                  data={address}
                  style={styles.qrCode}
                  size={220}
                  padding={8}
                  color="#000"
                  pieceCornerType="rounded"
                  pieceBorderRadius={4}
                  errorCorrectionLevel="H"
                  outerEyesOptions={{
                    borderRadius: 12,
                    color: '#000',
                  }}
                  innerEyesOptions={{
                    borderRadius: 6,
                    color: '#000',
                  }}
                  logo={{
                    href: cashflowLogo,
                    padding: 4,
                    scale: 0.9,
                    hidePieces: true,
                  }}
                />
              </View>
            </View>

            {/* Address label */}
            <Text style={[styles.addressLabel, { color: colors.textSecondary }]}>Solana Deposit address:</Text>

            {/* Address - tap to copy */}
            <TouchableOpacity
              style={[styles.addressContainer, { backgroundColor: colors.inputBackground }]}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Text style={[styles.addressText, { color: colors.textPrimary }]}>
                {address}
              </Text>
            </TouchableOpacity>

            {copied && (
              <Text style={[styles.copiedText, { color: colors.successText }]}>Copied to clipboard</Text>
            )}

            {/* Copy button */}
            <TouchableOpacity
              style={[styles.copyButton, { backgroundColor: colors.primaryButton }]}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Text style={[styles.copyButtonText, { color: colors.primaryButtonText }]}>Copy address</Text>
            </TouchableOpacity>

            {/* From Seeker button — Solana Mobile only */}
            {IS_SOLANA_MOBILE && onFundFromSeeker && (
              <TouchableOpacity
                style={[styles.fromSeekerButton, { backgroundColor: colors.inputBackground }]}
                onPress={onFundFromSeeker}
                activeOpacity={0.7}
              >
                <Text style={[styles.fromSeekerButtonText, { color: colors.textPrimary }]}>From Seeker</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  loadingContainer: {
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
  },
  qrContainer: {
    alignItems: 'center',
    marginTop: 4,
  },
  qrWrapper: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  qrCode: {
    backgroundColor: '#fff',
  },
  addressLabel: {
    fontSize: 13,
    marginTop: 4,
  },
  addressContainer: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: '100%',
  },
  addressText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  copiedText: {
    fontSize: 13,
    marginTop: -8,
  },
  copyButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
  },
  copyButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
  fromSeekerButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
  },
  fromSeekerButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
