package com.mesamanager.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final int PERMISSION_REQ_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeWordPlugin.class);
        registerPlugin(LocalAIPlugin.class);
        super.onCreate(savedInstanceState);

        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().clearCache(true);
                this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(() -> request.grant(request.getResources()));
                    }
                });
            }
        } catch (Exception ignored) {}

        checkAndRequestVoicePermissions();
    }

    @Override
    public void onResume() {
        super.onResume();
        checkAndRequestVoicePermissions();
    }

    private void checkAndRequestVoicePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> needed = new ArrayList<>();
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.POST_NOTIFICATIONS);
                }
            }
            if (!needed.isEmpty()) {
                Log.i(TAG, "Requesting permissions natively on app startup: " + needed);
                ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERMISSION_REQ_CODE);
            } else {
                startWakeWordServiceIfGranted();
            }
        } else {
            startWakeWordServiceIfGranted();
        }
    }

    private void startWakeWordServiceIfGranted() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            try {
                Intent intent = new Intent(this, WakeWordService.class);
                intent.setAction(WakeWordService.ACTION_START);
                ContextCompat.startForegroundService(this, intent);
                Log.i(TAG, "WakeWordService started automatically after permission check");
            } catch (Exception e) {
                Log.w(TAG, "Error auto-starting WakeWordService", e);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_CODE) {
            for (int i = 0; i < permissions.length; i++) {
                if (Manifest.permission.RECORD_AUDIO.equals(permissions[i]) &&
                    grantResults.length > i && grantResults[i] == PackageManager.PERMISSION_GRANTED) {
                    Log.i(TAG, "RECORD_AUDIO permission granted by user!");
                    startWakeWordServiceIfGranted();
                    break;
                }
            }
        }
    }

    @Override
    public void onDestroy() {
        try {
            Intent serviceIntent = new Intent(this, WakeWordService.class);
            stopService(serviceIntent);
            LocalAIEngine.getInstance().unloadModel();
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
