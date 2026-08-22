package com.mesamanager.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(WakeWordPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
