import React from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
interface ComingSoonModalProps {
  visible: boolean;
  onClose: () => void;
  icon?: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export default function ComingSoonModal({
  visible,
  onClose,
  icon,
  title = 'Coming soon',
  subtitle = 'This feature is under development and will be available soon.',
}: ComingSoonModalProps) {
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
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={styles.modalContent}>
            {/* Handle bar */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* Icon */}
            {icon && (
              <View style={styles.iconContainer}>
                {icon}
              </View>
            )}

            {/* Title & subtitle */}
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            {/* Close button */}
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.closeButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    alignItems: 'center',
    gap: 16,
  },
  handleContainer: {
    alignItems: 'center',
    width: '100%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D0D0D0',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EEF4FB',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7B8D',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  closeButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
  },
  closeButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
});
