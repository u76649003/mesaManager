package com.mesamanager.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Bundle;
import android.os.IBinder;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.core.app.NotificationCompat;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Locale;

public class WakeWordService extends Service implements RecognitionListener {
    public static final String ACTION_START = "com.mesamanager.app.WAKE_START";
    public static final String ACTION_STOP = "com.mesamanager.app.WAKE_STOP";
    public static final String ACTION_COMMAND = "com.mesamanager.app.WAKE_COMMAND";
    public static final String EXTRA_NAME = "assistantName";
    public static final String EXTRA_COMMAND = "command";
    private static final String CHANNEL_ID = "mesamanager_assistant";
    private static final int NOTIFICATION_ID = 1707;

    private SpeechRecognizer recognizer;
    private Intent recognitionIntent;
    private String wakePhrase = "ey mara";
    private boolean awaitingCommand = false;
    private boolean stopping = false;
    private String lastCommand = "";
    private long lastCommandAt = 0;

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        recognitionIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES");
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopping = true; stopListening(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY;
        }
        String name = intent == null ? null : intent.getStringExtra(EXTRA_NAME);
        if (name != null && !name.trim().isEmpty()) wakePhrase = normalize("ey " + name.trim());
        startForeground(NOTIFICATION_ID, notification("Di “" + wakePhrase + "” para hablar"));
        stopping = false;
        startListening();
        return START_STICKY;
    }

    private void startListening() {
        if (stopping || !SpeechRecognizer.isRecognitionAvailable(this)) return;
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(this);
        }
        try { recognizer.startListening(recognitionIntent); } catch (RuntimeException ignored) { restart(); }
    }

    private void stopListening() {
        if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); recognizer = null; }
    }

    private void restart() {
        if (!stopping) new android.os.Handler(getMainLooper()).postDelayed(this::startListening, 650);
    }

    private void consume(Bundle results) {
        ArrayList<String> phrases = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (phrases == null) return;
        for (String original : phrases) {
            String phrase = normalize(original);
            if (awaitingCommand && !phrase.isBlank()) { awaitingCommand = false; emit(original.trim()); return; }
            int index = phrase.indexOf(wakePhrase);
            if (index >= 0) {
                String remainder = phrase.substring(index + wakePhrase.length()).trim();
                if (remainder.isEmpty()) { awaitingCommand = true; updateNotification("Te escucho…"); }
                else emit(remainder);
                return;
            }
        }
    }

    private void emit(String command) {
        long now = System.currentTimeMillis();
        if (normalize(command).equals(normalize(lastCommand)) && now - lastCommandAt < 3500) return;
        lastCommand = command; lastCommandAt = now;
        Intent event = new Intent(ACTION_COMMAND).setPackage(getPackageName());
        event.putExtra(EXTRA_COMMAND, command);
        sendBroadcast(event);
        updateNotification("Orden recibida. Esperando “" + wakePhrase + "”…");
    }

    private String normalize(String value) {
        return Normalizer.normalize(value.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "").replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    private void createChannel() {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Asistente de MesaManager", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mantiene activa la escucha de la palabra de activación.");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification notification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Asistente activo")
            .setContentText(text).setOngoing(true).setContentIntent(pending).build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text));
    }

    @Override public void onResults(Bundle results) { consume(results); restart(); }
    @Override public void onPartialResults(Bundle partialResults) { consume(partialResults); }
    @Override public void onError(int error) { restart(); }
    @Override public void onReadyForSpeech(Bundle params) {}
    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float rmsdB) {}
    @Override public void onBufferReceived(byte[] buffer) {}
    @Override public void onEndOfSpeech() {}
    @Override public void onEvent(int eventType, Bundle params) {}
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() { stopping = true; stopListening(); super.onDestroy(); }
}
