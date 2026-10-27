import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.metastudy.app',
  appName: 'MetaStudy',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    hostname: 'metastudy-e1ba2.web.app'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0f0b1e',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0f0b1e'
    }
  },
  android: {
    backgroundColor: '#0f0b1e'
  },
  ios: {
    backgroundColor: '#0f0b1e',
    contentInset: 'automatic'
  }
};

export default config;
