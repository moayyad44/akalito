package com.akalito.driver;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * DriverAvailabilityPlugin — الجسر بين جافاسكربت (driver-shared.js) وخدمة
 * AvailabilityService الأصلية (مهمة #4 بالbacklog، 15 أغسطس 2026).
 * يظهر بـJS كـ window.Capacitor.Plugins.DriverAvailability.{start,stop}()
 * — نفس نمط الوصول المستخدم أصلاً لباقي الـplugins (PushNotifications، App).
 */
@CapacitorPlugin(name = "DriverAvailability")
public class DriverAvailabilityPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, AvailabilityService.class);
        intent.setAction(AvailabilityService.ACTION_START);
        intent.putExtra(AvailabilityService.EXTRA_DRIVER_ID, call.getString("driverId", ""));
        intent.putExtra(AvailabilityService.EXTRA_ID_TOKEN, call.getString("idToken", ""));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, AvailabilityService.class);
        intent.setAction(AvailabilityService.ACTION_STOP);
        ctx.startService(intent); // بنبعتلها أمر توقيف صريح (onStartCommand بيستدعي stopSelf)
        call.resolve();
    }

    /**
     * تجديد Firebase ID Token للخدمة الشغّالة أصلاً (16 أغسطس 2026، مهمة #4 —
     * تتبّع موقع أصلي حقيقي). التوكن صلاحيته ساعة وحدة، وJS بتجدده دورياً طول
     * ما التطبيق بالمقدمة وتستدعي هالدالة — بدون ما تلمس الإشعار ولا تعيد
     * تشغيل تتبّع الموقع (راجع AvailabilityService.onStartCommand).
     */
    @PluginMethod
    public void refreshToken(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, AvailabilityService.class);
        intent.setAction(AvailabilityService.ACTION_REFRESH_TOKEN);
        intent.putExtra(AvailabilityService.EXTRA_ID_TOKEN, call.getString("idToken", ""));
        ctx.startService(intent);
        call.resolve();
    }
}
