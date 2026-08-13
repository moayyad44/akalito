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

// مدة عرض الطلب على كل سائق بالدور (ثواني) — لازم تطابق العدّاد بواجهة السائق (akleto-driver-home.html)
const OFFER_WINDOW_SECONDS = 5;

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

/* يبعت إشعار FCM واحد لتوكن معيّن، وبيتعامل بهدوء مع توكن غير صالح/منتهي
   fullScreenAlert=true → data-only بدون notification block (تنبيهات طلبات السائق فقط) —
   عشان تضمن استدعاء onMessageReceived بكود التطبيق حتى لو التطبيق مسكّر تماماً،
   وتسمح ببناء إشعار "Full-Screen Intent" يفتح التطبيق فوق شاشة القفل. */
async function sendPush(token, title, body, data = {}, fullScreenAlert = false) {
  if (!token) return;
  try {
    const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    const payload = {
      token,
      data: fullScreenAlert ? { ...stringData, title, body } : stringData,
      android: { priority: "high" },
    };
    if (!fullScreenAlert) payload.notification = { title, body };
    await messaging.send(payload);
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
        { type: "order_assigned", order_id: orderId },
        true
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
   4) طلب صار "جاهز" (ready) بدون سائق بعد → توزيع بالدور
      بدل ما نبعت الطلب لكل السائقين المتاحين مرة وحدة، نعرضه
      على أقرب سائق متاح (وغير مشغول بطلب نشط) بمفرده لمدة
      OFFER_WINDOW_SECONDS (5 ثواني). لو ما قبِله خلال المهلة،
      يتدوّر تلقائياً لأقرب سائق تالي، وهكذا. لو خلصت قائمة
      السائقين المتاحين بدون قبول، يرجع الطلب "مفتوح للجميع"
      (broadcast) كخط أمان عشان ما يعلق بدون سائق نهائياً.
   ══════════════════════════════════════════════════════════ */

/* حساب المسافة بالمتر بين نقطتين (Haversine) */
function distanceMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* يرجع مجموعة IDs السائقين المشغولين حالياً بطلب توصيل نشط (status == delivering) */
async function getBusyDriverIds() {
  const snap = await db.collection("orders").where("status", "==", "delivering").get();
  return new Set(snap.docs.map((d) => d.data().driver_id).filter(Boolean));
}

/* يختار أقرب سائق متاح وغير مشغول لموقع المتجر، ما عدا اللي جُرّبوا قبل بنفس الطلب.
   لو المتجر أو السائق ما عندهم إحداثيات محفوظة، بيتعامل معهم كـ"أبعد خيار" بدل ما يتجاهلهم
   بالكامل — عشان الطلب يضل يوصل لسائق مباشرة حتى لو نقصت بيانات الموقع. */
async function pickNextDriver(storeLat, storeLng, triedIds) {
  const [availSnap, busyIds] = await Promise.all([
    db.collection("drivers").where("is_available", "==", true).get(),
    getBusyDriverIds(),
  ]);
  let best = null;
  let bestDist = Infinity;
  availSnap.docs.forEach((d) => {
    if (triedIds.includes(d.id) || busyIds.has(d.id)) return;
    const data = d.data();
    const dist = distanceMeters(storeLat, storeLng, data.lat, data.lng);
    if (best === null || dist < bestDist) { bestDist = dist; best = { id: d.id, ...data }; }
  });
  return best;
}

/* يعرض الطلب على أقرب سائق تالي، أو يفتحه للجميع (broadcast) لو خلصت قائمة السائقين.
   يرجع id السائق المعروض عليه الطلب، أو null لو ما في سائق تاني (صار broadcast). */
async function offerOrderToNextDriver(orderId, order, triedIds) {
  let storeLat = null;
  let storeLng = null;
  if (order.store_id) {
    const storeSnap = await db.collection("stores").doc(order.store_id).get();
    if (storeSnap.exists) {
      storeLat = storeSnap.data().lat;
      storeLng = storeSnap.data().lng;
    }
  }

  const next = await pickNextDriver(storeLat, storeLng, triedIds);

  if (!next) {
    // ما بقي سائق تاني نجرّبه — نفتح الطلب للجميع كخط أمان بدل ما يعلق بدون سائق
    await db.collection("orders").doc(orderId).update({
      offered_driver_id: null,
      offer_broadcast: true,
      offer_expires_at: null,
      offered_driver_ids: triedIds,
    });
    try {
      const availSnap = await db.collection("drivers").where("is_available", "==", true).get();
      const tokens = availSnap.docs.map((d) => d.data().fcm_token).filter(Boolean);
      await Promise.all(
        tokens.map((token) =>
          sendPush(token, "طلب جديد متاح 📦", "في طلب جديد جاهز بانتظار سائق — افتح التطبيق.", {
            type: "order_available",
            order_id: orderId,
          }, true)
        )
      );
    } catch (e) {
      console.error("خطأ إرسال إشعار الطلب المفتوح للجميع:", e.message || e);
    }
    return null;
  }

  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OFFER_WINDOW_SECONDS * 1000);
  await db.collection("orders").doc(orderId).update({
    offered_driver_id: next.id,
    offer_broadcast: false,
    offer_expires_at: expiresAt,
    offered_driver_ids: admin.firestore.FieldValue.arrayUnion(next.id),
  });

  await sendPush(
    next.fcm_token,
    "طلب جديد إلك 🚴",
    "عندك 5 ثواني لقبول الطلب — افتح التطبيق.",
    { type: "order_offer", order_id: orderId },
    true
  );

  return next.id;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ══════════════════════════════════════════════════════════
   الدالة نفسها "تستنى" مدة العرض وتتحقق وتدوّر — كل هذا جوا نفس
   التنفيذ، بدون أي Cloud Tasks Queue خارجية (كانت تحتاج إعداد إضافي
   على مستوى المشروع بـGoogle Cloud فشل تفعيله رغم كل المحاولات —
   هالحل أبسط وما بيحتاج أي بنية تحتية خارجية إطلاقاً).
   حد أقصى 10 محاولات تدوير كخط أمان (10 × 5 ثواني = 50 ثانية،
   ضمن مهلة الدالة القصوى المحددة 120 ثانية). ══════════════════ */
const MAX_ROTATIONS = 10;

exports.onOrderReady = onDocumentUpdated(
  { document: "orders/{orderId}", timeoutSeconds: 120 },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    const becameReady = before.status !== "ready" && after.status === "ready" && !after.driver_id;
    if (!becameReady) return;

    const orderId = event.params.orderId;
    let triedIds = [];

    try {
      for (let attempt = 0; attempt < MAX_ROTATIONS; attempt++) {
        const orderSnap = await db.collection("orders").doc(orderId).get();
        if (!orderSnap.exists) return;
        const currentOrder = orderSnap.data();
        if (currentOrder.status !== "ready" || currentOrder.driver_id) return; // اتقبل أو اتلغى

        const offeredId = await offerOrderToNextDriver(orderId, currentOrder, triedIds);
        if (!offeredId) return; // صار broadcast — خلصت قائمة السائقين

        await sleep(OFFER_WINDOW_SECONDS * 1000);

        const afterWaitSnap = await db.collection("orders").doc(orderId).get();
        if (!afterWaitSnap.exists) return;
        const afterWaitOrder = afterWaitSnap.data();
        // لو السائق قبِل الطلب خلال المهلة، status ما عاد ready — نوقف هون
        if (afterWaitOrder.status !== "ready" || afterWaitOrder.offered_driver_id !== offeredId) return;

        triedIds = [...triedIds, offeredId];
      }
    } catch (e) {
      console.error("خطأ توزيع الطلب بالدور:", e.message || e);
    }
  }
);
