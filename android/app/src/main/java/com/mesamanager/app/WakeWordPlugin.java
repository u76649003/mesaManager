package com.mesamanager.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "WakeWord",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class WakeWordPlugin extends Plugin implements TextToSpeech.OnInitListener {
    private static final String TAG = "WakeWordPlugin";
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingText = null;
    private boolean pendingExpectReply = false;
    private SpeechRecognizer speechRecognizer;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            JSObject data = new JSObject();
            data.put("command", intent.getStringExtra(WakeWordService.EXTRA_COMMAND));
            notifyListeners("wakeCommand", data, true);
        }
    };

    @Override public void load() {
        try {
            ContextCompat.registerReceiver(
                getContext(), receiver, new IntentFilter(WakeWordService.ACTION_COMMAND),
                ContextCompat.RECEIVER_NOT_EXPORTED
            );
        } catch (Exception ignored) {}
        initTts();
    }

    private void initTts() {
        try {
            tts = new TextToSpeech(getContext().getApplicationContext(), this);
        } catch (Exception e) {
            Log.e(TAG, "Error initializing TextToSpeech", e);
        }
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS && tts != null) {
            ttsReady = true;
            try {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                tts.setAudioAttributes(attrs);

                int res = tts.setLanguage(new Locale("es", "ES"));
                if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                    res = tts.setLanguage(new Locale("es"));
                    if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                        tts.setLanguage(Locale.getDefault());
                    }
                }
                tts.setSpeechRate(0.95f);
                tts.setPitch(1.0f);
            } catch (Exception e) {
                Log.w(TAG, "TTS locale error", e);
            }

            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) {
                    JSObject data = new JSObject();
                    data.put("state", "start");
                    notifyListeners("ttsState", data, true);
                }
                @Override public void onDone(String utteranceId) {
                    handleTtsFinished(utteranceId);
                }
                @Override public void onError(String utteranceId) {
                    handleTtsFinished(utteranceId);
                }
            });

            if (pendingText != null) {
                String t = pendingText;
                boolean exp = pendingExpectReply;
                pendingText = null;
                speakInternal(t, exp);
            }
        } else {
            Log.e(TAG, "TTS onInit failed with status: " + status);
        }
    }

    private void handleTtsFinished(String utteranceId) {
        boolean expectReply = utteranceId != null && utteranceId.contains("-reply-");
        JSObject data = new JSObject();
        data.put("state", "done");
        data.put("expectReply", expectReply);
        notifyListeners("ttsState", data, true);

        if (expectReply) {
            // Auto-start listening on the main thread for fluid voice conversation
            getActivity().runOnUiThread(() -> startListeningNative(null));
        }

        try {
            Intent resume = new Intent(getContext(), WakeWordService.class);
            resume.setAction(WakeWordService.ACTION_RESUME_LISTENING);
            resume.putExtra(WakeWordService.EXTRA_EXPECT_REPLY, expectReply);
            getContext().startService(resume);
        } catch (Exception ignored) {}
    }

    private void speakInternal(String text, boolean expectReply) {
        if (text == null || text.trim().isEmpty()) return;
        if (!ttsReady || tts == null) {
            pendingText = text;
            pendingExpectReply = expectReply;
            return;
        }

        // Stop active speech recognition while speaking
        getActivity().runOnUiThread(() -> {
            if (speechRecognizer != null) {
                try { speechRecognizer.stopListening(); } catch (Exception ignored) {}
            }
        });

        // Tell WakeWordService to stop listening while TTS is speaking to prevent self-listening
        try {
            Intent pause = new Intent(getContext(), WakeWordService.class);
            pause.setAction(WakeWordService.ACTION_PAUSE_LISTENING);
            getContext().startService(pause);
        } catch (Exception ignored) {}

        // Ensure volume is audible
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int curVol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                int maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                if (curVol <= 1) {
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.max(1, (int)(maxVol * 0.70f)), 0);
                }
            }
        } catch (Exception ignored) {}

        String utteranceId = "mm-plugin-" + (expectReply ? "reply" : "final") + "-" + System.currentTimeMillis();
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
        params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
        int res = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
        Log.i(TAG, "tts.speak returned: " + res);
    }

    @Override protected void handleOnDestroy() {
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
        }
        getActivity().runOnUiThread(() -> {
            if (speechRecognizer != null) {
                try { speechRecognizer.cancel(); speechRecognizer.destroy(); } catch (Exception ignored) {}
                speechRecognizer = null;
            }
        });
        try { getContext().unregisterReceiver(receiver); } catch (IllegalArgumentException ignored) {}
        try { getContext().stopService(new Intent(getContext(), WakeWordService.class)); } catch (Exception ignored) {}
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

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) { call.resolve(); return; }
        boolean expectReply = call.getBoolean("expectReply", true);
        speakInternal(text, expectReply);
        call.resolve();
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "listenPermissionGranted");
            return;
        }
        startListeningNative(call);
    }

    @PermissionCallback
    private void listenPermissionGranted(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Se necesita permiso de micrófono.");
            return;
        }
        startListeningNative(call);
    }

    private void startListeningNative(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (tts != null && tts.isSpeaking()) {
                    tts.stop();
                }

                if (speechRecognizer == null) {
                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                    speechRecognizer.setRecognitionListener(new RecognitionListener() {
                        @Override public void onReadyForSpeech(Bundle params) {
                            JSObject data = new JSObject(); data.put("state", "ready");
                            notifyListeners("listeningState", data, true);
                        }
                        @Override public void onBeginningOfSpeech() {
                            JSObject data = new JSObject(); data.put("state", "speaking");
                            notifyListeners("listeningState", data, true);
                        }
                        @Override public void onRmsChanged(float rmsdB) {}
                        @Override public void onBufferReceived(byte[] buffer) {}
                        @Override public void onEndOfSpeech() {
                            JSObject data = new JSObject(); data.put("state", "end");
                            notifyListeners("listeningState", data, true);
                        }
                        @Override public void onError(int error) {
                            Log.w(TAG, "Native SpeechRecognizer error: " + error);
                            JSObject data = new JSObject(); data.put("state", "error"); data.put("error", error);
                            notifyListeners("listeningState", data, true);
                        }
                        @Override public void onResults(Bundle results) {
                            ArrayList<String> matches = results != null ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
                            if (matches != null && !matches.isEmpty()) {
                                String recognized = matches.get(0).trim();
                                if (!recognized.isEmpty()) {
                                    Log.i(TAG, "Native SpeechRecognizer result: " + recognized);
                                    JSObject data = new JSObject();
                                    data.put("command", recognized);
                                    notifyListeners("wakeCommand", data, true);
                                }
                            }
                            JSObject data = new JSObject(); data.put("state", "idle");
                            notifyListeners("listeningState", data, true);
                        }
                        @Override public void onPartialResults(Bundle partialResults) {
                            ArrayList<String> matches = partialResults != null ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
                            if (matches != null && !matches.isEmpty()) {
                                JSObject data = new JSObject();
                                data.put("partial", matches.get(0));
                                notifyListeners("listeningState", data, true);
                            }
                        }
                        @Override public void onEvent(int eventType, Bundle params) {}
                    });
                }

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES");
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                speechRecognizer.startListening(intent);
                Log.i(TAG, "Native SpeechRecognizer listening started");

                if (call != null) call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Failed to start native SpeechRecognizer", e);
                if (call != null) call.reject("Error al iniciar escucha: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (speechRecognizer != null) {
                try { speechRecognizer.stopListening(); } catch (Exception ignored) {}
            }
            if (call != null) call.resolve();
        });
    }
}
