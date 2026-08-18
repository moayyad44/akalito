package com.akalito.driver;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

import org.json.JSONObject;

/**
 * AvailabilityService — Foreground Service حقيقي بمستوى نظام أندرويد (مهمة #4
 * بالbacklog، 15 أغسطس 2026). يعرض إشعار "ثابت" (Ongoing) بشريط الإشعارات ما
 * إله زر إغلاق (X) ولا ينمسح بالسحب، طول ما السائق بحالة "متاح للطلبات" —
 * بالضبط نفس سلوك تطبيقات التوصيل التانية (أوبر/كريم) وقت ما يكون الكابتن أونلاين.
 *
 * ليش Foreground Service حقيقي مش مجرد إشعار FCM/Local Notification عادي؟
 * لأن أي إشعار عادي المستخدم يقدر يمسحه بالسحب بأي وقت، وهاد بالضبط اللي ما
 * بدنا ياه — المطلوب إشعار ثابت يوضّح للسائق (وأي حد شايف شاشة قفله) إنه
 * التطبيق شغّال بالخلفية ومتتبّع موقعه لحد ما يحوّل حالته يدوياً لـ"غير متاح".
 * هاد بالضبط الاستخدام الرسمي لـForeground Service بنظام أندرويد.
 *
 * نوع الخدمة المُعلَن (foregroundServiceType="location" بالمانيفست) هو "location"
 * لأنه فعلياً هاد اللي عم يصير أثناء التوفر — التطبيق عم يتتبّع ويرسل موقع
 * السائق اللايف (startLocationWatch بـakleto-driver-home.html). هاد أدق وأصدق
 * تصنيف ممكن نعلنه لأندرويد ولمراجعة Google Play (مطابق فعلياً لسلوك التطبيق،
 * مش مجرد تصنيف عشوائي لتفادي القيود).
 *
 * دورة الحياة: JS (driver-shared.js → startAvailabilityForegroundNotification)
 * بيتحكم فيها صراحة عبر DriverAvailabilityPlugin — نستخدم START_NOT_STICKY
 * عمداً عشان نظام أندرويد ما يعيد تشغيلها لحاله من غير ما JS يطلب هيك صراحة
 * (لو التطبيق انقتل بالكامل من النظام، أفضل نعتمد على JS يعيد تشغيلها بوضوح
 * وقت ما يفتح التطبيق من جديد ولاقى isAvailable=true، بدل سلوك ضمني غامض).
 *
 * ⚠️ 16 أغسطس 2026 — إضافة جوهرية: تتبّع موقع أصلي حقيقي (native).
 * اكتُشف إنه navigator.geolocation.watchPosition بجافاسكربت (جوا الـWebView)
 * بيتوقف تماماً لما التطبيق يروح للخلفية — أندرويد بيجمّد تنفيذ الجافاسكربت
 * بغض النظر عن أي إشعار ثابت شغّال. الحل: الخدمة نفسها هلق بتطلب تحديثات
 * الموقع مباشرة من نظام أندرويد (LocationManager) وبتكتبها لـFirestore عبر
 * REST API مباشرة (بدون أي مكتبة Firebase إضافية) — بدون الاعتماد على أي
 * جافاسكربت شغّال. بما إنها خدمة Foreground حقيقية بنوع "location" مُعلَن،
 * ما بتحتاج صلاحية ACCESS_BACKGROUND_LOCATION الحساسة (القيد هاد خاص بطلب
 * الموقع من تطبيق بالخلفية بدون Foreground Service أصلاً — مش حالتنا).
 * التوثيق (auth): قواعد أمان Firestore (drivers/{id}.update) بتتطلب
 * request.auth.uid يطابق auth_uid السائق — فبنستخدم Firebase ID Token
 * (JWT قصير الصلاحية، ساعة وحدة) اللي JS بيولّده من نفس جلسة Anonymous Auth
 * الموجودة أصلاً، وبيمرره للخدمة عند التفعيل + يجدده دورياً (refreshToken)
 * طول ما التطبيق بالمقدمة. لو التوكن انتهت صلاحيته والتطبيق ضل بالخلفية
 * أكتر من ساعة بدون ما يرجع يفتح، تحديثات الموقع الأصلية بتتوقف بصمت لحد
 * ما يرجع يفتح التطبيق ويتجدد التوكن — قيد معروف وموثّق بـcontext.md.
 */
public class AvailabilityService extends Service {

    public static final String ACTION_START = "com.akalito.driver.action.START_AVAILABILITY";
    public static final String ACTION_STOP = "com.akalito.driver.action.STOP_AVAILABILITY";
    public static final String ACTION_REFRESH_TOKEN = "com.akalito.driver.action.REFRESH_AVAILABILITY_TOKEN";

    public static final String EXTRA_DRIVER_ID = "driver_id";
    public static final String EXTRA_ID_TOKEN = "id_token";

    private static final String CHANNEL_ID = "driver_availability_status";
    private static final String CHANNEL_NAME = "حالة التوفر للطلبات";
    private static final int NOTIF_ID = 7301;

    // مشروع Firebase (akleto-prod) — نفس project_id بـgoogle-services.json
    private static final String FIRESTORE_PROJECT_ID = "akleto-prod";
    private static final long LOCATION_MIN_TIME_MS = 12000; // نفس فاصلة تحديث الموقع القديمة بـJS (~12 ثانية)

    private volatile String driverId;
    private volatile String idToken;

    private LocationManager locationManager;
    private LocationListener locationListener;
    private ExecutorService writeExecutor;

    private static final String TAG = "AvailabilityService";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "onStartCommand action=" + (intent != null ? intent.getAction() : "null"));
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.d(TAG, "ACTION_STOP -> stopSelf()");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_REFRESH_TOKEN.equals(intent.getAction())) {
            String newToken = intent.getStringExtra(EXTRA_ID_TOKEN);
            if (newToken != null && !newToken.isEmpty()) {
                idToken = newToken;
                Log.d(TAG, "ACTION_REFRESH_TOKEN -> تحديث التوكن، طوله=" + newToken.length());
            } else {
                Log.w(TAG, "ACTION_REFRESH_TOKEN بس التوكن الجديد فاضي!");
            }
            return START_NOT_STICKY; // بس تحديث التوكن — بدون لمس الإشعار أو إعادة تسجيل الموقع
        }
        if (intent != null) {
            String d = intent.getStringExtra(EXTRA_DRIVER_ID);
            String t = intent.getStringExtra(EXTRA_ID_TOKEN);
            if (d != null && !d.isEmpty()) driverId = d;
            if (t != null && !t.isEmpty()) idToken = t;
            Log.d(TAG, "driverId=" + driverId + " | idToken موجود=" + (idToken != null && !idToken.isEmpty()) + " (طول=" + (idToken != null ? idToken.length() : 0) + ")");
        }
        startInForeground();
        startLocationUpdates();
        return START_NOT_STICKY;
    }

    private void startInForeground() {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                // IMPORTANCE_LOW عمداً: إشعار حالة هادئ (بدون صوت/اهتزاز) —
                // النغمة والاهتزاز محجوزين لقناة order_alerts (تنبيه طلب جديد فعلي)
                // لتفادي أي تشويش بين الاثنين.
                channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("إشعار ثابت يبيّن إنك متاح حالياً لاستلام طلبات جديدة");
                channel.setShowBadge(false);
                nm.createNotificationChannel(channel);
            }
        }

        Intent contentIntent = new Intent(ctx, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentPendingIntent = PendingIntent.getActivity(ctx, 0, contentIntent, piFlags);

        Notification notification = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_order)
                .setContentTitle("اكليتو")
                .setContentText("جاي العمل...")
                .setOngoing(true)                 // بيمنع السحب لإخفاء الإشعار
                .setAutoCancel(false)              // ما ينمسح بالضغط عليه
                .setOnlyAlertOnce(true)             // ما يعيد صوت/اهتزاز مع كل تحديث
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(contentPendingIntent)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 16 أغسطس 2026 — إصلاح باغ حقيقي: الإشعار كان يظهر "عادي" (قابل للسحب/الإخفاء)
            // بدل ثابت فعلياً. السبب المرجّح: بدءاً من أندرويد 14 (targetSdk هون = 36)،
            // نظام أندرويد يرفض تشغيل Foreground Service بنوع "location" ما لم يكن
            // إذن الموقع (ACCESS_FINE_LOCATION/COARSE) ممنوح فعلياً بمستوى النظام وقت
            // الاستدعاء — وبما إنه هالتطبيق يطلب الموقع عبر navigator.geolocation
            // (JS عادي داخل الـWebView) لا عبر Capacitor plugin أصلي بخطوة صريحة،
            // فيه احتمال إنه إذن الموقع الأصلي (نظام أندرويد) لسا مش ممنوح لحظة
            // ما يتفعّل التوفر لأول مرة، فيفشل استدعاء startForeground بنوع "location"
            // بصمت (أو يرمي استثناء)، فيضل الإشعار "يتيم" غير مرتبط فعلياً بخدمة أمامية
            // شغّالة — وهيك يصير قابل للسحب زي أي إشعار عادي.
            // الحل: لو إذن الموقع مش ممنوح وقت التشغيل، نبدأ الخدمة بنوع "dataSync"
            // (مُعلَن بالمانيفست كنوع إضافي) بدل "location" — نفس ضمان الإشعار الثابت
            // (setOngoing يشتغل بغض النظر عن النوع)، بدون الاصطدام بقيد صلاحية الموقع.
            // لو الإذن ممنوح، نستخدم "location" الصادق زي ما كان (لمراجعة Google Play).
            boolean hasLocationPermission =
                    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            int serviceType = hasLocationPermission
                    ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                    : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            try {
                ServiceCompat.startForeground(this, NOTIF_ID, notification, serviceType);
                Log.d(TAG, "startForeground نجح بنوع=" + serviceType);
            } catch (Exception e) {
                Log.e(TAG, "startForeground فشل بنوع=" + serviceType + " — " + e.getMessage(), e);
                // شبكة أمان أخيرة: أي استثناء غير متوقع (مثلاً OEM مخصّص) — نحاول أضعف نوع ممكن
                // بدل ما تفشل الخدمة بصمت وتترك إشعار يتيم قابل للسحب.
                try {
                    ServiceCompat.startForeground(this, NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                    Log.d(TAG, "startForeground نجح بالـfallback الأول (dataSync)");
                } catch (Exception e2) {
                    Log.e(TAG, "startForeground فشل حتى بالـfallback (dataSync) — " + e2.getMessage(), e2);
                    startForeground(NOTIF_ID, notification);
                    Log.d(TAG, "startForeground نجح بالـfallback الأخير (بدون نوع محدد)");
                }
            }
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "onDestroy: الخدمة عم توقف");
        stopLocationUpdates();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    /* ══════════ تتبّع الموقع الأصلي (native) — يشتغل حتى لو التطبيق بالخلفية تماماً ══════════ */

    private void startLocationUpdates() {
        if (locationManager != null) { Log.d(TAG, "startLocationUpdates: أصلاً شغّالة، تجاهل"); return; }
        boolean hasLocationPermission =
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        Log.d(TAG, "startLocationUpdates: hasLocationPermission=" + hasLocationPermission);
        if (!hasLocationPermission) { Log.w(TAG, "ما في إذن موقع — التتبع الأصلي ما رح يشتغل!"); return; }

        writeExecutor = Executors.newSingleThreadExecutor();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) { Log.e(TAG, "LocationManager == null!"); return; }

        locationListener = new LocationListener() {
            @Override public void onLocationChanged(Location location) {
                Log.d(TAG, "onLocationChanged: lat=" + location.getLatitude() + " lng=" + location.getLongitude() + " provider=" + location.getProvider());
                pushLocationToFirestore(location.getLatitude(), location.getLongitude());
            }
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
        };

        boolean gpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
        boolean networkEnabled = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        Log.d(TAG, "gpsEnabled=" + gpsEnabled + " networkEnabled=" + networkEnabled);
        try {
            if (gpsEnabled) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, LOCATION_MIN_TIME_MS, 0f, locationListener);
                Log.d(TAG, "requestLocationUpdates(GPS) تم بنجاح");
            }
            if (networkEnabled) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, LOCATION_MIN_TIME_MS, 0f, locationListener);
                Log.d(TAG, "requestLocationUpdates(NETWORK) تم بنجاح");
            }
            if (!gpsEnabled && !networkEnabled) {
                Log.w(TAG, "ولا provider مفعّل (GPS ولا Network) — تأكد GPS/الموقع مفعّل بإعدادات الجهاز!");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "SecurityException بـrequestLocationUpdates: " + e.getMessage(), e);
        }
    }

    private void stopLocationUpdates() {
        if (locationManager != null && locationListener != null) {
            try { locationManager.removeUpdates(locationListener); } catch (SecurityException ignored) {}
        }
        locationManager = null;
        locationListener = null;
        if (writeExecutor != null) {
            writeExecutor.shutdownNow();
            writeExecutor = null;
        }
    }

    /** يكتب الموقع الجديد مباشرة لـFirestore عبر REST API — بدون أي مكتبة Firebase إضافية،
     *  على Thread منفصل (ممنوع أي I/O شبكة على الـMain Thread). */
    private void pushLocationToFirestore(double lat, double lng) {
        final String dId = driverId;
        final String token = idToken;
        final ExecutorService exec = writeExecutor;
        if (dId == null || dId.isEmpty() || token == null || token.isEmpty() || exec == null) {
            Log.w(TAG, "pushLocationToFirestore: تخطي — driverId فاضي=" + (dId == null || dId.isEmpty()) + " idToken فاضي=" + (token == null || token.isEmpty()));
            return;
        }

        exec.execute(() -> {
            HttpsURLConnection conn = null;
            try {
                String urlStr = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID
                        + "/databases/(default)/documents/drivers/" + dId
                        + "?updateMask.fieldPaths=lat&updateMask.fieldPaths=lng&updateMask.fieldPaths=location_updated_at";
                java.net.URL url = new java.net.URL(urlStr);
                conn = (HttpsURLConnection) url.openConnection();
                conn.setRequestMethod("PATCH");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setDoOutput(true);

                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
                String nowIso = sdf.format(new Date());

                JSONObject fields = new JSONObject();
                fields.put("lat", new JSONObject().put("doubleValue", lat));
                fields.put("lng", new JSONObject().put("doubleValue", lng));
                fields.put("location_updated_at", new JSONObject().put("timestampValue", nowIso));
                JSONObject body = new JSONObject();
                body.put("fields", fields);

                byte[] out = body.toString().getBytes("UTF-8");
                conn.getOutputStream().write(out);
                conn.getOutputStream().flush();

                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    Log.d(TAG, "pushLocationToFirestore: نجح (code=" + code + ") lat=" + lat + " lng=" + lng);
                } else {
                    String errBody = readStreamSafely(conn.getErrorStream());
                    Log.e(TAG, "pushLocationToFirestore: فشل! code=" + code + " body=" + errBody);
                }
            } catch (Exception e) {
                Log.e(TAG, "pushLocationToFirestore: استثناء — " + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private String readStreamSafely(java.io.InputStream is) {
        if (is == null) return "(بدون تفاصيل)";
        try {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[512];
            int n;
            while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "(فشل قراءة تفاصيل الخطأ)";
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // مش Bound Service — بنتحكم فيها بس عبر start/stopService من الـPlugin
    }
}
