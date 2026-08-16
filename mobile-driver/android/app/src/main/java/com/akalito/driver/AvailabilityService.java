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
import android.os.Build;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

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
 */
public class AvailabilityService extends Service {

    public static final String ACTION_START = "com.akalito.driver.action.START_AVAILABILITY";
    public static final String ACTION_STOP = "com.akalito.driver.action.STOP_AVAILABILITY";

    private static final String CHANNEL_ID = "driver_availability_status";
    private static final String CHANNEL_NAME = "حالة التوفر للطلبات";
    private static final int NOTIF_ID = 7301;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startInForeground();
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
            } catch (Exception e) {
                // شبكة أمان أخيرة: أي استثناء غير متوقع (مثلاً OEM مخصّص) — نحاول أضعف نوع ممكن
                // بدل ما تفشل الخدمة بصمت وتترك إشعار يتيم قابل للسحب.
                try {
                    ServiceCompat.startForeground(this, NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                } catch (Exception e2) {
                    startForeground(NOTIF_ID, notification);
                }
            }
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    @Override
    public void onDestroy() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // مش Bound Service — بنتحكم فيها بس عبر start/stopService من الـPlugin
    }
}
