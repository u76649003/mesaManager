import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mesamanager.app',
  appName: 'MesaManager',
  webDir: 'public',
  server: {
    url: 'https://mesa-manager.vercel.app/',
    cleartext: true
  }
};

export default config;
