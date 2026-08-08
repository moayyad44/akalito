package com.akalito.driver;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * OrderMessagingService — تورّث من خدمة استقبال إشعارات Capacitor الافتراضية
 * (com.capacitorjs.plugins.pushnotifications.MessagingService) بدون ما تكسر أي
 * سلوك موجود (استدعاء super() بالنهاية بيحافظ على كل شي شغّال أصلاً: تسجيل
 * التوكن، تمرير الإشعار لجافاسكربت وقت التطبيق مفتوح، ...الخ).
 *
 * الإضافة الوحيدة: لما توصل رسالة FCM من نوع "طلب جديد" (order_assigned أو
 * order_available) — وهاي الرسائل بترسل كـ data-only بدون notification block
 * من الـ Cloud Function عمداً — منبني إشعار "Full-Screen Intent" يفتح التطبيق
 * تلقائياً فوق شاشة القفل، بالضبط متل تطبيقات التوصيل (أوبر/كريم).
 */
public class OrderMessagingService extends com.capacitorjs.plugins.pushnotifications.MessagingService {

    private static final String CHANNEL_ID = "order_alerts";
    private static final String CHANNEL_NAME = "تنبيهات الطلبات الجديدة";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data != null ? data.get("type") : null;

        boolean isOrderAlert = "order_assigned".equals(type) || "order_available".equals(type);

        if (isOrderAlert) {
            String title = data.get("title") != null ? data.get("title") : "طلب جديد 🚴";
            String body = data.get("body") != null ? data.get("body") : "افتح التطبيق للتفاصيل";
            showFullScreenOrderAlert(title, body, data.get("order_id"));
            // ما بنستدعي super() هون لأنه الرسالة data-only مخصصة لهالتنبيه بس،
            // ومفيش داعي تتمرر لجافاسكربت (التطبيق أصلاً بيحدّث قائمة الطلبات
            // لحظياً من Firestore مباشرة لما يفتح).
            return;
        }

        // أي رسالة تانية (غير تنبيه الطلب) — نفس السلوك الافتراضي متل ما كان قبل هالتعديل
        super.onMessageReceived(remoteMessage);
    }

    private void showFullScreenOrderAlert(String title, String body, String orderId) {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("تنبيهات فورية لما يوصلك طلب جديد أو يصير متاح");
                channel.enableVibration(true);
                channel.setBypassDnd(true);
                nm.createNotificationChannel(channel);
            }
        }

        Intent fullScreenIntent = new Intent(ctx, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        fullScreenIntent.putExtra("order_id", orderId);
        fullScreenIntent.putExtra("open_order_alert", true);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                ctx, (int) System.currentTimeMillis(), fullScreenIntent, flags
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_order)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(true)
                .setVibrate(new long[]{0, 400, 200, 400})
                .setContentIntent(fullScreenPendingIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true);

        NotificationManagerCompat.from(ctx).notify((int) System.currentTimeMillis(), builder.build());
    }
}
