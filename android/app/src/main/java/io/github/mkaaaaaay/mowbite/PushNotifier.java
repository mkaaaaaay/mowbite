package io.github.mkaaaaaay.mowbite;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Arrays;
import org.json.JSONObject;

// What the mower's container pushes (docker/notify.sh) as MowBite's own notifications, with its icon. Problems,
// reminders and news each in a channel of their own, so sound and importance are set in Android's settings. A problem's
// reminder and its all clear take the place of the message about it.
final class PushNotifier {
    static final String PROBLEMS = "mowbite_problems";
    static final String REMINDERS = "mowbite_reminders";
    static final String INFO = "mowbite_info";
    // the channels of the first test builds. Android keeps a channel as it was made, so the ones above have new names
    private static final String[] GONE = {"problems", "reminders", "info"};
    // on the intent a tap opens the app with: the page to show and the mower it's about
    static final String EXTRA_PATH = "mowbite_path";
    static final String EXTRA_API = "mowbite_api";
    static final String EXTRA_ID = "mowbite_id";
    private static final String GROUP = "mowbite";

    private PushNotifier() {}

    // the page's names for them (src/lib/push.ts PushChannel)
    static String channel(String key) {
        if ("problems".equals(key)) return PROBLEMS;
        if ("reminders".equals(key)) return REMINDERS;
        if ("info".equals(key)) return INFO;
        return null;
    }

    static void channels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        for (String id : GONE) nm.deleteNotificationChannel(id);
        NotificationChannel problems = new NotificationChannel(
            PROBLEMS,
            context.getString(R.string.push_channel_problems),
            NotificationManager.IMPORTANCE_HIGH
        );
        problems.setDescription(context.getString(R.string.push_channel_problems_about));
        problems.enableVibration(true);
        NotificationChannel reminders = new NotificationChannel(
            REMINDERS,
            context.getString(R.string.push_channel_reminders),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        reminders.setDescription(context.getString(R.string.push_channel_reminders_about));
        reminders.enableVibration(true);
        NotificationChannel info = new NotificationChannel(
            INFO,
            context.getString(R.string.push_channel_info),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        info.setDescription(context.getString(R.string.push_channel_info_about));
        // shown like the others, without sound or vibration
        info.setSound(null, null);
        info.enableVibration(false);
        // (names and descriptions follow the phone's language, what the user changed stays)
        nm.createNotificationChannels(Arrays.asList(problems, reminders, info));
    }

    // the message as notify.awk sends it: title, message, kind (emergency, done, test, ...), problem, phase (new, again,
    // clear), api (where MowBite on that mower is), path (the page a tap opens), snooze (the snooze button's label, none
    // without reminders), t (unix seconds)
    static void show(Context context, JSONObject m) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        channels(context);
        String phase = m.optString("phase", "new");
        // a test comes the way a problem does: whether that reaches you is what it's for
        boolean problem = (m.optBoolean("problem", false) || "test".equals(m.optString("kind"))) && !"clear".equals(phase);
        // a part due for maintenance (blades, cleaning) is a reminder too
        boolean maintenance = m.optString("kind").startsWith("maintenance");
        String channel = maintenance || (problem && "again".equals(phase)) ? REMINDERS : !problem ? INFO : PROBLEMS;
        String api = m.optString("api", "");
        // one message per mower and kind of problem or news, a newer one takes its place
        int id = (api + " " + m.optString("kind", "info")).hashCode();
        String text = m.optString("message", "");

        Intent open = new Intent(context, MainActivity.class)
            // an action of its own, so the extras of two messages aren't taken for the same intent
            .setAction(context.getPackageName() + ".OPEN." + id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_PATH, m.optString("path", "/"))
            .putExtra(EXTRA_API, api);
        PendingIntent tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_mowbite)
            .setColor(ContextCompat.getColor(context, R.color.push_accent))
            .setContentTitle(m.optString("title", "MowBite"))
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setGroup(GROUP)
            .setCategory(problem ? NotificationCompat.CATEGORY_ERROR : NotificationCompat.CATEGORY_STATUS)
            // (before Android 8 there are no channels, priority and defaults do it)
            .setPriority(PROBLEMS.equals(channel) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT);
        if (!INFO.equals(channel)) b.setDefaults(NotificationCompat.DEFAULT_ALL);
        long t = m.optLong("t", 0);
        if (t > 0) b.setWhen(t * 1000).setShowWhen(true);
        String snooze = m.optString("snooze", "");
        if (problem && !snooze.isEmpty() && !api.isEmpty()) {
            Intent s = new Intent(context, SnoozeReceiver.class).putExtra(EXTRA_API, api).putExtra(EXTRA_ID, id);
            b.addAction(
                0,
                snooze,
                PendingIntent.getBroadcast(context, id, s, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
            );
        }
        NotificationManagerCompat.from(context).notify(id, b.build());
    }
}
