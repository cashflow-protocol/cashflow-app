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

const cashflowLogo = require('../assets/cashflow-logo-rounded.png');

interface ReceiveModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function ReceiveModal({ visible, onClose }: ReceiveModalProps) {
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
          setError(true);
        }
      })();
    }
  }, [visible]);

  const handleCopy = () => {
    if (!address) return;
    Clipboard.setString(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.content}>
        <Text style={styles.title}>Receive</Text>

        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>
              Unable to load vault address. Please set up your Squad vault first.
            </Text>
          </View>
        ) : !address ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#175DA3" />
          </View>
        ) : (
          <>
            {/* QR Code */}
            <View style={styles.qrContainer}>
              <View style={styles.qrWrapper}>
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
            <Text style={styles.addressLabel}>Solana Deposit address:</Text>

            {/* Address - tap to copy */}
            <TouchableOpacity
              style={styles.addressContainer}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Text style={styles.addressText}>
                {address}
              </Text>
            </TouchableOpacity>

            {copied && (
              <Text style={styles.copiedText}>Copied to clipboard</Text>
            )}

            {/* Copy button */}
            <TouchableOpacity
              style={styles.copyButton}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Text style={styles.copyButtonText}>Copy address</Text>
            </TouchableOpacity>
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
    color: '#000',
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
    color: '#F95357',
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
    borderColor: '#E8EAF1',
    overflow: 'hidden',
  },
  qrCode: {
    backgroundColor: '#fff',
  },
  addressLabel: {
    fontSize: 13,
    color: '#6B7B8D',
    marginTop: 4,
  },
  addressContainer: {
    backgroundColor: '#F4F4F4',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: '100%',
  },
  addressText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    textAlign: 'center',
  },
  copiedText: {
    fontSize: 13,
    color: '#2E7D32',
    marginTop: -8,
  },
  copyButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
  },
  copyButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
});
