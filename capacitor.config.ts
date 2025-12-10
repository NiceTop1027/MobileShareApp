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
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f3f4f6'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#2563eb',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      androidSpinnerStyle: 'large',
      iosSpinnerStyle: 'small',
      spinnerColor: '#ffffff',
      splashFullScreen: true,
      splashImmersive: true
    }
  }
};

export default config;
