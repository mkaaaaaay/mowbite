package io.github.mkaaaaaay.mowbite;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import androidx.core.app.NotificationManagerCompat;
import java.net.HttpURLConnection;
import java.net.URL;

// "Snooze 1 h" on a problem's message: no reminders for an hour, set on the mower (notify.cgi) like the button on the
// settings page does. The mower is only reached from the home network, away from it a toast says so
public class SnoozeReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String api = intent.getStringExtra(PushNotifier.EXTRA_API);
        int id = intent.getIntExtra(PushNotifier.EXTRA_ID, 0);
        if (api == null || api.isEmpty()) return;
        PendingResult result = goAsync();
        Context app = context.getApplicationContext();
        new Thread(() -> {
            boolean ok = false;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(api + "/cgi-bin/notify?snooze=3600").openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setDoOutput(true);
                c.getOutputStream().close();
                ok = c.getResponseCode() == 200;
                c.disconnect();
            } catch (Exception ignored) {
                // not reached, said below
            }
            if (ok) NotificationManagerCompat.from(app).cancel(id);
            else new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(app, R.string.push_snooze_failed, Toast.LENGTH_LONG).show());
            result.finish();
        }).start();
    }
}
