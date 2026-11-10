package io.github.mkaaaaaay.mowbite;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // the app's own plugin, before the bridge is made in super.onCreate
        registerPlugin(PushPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
