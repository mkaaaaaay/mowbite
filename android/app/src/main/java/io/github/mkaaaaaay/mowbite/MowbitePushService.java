package io.github.mkaaaaaay.mowbite;

import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;
import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.PushService;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;

// What the UnifiedPush distributor (e.g. the ntfy app) hands over: the address the mowers push to, and their messages.
// The container sends them as plain json (it has no web push encryption), the connector passes those on undecrypted
public class MowbitePushService extends PushService {

    @Override
    public void onNewEndpoint(PushEndpoint endpoint, String instance) {
        PushPlugin.endpoint(this, endpoint.getUrl());
    }

    @Override
    public void onMessage(PushMessage message, String instance) {
        try {
            PushNotifier.show(this, new JSONObject(new String(message.getContent(), StandardCharsets.UTF_8)));
        } catch (JSONException e) {
            // not one of the mower's
        }
    }

    @Override
    public void onRegistrationFailed(FailedReason reason, String instance) {
        PushPlugin.failed(this, reason.name());
    }

    @Override
    public void onUnregistered(String instance) {
        PushPlugin.endpoint(this, null);
    }
}
