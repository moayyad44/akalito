// ══════════════════════════════════════════════════════════
// functions/index.js — إشعارات الدفع (Push Notifications) لمشروع أكليتو
//
// بيراقب أي تغيير على مستند بمجموعة `orders` بـ Firestore، وبيبعت
// إشعار FCM حقيقي (يوصل حتى لو التطبيق مسكّر تماماً) لـ:
//   1) الزبون (customers/{customer_id}.fcm_token) — عند تغيّر حالة طلبه
//   2) السائق (drivers/{driver_id}.fcm_token)     — لما يتعيّن على طلب
//
// ⚠️ متطلبات قبل النشر (firebase deploy --only functions):
//   - خطة Firebase Blaze مفعّلة على مشروع akleto-prod (Cloud Functions
//     تحتاج فوترة حتى لو الاستخدام ضمن الحد المجاني).
//   - تشغيل: firebase login  ثم  firebase deploy --only functions
//     من داخل مجلد المشروع (اللي فيه firebase.json).
// ══════════════════════════════════════════════════════════

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// المنطقة الأقرب جغرافياً (أوروبا) — عدّلها لو حابب منطقة تانية
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

/* نصوص إشعار الزبون حسب حالة الطلب الجديدة */
const CUSTOMER_STATUS_MESSAGES = {
  preparing: { title: "طلبك قيد التجهيز 🔵", body: "المطعم بدأ يجهّز طلبك الآن." },
  ready:     { title: "طلبك جاهز 📦", body: "طلبك جاهز وبانتظار سائق يستلمه." },
  delivering:{ title: "طلبك بالطريق 🛵", body: "السائق استلم طلبك وبالطريق إلك." },
  done:      { title: "تم توصيل طلبك ✅", body: "وصل طلبك — بالهنا والشفا!" },
  cancelled: { title: "تم إلغاء طلبك ❌", body: "للأسف تم إلغاء طلبك. تواصل معنا لأي استفسار." },
};

/* يبعت إشعار FCM واحد لتوكن معيّن، وبيتعامل بهدوء مع توكن غير صالح/منتهي */
async function sendPush(token, title, body, data = {}) {
  if (!token) return;
  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: "high" },
    });
  } catch (e) {
    console.error("فشل إرسال إشعار FCM:", e.message || e);
    // توكن غير صالح (مثلاً المستخدم حذف التطبيق) — ما في داعي نكرر المحاولة
  }
}

/* ══════════════════════════════════════════════════════════
   1) عند تحديث أي طلب: تغيّر الحالة → إشعار الزبون
                         تعيين سائق (driver_id جديد) → إشعار السائق
   ══════════════════════════════════════════════════════════ */
exports.onOrderUpdated = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const orderId = event.params.orderId;

  // (أ) تغيّرت حالة الطلب → إشعار الزبون
  if (before.status !== after.status && after.customer_id) {
    const msg = CUSTOMER_STATUS_MESSAGES[after.status];
    if (msg) {
      try {
        const custSnap = await db.collection("customers").doc(after.customer_id).get();
        const token = custSnap.exists ? custSnap.data().fcm_token : null;
        await sendPush(token, msg.title, msg.body, { type: "order_status", order_id: orderId, status: after.status });
      } catch (e) {
        console.error("خطأ جلب توكن الزبون:", e.message || e);
      }
    }
  }

  // (ب) تعيّن سائق جديد على الطلب (ما كان معيّن قبل) → إشعار السائق
  const driverAssignedNow = !before.driver_id && after.driver_id;
  if (driverAssignedNow) {
    try {
      const drvSnap = await db.collection("drivers").doc(after.driver_id).get();
      const token = drvSnap.exists ? drvSnap.data().fcm_token : null;
      await sendPush(
        token,
        "طلب جديد إلك 🚴",
        "تم تعيين طلب جديد إلك — افتح التطبيق للتفاصيل.",
        { type: "order_assigned", order_id: orderId }
      );
    } catch (e) {
      console.error("خطأ جلب توكن السائق:", e.message || e);
    }
  }
});

/* ══════════════════════════════════════════════════════════
   3) طلب جديد اتسجّل (الزبون أنهى الطلب) → إشعار فوري للمتجر
   ══════════════════════════════════════════════════════════ */
exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const order = event.data.data();
  if (!order.store_id) return;
  try {
    const storeSnap = await db.collection("stores").doc(order.store_id).get();
    const token = storeSnap.exists ? storeSnap.data().fcm_token : null;
    await sendPush(
      token,
      "طلب جديد 🛎️",
      "وصلك طلب جديد — افتح التطبيق لتجهيزه.",
      { type: "new_order", order_id: event.params.orderId }
    );
  } catch (e) {
    console.error("خطأ إرسال إشعار الطلب الجديد للمتجر:", e.message || e);
  }
});

/* ══════════════════════════════════════════════════════════
   4) طلب صار "جاهز" (ready) بدون سائق بعد → إشعار جماعي
      لكل السائقين المتاحين (is_available == true) بمنطقة عامة،
      عشان يشوفوا فيه طلب متاح بأسرع وقت (بدل ما يعتمدوا بس على
      فتح التطبيق والتحديث اللحظي بصفحة "الطلبات المتاحة").
   ⚠️ إشعار جماعي (broadcast) — لو عدد السائقين المتاحين كبير
      مستقبلاً، يُفضّل تحويله لموضوع FCM Topic بدل حلقة send فردية.
   ══════════════════════════════════════════════════════════ */
exports.onOrderReady = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  const becameReady = before.status !== "ready" && after.status === "ready" && !after.driver_id;
  if (!becameReady) return;

  try {
    const availSnap = await db.collection("drivers").where("is_available", "==", true).get();
    const tokens = availSnap.docs.map((d) => d.data().fcm_token).filter(Boolean);
    if (!tokens.length) return;

    await Promise.all(
      tokens.map((token) =>
        sendPush(token, "طلب جديد متاح 📦", "في طلب جديد جاهز بانتظار سائق — افتح التطبيق.", {
          type: "order_available",
          order_id: event.params.orderId,
        })
      )
    );
  } catch (e) {
    console.error("خطأ إرسال إشعار الطلب المتاح:", e.message || e);
  }
});
