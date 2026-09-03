package com.mesamanager.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(WakeWordPlugin.class);
        registerPlugin(LocalAIPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().clearCache(true);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        try {
            android.content.Intent serviceIntent = new android.content.Intent(this, WakeWordService.class);
            stopService(serviceIntent);
            LocalAIEngine.getInstance().unloadModel();
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
