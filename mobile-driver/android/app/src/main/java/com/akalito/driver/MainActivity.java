package com.akalito.driver;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // تسجيل الـplugin المخصص لخدمة الإشعار الثابت (مهمة #4) — لازم قبل super.onCreate()
        registerPlugin(DriverAvailabilityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
