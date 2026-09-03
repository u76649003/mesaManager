package com.mesamanager.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.core.app.NotificationCompat;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Locale;

public class WakeWordService extends Service implements RecognitionListener {
    public static final String ACTION_START   = "com.mesamanager.app.WAKE_START";
    public static final String ACTION_STOP    = "com.mesamanager.app.WAKE_STOP";
    public static final String ACTION_COMMAND = "com.mesamanager.app.WAKE_COMMAND";
    public static final String ACTION_SPEAK   = "com.mesamanager.app.WAKE_SPEAK";
    public static final String EXTRA_NAME    = "assistantName";
    public static final String EXTRA_COMMAND = "command";
    public static final String EXTRA_TEXT    = "text";
    public static final String EXTRA_EXPECT_REPLY = "expectReply";

    private static final String CHANNEL_ID      = "mesamanager_assistant";
    private static final int    NOTIFICATION_ID = 1707;
    private static final long   POST_SPEAK_DELAY_MS = 500L;
    private static final long   REPLY_TIMEOUT_MS = 14_000L;
    private static final long   TTS_WATCHDOG_MS  = 7_500L;
    private static final long   DEDUP_MS = 2_000L;

    private Handler          mainHandler;
    private Runnable         awaitingTimeout;
    private Runnable         ttsWatchdog;
    private SpeechRecognizer recognizer;
    private Intent           recognitionIntent;
    private String           wakePhrase = "ey mara";
    private boolean          awaitingCommand  = false;
    private boolean          wakeAcknowledged = false;
    private boolean          stopping = false;
    private boolean          speaking = false;
    private boolean          ttsReady = false;
    private String           pendingText = null;
    private boolean          pendingExpectReply = false;
    private String           lastCommand  = "";
    private long             lastCommandAt = 0;
    private long             promptPauseUntil = 0;
    private TextToSpeech     tts;

    // === Lifecycle ===========================================================

    @Override public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        createChannel();

        recognitionIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES");
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            ttsReady = true;
            try {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                tts.setAudioAttributes(attrs);
                tts.setLanguage(new Locale("es", "ES"));
                Voice best = tts.getVoices() == null ? null : tts.getVoices().stream()
                    .filter(v -> v.getLocale() != null && "es".equals(v.getLocale().getLanguage()))
                    .max(Comparator
                        .comparingInt(Voice::getQuality)
                        .thenComparingInt(v -> v.isNetworkConnectionRequired() ? 0 : 1))
                    .orElse(null);
                if (best != null) tts.setVoice(best);
                tts.setSpeechRate(0.94f);
                tts.setPitch(1.02f);
            } catch (Exception ignored) {}

            if (pendingText != null) {
                String text = pendingText;
                boolean expect = pendingExpectReply;
                pendingText = null;
                doSpeak(text, expect);
            }
        });

        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { speaking = true; }
            @Override public void onError(String id)  { finishSpeaking(id); }
            @Override public void onDone(String id)   { finishSpeaking(id); }
        });
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            startForeground(NOTIFICATION_ID, notification("Di \"" + wakePhrase + "\" para hablar"));
            startListening();
            return START_STICKY;
        }
        if (ACTION_STOP.equals(intent.getAction())) {
            stopping = true; cancelAwaitingTimeout(); cancelTtsWatchdog();
            stopListening(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_SPEAK.equals(intent.getAction())) {
            doSpeak(intent.getStringExtra(EXTRA_TEXT), intent.getBooleanExtra(EXTRA_EXPECT_REPLY, true));
            return START_STICKY;
        }
        // ACTION_START (or restart)
        String name = intent.getStringExtra(EXTRA_NAME);
        if (name != null && !name.trim().isEmpty()) wakePhrase = normalize("ey " + name.trim());
        startForeground(NOTIFICATION_ID, notification("Di \"" + wakePhrase + "\" para hablar"));
        stopping = false;
        startListening();
        return START_STICKY;
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        stopping = true; cancelAwaitingTimeout(); cancelTtsWatchdog(); stopListening();
        if (tts != null) { try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {} tts = null; }
        stopForeground(STOP_FOREGROUND_REMOVE);
        LocalAIEngine.getInstance().unloadModel();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        stopping = true; cancelAwaitingTimeout(); cancelTtsWatchdog(); stopListening();
        if (tts != null) { try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {} tts = null; }
        LocalAIEngine.getInstance().unloadModel();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    // === Speech Recognition ==================================================

    private void startListening() {
        if (stopping || speaking || !SpeechRecognizer.isRecognitionAvailable(this)) return;
        long now = System.currentTimeMillis();
        if (now < promptPauseUntil) {
            mainHandler.postDelayed(this::startListening, promptPauseUntil - now + 50);
            return;
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(this);
        }
        try { recognizer.startListening(recognitionIntent); }
        catch (Exception ignored) { scheduleRestart(); }
    }

    private void stopListening() {
        if (recognizer != null) {
            try { recognizer.cancel(); recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    private void scheduleRestart() {
        if (!stopping && !speaking) {
            stopListening();
            mainHandler.postDelayed(this::startListening, 500);
        }
    }

    @Override public void onResults(Bundle results)        { consume(results, true);  scheduleRestart(); }
    @Override public void onPartialResults(Bundle partial) { consume(partial, false); }
    @Override public void onError(int error) {
        // Destroy crashed/errored recognizer instance immediately
        stopListening();
        // If we were waiting for a reply and user didn't speak or timed out, keep waiting
        if (awaitingCommand && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
            promptPauseUntil = System.currentTimeMillis() + 200;
        }
        scheduleRestart();
    }

    @Override public void onReadyForSpeech(Bundle p) {}
    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float r) {}
    @Override public void onBufferReceived(byte[] b) {}
    @Override public void onEndOfSpeech() {}
    @Override public void onEvent(int t, Bundle p) {}

    private void consume(Bundle results, boolean isFinal) {
        ArrayList<String> phrases = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (phrases == null) return;
        for (String original : phrases) {
            String phrase = normalize(original);
            if (awaitingCommand && !phrase.isBlank()) {
                int wi = phrase.indexOf(wakePhrase);
                String command = wi >= 0 ? phrase.substring(wi + wakePhrase.length()).trim() : original.trim();
                if (!command.isEmpty() && isFinal) { awaitingCommand = false; wakeAcknowledged = false; emit(command); }
                return;
            }
            int index = phrase.indexOf(wakePhrase);
            if (index >= 0) {
                String remainder = phrase.substring(index + wakePhrase.length()).trim();
                if (!wakeAcknowledged) {
                    wakeAcknowledged = true; awaitingCommand = true;
                    promptPauseUntil = System.currentTimeMillis() + 1700;
                    emit("__WAKE__"); updateNotification("Te escucho...");
                    stopListening();
                }
                if (!remainder.isEmpty() && isFinal) { awaitingCommand = false; wakeAcknowledged = false; emit(remainder); }
                return;
            }
        }
    }

    private void emit(String command) {
        long now = System.currentTimeMillis();
        if (normalize(command).equals(normalize(lastCommand)) && now - lastCommandAt < DEDUP_MS) return;
        lastCommand = command; lastCommandAt = now;
        cancelAwaitingTimeout();
        Intent event = new Intent(ACTION_COMMAND).setPackage(getPackageName());
        event.putExtra(EXTRA_COMMAND, command);
        sendBroadcast(event);
        updateNotification("Procesando... Di \"" + wakePhrase + "\" para continuar.");
    }

    // === Text-to-Speech ======================================================

    private void requestAudioFocus() {
        try {
            android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null) {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                    android.media.AudioFocusRequest afr = new android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(attrs)
                        .build();
                    am.requestAudioFocus(afr);
                } else {
                    am.requestAudioFocus(null, android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
                }
            }
        } catch (Exception ignored) {}
    }

    private void abandonAudioFocus() {
        try {
            android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null) {
                am.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {}
    }

    private void doSpeak(String text, boolean expectReply) {
        if (text == null || text.trim().isEmpty()) return;
        if (!ttsReady || tts == null) {
            pendingText = text;
            pendingExpectReply = expectReply;
            return;
        }
        speaking = true;
        cancelAwaitingTimeout();
        cancelTtsWatchdog();
        stopListening();
        requestAudioFocus();

        final String uid = "mm-" + (expectReply ? "reply" : "final") + "-" + System.currentTimeMillis();
        long dynamicWatchdogMs = Math.max(6000L, (text.length() / 8L) * 1000L + 4000L);
        ttsWatchdog = () -> {
            if (speaking) {
                finishSpeaking(uid);
            }
        };
        mainHandler.postDelayed(ttsWatchdog, dynamicWatchdogMs);

        try {
            Bundle params = new Bundle();
            params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, android.media.AudioManager.STREAM_MUSIC);
            int res = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, uid);
            if (res != TextToSpeech.SUCCESS) {
                finishSpeaking(uid);
            }
        } catch (Exception e) {
            finishSpeaking(uid);
        }
    }

    private void finishSpeaking(String utteranceId) {
        final boolean expectReply = utteranceId != null && utteranceId.contains("-reply-");
        mainHandler.post(() -> {
            cancelTtsWatchdog();
            speaking = false;
            abandonAudioFocus();
            stopListening();
            if (stopping) return;
            if (expectReply) {
                awaitingCommand = true;
                wakeAcknowledged = true;
                promptPauseUntil = System.currentTimeMillis() + POST_SPEAK_DELAY_MS;
                mainHandler.postDelayed(this::startListening, POST_SPEAK_DELAY_MS);
                updateNotification("Te escucho...");
                awaitingTimeout = () -> {
                    awaitingCommand = false; wakeAcknowledged = false;
                    updateNotification("Di \"" + wakePhrase + "\" para hablar");
                    scheduleRestart();
                };
                mainHandler.postDelayed(awaitingTimeout, REPLY_TIMEOUT_MS);
            } else {
                awaitingCommand = false; wakeAcknowledged = false;
                promptPauseUntil = System.currentTimeMillis() + 300;
                mainHandler.postDelayed(this::startListening, 300);
                updateNotification("Di \"" + wakePhrase + "\" para hablar");
            }
        });
    }

    private void cancelAwaitingTimeout() {
        if (awaitingTimeout != null) { mainHandler.removeCallbacks(awaitingTimeout); awaitingTimeout = null; }
    }

    private void cancelTtsWatchdog() {
        if (ttsWatchdog != null) { mainHandler.removeCallbacks(ttsWatchdog); ttsWatchdog = null; }
    }

    // === Helpers =============================================================

    private String normalize(String value) {
        return Normalizer.normalize(value.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "").replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    private void createChannel() {
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Asistente de MesaManager", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Mantiene activa la escucha de la palabra de activacion.");
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    private Notification notification(String text) {
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Asistente activo")
            .setContentText(text).setOngoing(true).setContentIntent(pi).build();
    }

    private void updateNotification(String text) {
        try {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text));
        } catch (Exception ignored) {}
    }
}
