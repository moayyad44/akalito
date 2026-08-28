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
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// مدة عرض الطلب على كل سائق بالدور (ثواني) — لازم تطابق العدّاد بواجهة السائق (akleto-driver-home.html)
const OFFER_WINDOW_SECONDS = 10;

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
/* ══════════════════════════════════════════════════════════
   إشعار دفع فعلي لكل الأدمنز عند أي تنبيه جديد بمجموعة
   admin_notifications — بس فقط الأنواع المتعلقة بالعمولات/الفلوس
   (بطلب صريح من مؤيد: بدون تنبيهات الطلبات نفسها new_order/order_ready/
   order_claimed، لأنها كتيرة ومش ضرورية بالإشعار الفوري). باقي الأنواع
   تنكتب بمجموعة admin_notifications عادي وتظهر بصفحة إشعارات لوحة
   الإدارة، بس بدون push فعلي عالموبايل.
   ══════════════════════════════════════════════════════════ */
const ADMIN_PUSH_TYPES = new Set([
  'store_commission_request',    // متجر طالب تحصيل مستحقاته من أكليتو
  'driver_settlement_request',   // سائق سدّد/بده يسدد عمولة أكليتو المستحقة عليه
  'driver_payout_request'        // سائق طالب تحويل مستحقاته من أكليتو
]);

exports.onAdminNotificationCreated = onDocumentCreated("admin_notifications/{notifId}", async (event) => {
  const notif = event.data.data();
  if (!notif) return;
  if (!ADMIN_PUSH_TYPES.has(notif.type)) return;
  try {
    const adminsSnap = await db.collection("admins").get();
    const sends = [];
    adminsSnap.forEach((docSnap) => {
      const token = docSnap.data().fcm_token;
      if (token) {
        sends.push(sendPush(
          token,
          notif.title || "تنبيه جديد 🔔",
          notif.message || "",
          { type: notif.type || "general", notif_id: event.params.notifId }
        ));
      }
    });
    await Promise.all(sends);
  } catch (e) {
    console.error("خطأ إرسال إشعار الدفع للأدمن:", e.message || e);
  }
});

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
      OFFER_WINDOW_SECONDS (10 ثواني). لو ما قبِله خلال المهلة،
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
    "عندك 10 ثواني لقبول الطلب — افتح التطبيق.",
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
   حد أقصى 10 محاولات تدوير كخط أمان (10 × 10 ثواني = 100 ثانية،
   ضمن مهلة الدالة القصوى المحددة 180 ثانية). ══════════════════ */
const MAX_ROTATIONS = 10;

exports.onOrderReady = onDocumentUpdated(
  { document: "orders/{orderId}", timeoutSeconds: 180, minInstances: 1 },
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

/* ══════════════════════════════════════════════════════════
   checkCustomerPhone — فحص وجود حساب زبون برقم هاتف معيّن، سيرفر-سايد.
   ⚠️ سبب وجودها: تطبيق الزبون كان يستعلم مجموعة `customers` مباشرة
   (where phone == ...) وقاعدة القراءة كانت `if true` (لازمة نظرياً
   لعمل هالفحص قبل أي Auth). المشكلة: القراءة المفتوحة بتسمح لأي حد
   بالعالم يجيب `getDocs(collection(db,'customers'))` بدون فلتر ويفرّغ
   اسم ورقم هاتف كل زبون بالنظام — تسريب بيانات حقيقي، مو بس مشكلة
   تخمين. الحل: `customers.read` صار مقيّد لصاحب الحساب/الأدمن بس، وهاي
   الدالة (Admin SDK، بتتجاوز القواعد) هي الطريقة الوحيدة المتبقية
   للتحقق من رقم معيّن قبل تسجيل الدخول أو إنشاء حساب جديد — بترجع
   معلومة عن رقم واحد بالضبط تم إرساله، مش كامل الجدول. ══════════════ */
exports.checkCustomerPhone = onCall(async (request) => {
  const phone = String((request.data && request.data.phone) || "").trim();
  if (!/^0\d{8,9}$/.test(phone)) {
    throw new HttpsError("invalid-argument", "رقم الهاتف غير صحيح");
  }

  const snap = await db.collection("customers").where("phone", "==", phone).limit(1).get();
  if (snap.empty) {
    return { exists: false };
  }
  const data = snap.docs[0].data();
  return {
    exists: true,
    customerId: snap.docs[0].id,
    name: data.name || "",
    isBlocked: !!data.is_blocked,
  };
});

/* ══════════════════════════════════════════════════════════
   migrateDriverDocuments — دالة ترحيل تُستخدم مرة وحدة بس (يدوياً من أدمن حقيقي).
   تنقل الحقول الحساسة (صور الهوية/الرخصة/شهادة عدم المحكومية + IBAN)
   الموجودة بمستندات drivers القديمة (كانت تُقرأ ضمن قراءة drivers.read
   العامة سابقاً) لمجموعة driver_documents المحمية، وتحذف الحقول من
   drivers بعدها — عشان ما يضل أي حقل حساس مكشوف حتى بعد نشر القواعد
   الجديدة (اللي صارت drivers.read مسموحة لأي مستخدم مسجّل دخول، مش
   أدمن/صاحب الحساب بس). محمية بفحص admins/{uid} صريح جوا الدالة نفسها. */
exports.migrateDriverDocuments = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "لازم تسجّل دخول كأدمن أولاً");
  }
  const adminDoc = await db.collection("admins").doc(request.auth.uid).get();
  if (!adminDoc.exists) {
    throw new HttpsError("permission-denied", "هالميزة للأدمن بس");
  }

  const SENSITIVE_FIELDS = [
    "photo_url", "id_front_url", "id_back_url", "license_url",
    "vehicle_license_front_url", "vehicle_license_back_url",
    "clearance_certificate_url", "iban",
  ];

  const driversSnap = await db.collection("drivers").get();
  const ops = [];
  let migrated = 0;
  driversSnap.docs.forEach((driverDoc) => {
    const data = driverDoc.data();
    const hasSensitive = SENSITIVE_FIELDS.some((f) => f in data);
    if (!hasSensitive) return;

    const docPayload = {};
    const deletePayload = {};
    SENSITIVE_FIELDS.forEach((f) => {
      if (f in data) {
        docPayload[f] = data[f];
        deletePayload[f] = admin.firestore.FieldValue.delete();
      }
    });

    ops.push(db.collection("driver_documents").doc(driverDoc.id).set(docPayload, { merge: true }));
    ops.push(driverDoc.ref.update(deletePayload));
    migrated++;
  });
  await Promise.all(ops);
  return { migrated, totalDrivers: driversSnap.size };
});
