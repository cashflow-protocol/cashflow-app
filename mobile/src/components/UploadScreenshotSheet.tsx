import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Image,
  Linking,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import BottomSheet from './BottomSheet';
import { uploadScreenshot } from '../services/onboardingService';
import { logScreenshotStoreOpen, logScreenshotImageSelected, logScreenshotSubmit, logScreenshotSuccess, logScreenshotError } from '../services/analyticsService';

interface UploadScreenshotSheetProps {
  visible: boolean;
  onClose: () => void;
  publicKey: string;
  taskId: string;
  storeUrl: string;
  onSuccess: (xpAwarded: number) => void;
}

export default function UploadScreenshotSheet({
  visible,
  onClose,
  publicKey,
  taskId,
  storeUrl,
  onSuccess,
}: UploadScreenshotSheetProps) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<{ uri: string; type: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePickImage = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 1200,
      maxHeight: 1200,
    });

    if (result.didCancel || !result.assets?.[0]) return;
    logScreenshotImageSelected();

    const asset = result.assets[0];
    setImageUri(asset.uri ?? null);
    setImageFile({
      uri: asset.uri!,
      type: asset.type || 'image/jpeg',
      name: asset.fileName || `screenshot_${Date.now()}.jpg`,
    });
    setError('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!imageFile) return;
    logScreenshotSubmit(taskId);
    setLoading(true);
    setError('');
    try {
      const result = await uploadScreenshot(publicKey, taskId, imageFile);
      if (result.success) {
        logScreenshotSuccess(taskId);
        onSuccess(result.xpAwarded ?? 300);
        handleReset();
      } else {
        logScreenshotError(taskId, 'upload_failed');
        setError('Upload failed. Please try again.');
      }
    } catch {
      logScreenshotError(taskId, 'exception');
      setError('Upload failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [imageFile, publicKey, taskId, onSuccess]);

  const handleReset = () => {
    setImageUri(null);
    setImageFile(null);
    setError('');
    setLoading(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      <Text style={styles.title}>Rate us on dApp Store</Text>
      <Text style={styles.subtitle}>
        Give us 5 stars, then upload a screenshot as proof.
      </Text>

      <TouchableOpacity
        style={styles.storeButton}
        onPress={() => { logScreenshotStoreOpen(); Linking.openURL(storeUrl); }}
        activeOpacity={0.7}
      >
        <Text style={styles.storeButtonText}>Open dApp Store</Text>
      </TouchableOpacity>

      {imageUri ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />
          <TouchableOpacity onPress={handlePickImage} activeOpacity={0.7}>
            <Text style={styles.linkText}>Choose different image</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.pickButton}
          onPress={handlePickImage}
          activeOpacity={0.7}
        >
          <Text style={styles.pickButtonText}>Select Screenshot</Text>
        </TouchableOpacity>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.submitButton, (!imageFile || loading) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!imageFile || loading}
        activeOpacity={0.7}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>Submit Screenshot</Text>
        )}
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  storeButton: {
    borderWidth: 2,
    borderColor: '#175DA3',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  storeButtonText: {
    color: '#175DA3',
    fontSize: 15,
    fontWeight: '700',
  },
  pickButton: {
    backgroundColor: '#F4F6FC',
    borderRadius: 12,
    paddingVertical: 40,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E0E4ED',
    borderStyle: 'dashed',
  },
  pickButtonText: {
    color: '#666',
    fontSize: 15,
    fontWeight: '600',
  },
  previewContainer: {
    alignItems: 'center',
    gap: 8,
  },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#F4F6FC',
  },
  error: {
    color: '#E53E3E',
    fontSize: 13,
  },
  submitButton: {
    backgroundColor: '#175DA3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  linkText: {
    color: '#175DA3',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
