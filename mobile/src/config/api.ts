import { Platform } from 'react-native';

// Android emulator uses 10.0.2.2 to reach host localhost
// iOS simulator uses localhost directly
const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_CONFIG = {
  baseUrl: `http://${DEV_HOST}:3000`,
};
