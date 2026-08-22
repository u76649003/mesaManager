package com.mesamanager.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "WakeWord",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class WakeWordPlugin extends Plugin {
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            JSObject data = new JSObject();
            data.put("command", intent.getStringExtra(WakeWordService.EXTRA_COMMAND));
            notifyListeners("wakeCommand", data, true);
        }
    };

    @Override public void load() {
        ContextCompat.registerReceiver(
            getContext(), receiver, new IntentFilter(WakeWordService.ACTION_COMMAND),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(receiver); } catch (IllegalArgumentException ignored) {}
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneGranted");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void microphoneGranted(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Se necesita permiso de micrófono.");
            return;
        }
        startService(call);
    }

    private void startService(PluginCall call) {
        String name = call.getString("name", "Mara").trim();
        Intent intent = new Intent(getContext(), WakeWordService.class);
        intent.setAction(WakeWordService.ACTION_START);
        intent.putExtra(WakeWordService.EXTRA_NAME, name);
        ContextCompat.startForegroundService(getContext(), intent);
        JSObject result = new JSObject(); result.put("active", true); call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), WakeWordService.class);
        intent.setAction(WakeWordService.ACTION_STOP);
        getContext().startService(intent);
        JSObject result = new JSObject(); result.put("active", false); call.resolve(result);
    }
}
