package io.github.mkaaaaaay.mowbite;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;
import java.util.List;
import org.json.JSONObject;
import org.unifiedpush.android.connector.UnifiedPush;

// The page's way to MowBite's own push messages (src/lib/push.ts): which UnifiedPush distributors there are, signing up
// with one, the address the mowers push to, the notification permission and the channels' settings. Events: endpoint
// (the address, null once gone), failed (why signing up didn't work), opened (a message was tapped: page and mower)
@CapacitorPlugin(
    name = "MowbitePush",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class PushPlugin extends Plugin {

    // one registration for the app, every mower pushes to its address
    private static final String INSTANCE = "default";
    private static final String PREFS = "mowbite_push";
    private static WeakReference<PushPlugin> live = new WeakReference<>(null);

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // from MowbitePushService: kept for status(), and told to the page while it runs
    static void endpoint(Context context, String url) {
        SharedPreferences.Editor e = prefs(context).edit().remove("failed");
        if (url == null) e.remove("endpoint");
        else e.putString("endpoint", url);
        e.apply();
        PushPlugin p = live.get();
        if (p != null) {
            JSObject d = new JSObject();
            d.put("url", url == null ? JSONObject.NULL : url);
            p.notifyListeners("endpoint", d);
        }
    }

    static void failed(Context context, String reason) {
        prefs(context).edit().putString("failed", reason).apply();
        PushPlugin p = live.get();
        if (p != null) {
            JSObject d = new JSObject();
            d.put("reason", reason);
            p.notifyListeners("failed", d);
        }
    }

    @Override
    public void load() {
        live = new WeakReference<>(this);
        PushNotifier.channels(getContext());
    }

    // granted, prompt (not asked yet) or denied. before Android 13 there's no permission, only the switch in the settings
    private String permission() {
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) return "granted";
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) return "prompt";
        return "denied";
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        PackageManager pm = c.getPackageManager();
        JSArray list = new JSArray();
        for (String pkg : UnifiedPush.getDistributors(c)) {
            JSObject d = new JSObject();
            d.put("id", pkg);
            String name = pkg;
            try {
                name = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
            } catch (PackageManager.NameNotFoundException ignored) {
                // the package name it is
            }
            d.put("name", name);
            list.put(d);
        }
        JSObject r = new JSObject();
        r.put("distributors", list);
        String saved = UnifiedPush.getSavedDistributor(c);
        r.put("distributor", saved == null ? JSONObject.NULL : saved);
        String endpoint = prefs(c).getString("endpoint", null);
        r.put("endpoint", endpoint == null ? JSONObject.NULL : endpoint);
        String failed = prefs(c).getString("failed", null);
        r.put("failed", failed == null ? JSONObject.NULL : failed);
        r.put("permission", permission());
        call.resolve(r);
    }

    // signs up with the distributor given, else the one used before or the only one there is. the address comes later
    // as the endpoint event
    @PluginMethod
    public void register(PluginCall call) {
        Context c = getContext();
        List<String> all = UnifiedPush.getDistributors(c);
        String pkg = call.getString("distributor");
        if (pkg == null) pkg = UnifiedPush.getSavedDistributor(c);
        if (pkg == null && all.size() == 1) pkg = all.get(0);
        if (pkg == null || !all.contains(pkg)) {
            call.reject(all.isEmpty() ? "no distributor installed" : "pick a distributor", all.isEmpty() ? "NONE" : "PICK");
            return;
        }
        prefs(c).edit().remove("failed").apply();
        UnifiedPush.saveDistributor(c, pkg);
        UnifiedPush.register(c, INSTANCE, "MowBite", null);
        call.resolve();
    }

    @PluginMethod
    public void unregister(PluginCall call) {
        UnifiedPush.unregister(getContext(), INSTANCE);
        prefs(getContext()).edit().remove("endpoint").remove("failed").apply();
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            permissionDone(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "permissionDone");
    }

    @PermissionCallback
    private void permissionDone(PluginCall call) {
        JSObject r = new JSObject();
        r.put("permission", permission());
        call.resolve(r);
    }

    // Android's settings for MowBite's notifications, or one channel's (problems, reminders, info): sound, vibration,
    // importance, do not disturb
    @PluginMethod
    public void openSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        String channel = call.getString("channel");
        Intent i;
        if (Build.VERSION.SDK_INT >= 26 && channel != null) {
            PushNotifier.channels(getContext());
            i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                .putExtra(Settings.EXTRA_CHANNEL_ID, channel);
        } else if (Build.VERSION.SDK_INT >= 26) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        getActivity().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    // a distributor's page in the store (ntfy: io.heckel.ntfy)
    @PluginMethod
    public void openStore(PluginCall call) {
        String id = call.getString("id", "io.heckel.ntfy");
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + id)));
        } catch (ActivityNotFoundException e) {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + id)));
        }
        call.resolve();
    }

    // shows a message here and now, the same way as one from the mower: how it looks and sounds, without the way there
    @PluginMethod
    public void showSample(PluginCall call) {
        PushNotifier.show(getContext(), call.getData());
        call.resolve();
    }

    // a tap on a message: at the start of the app too (the launch intent comes here as well), kept until the page listens
    @Override
    protected void handleOnNewIntent(Intent intent) {
        String path = intent.getStringExtra(PushNotifier.EXTRA_PATH);
        if (path == null) return;
        JSObject d = new JSObject();
        d.put("path", path);
        d.put("api", intent.getStringExtra(PushNotifier.EXTRA_API));
        intent.removeExtra(PushNotifier.EXTRA_PATH);
        notifyListeners("opened", d, true);
    }
}
