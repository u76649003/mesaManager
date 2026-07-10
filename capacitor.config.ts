import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mesamanager.app',
  appName: 'MesaManager',
  webDir: 'public',
  server: {
    url: 'https://mesa-manager-738a5y91c-justojgds-projects.vercel.app',
    cleartext: true
  }
};

export default config;
