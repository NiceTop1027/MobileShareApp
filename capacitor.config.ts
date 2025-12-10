import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.quickshare.app',
  appName: 'QuickShare',
  webDir: 'dist',
  server: {
    // For development, you can set the server URL here
    // url: 'http://192.168.1.100:5173',
    // cleartext: true
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#f3f4f6'
  }
};

export default config;
