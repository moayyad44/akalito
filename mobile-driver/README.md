# تطبيق أكليتو للكباتن — نسخة أندرويد (Capacitor)

هذا المجلد فيه مشروع Android حقيقي (مبني بـ Capacitor) يغلّف تطبيق السائق
(`akleto-driver.html` وباقي صفحاته: `akleto-driver-home.html`،
`akleto-driver-orders.html`، `akleto-driver-deliveries.html`،
`akleto-driver-account.html`، `akleto-driver-reports.html`،
`akleto-driver-settle.html`، `akleto-driver-cards.html`) بتطبيق APK قابل
للتثبيت على أي جهاز أندرويد أو رفعه على Google Play مستقبلاً.

## طريقة عمله (مهم تفهمها)

المشروع مضبوط حالياً على تحميل التطبيق **مباشرة من الرابط الحي** على GitHub Pages:

```
https://moayyad44.github.io/akalito/akleto-driver.html
```

(الإعداد موجود بملف `capacitor.config.json` تحت `server.url`). هذه هي صفحة
تسجيل الدخول/التسجيل، ومنها تتنقل باقي صفحات السائق بنفس طريقة عملها
بالمتصفح حالياً (`location.href`).

**ليش هيك؟** لأنه أي تحديث تسويه لاحقاً على أي صفحة من صفحات السائق وتدفعه
لـ GitHub، بينعكس تلقائياً بالتطبيق المثبّت عند الكابتن **بدون ما تحتاج تبني
APK جديد ولا الكابتن يحمّل تحديث من المتجر** — بالضبط متل ما التطبيق يشتغل
هلق بالمتصفح. الكابتن بس محتاج يكون عنده إنترنت وقت الاستخدام (وهذا أصلاً
متطلب أساسي للتطبيق لأنه يعتمد على Firebase والخرائط).

## المتطلبات عند مؤيد (مرة وحدة بس)

1. تثبيت **Android Studio** (مجاني): https://developer.android.com/studio
2. أول ما تفتحه أول مرة، بيسألك يحمّل Android SDK — وافق واتركه يخلص (يحتاج إنترنت
   ووقت، مرة وحدة بس).
3. **خطوة إضافية لتفعيل إشعارات الدفع (Push Notifications) — ضرورية:**
   - روح لـ [Firebase Console](https://console.firebase.google.com) → مشروع
     `akleto-prod` (نفس المشروع المستخدم بـ Firestore والزبون).
   - **Project settings** (⚙️ بجانب "Project Overview") → تبويب **General** →
     تحت "Your apps" اضغط **Add app** واختر أيقونة أندرويد.
   - **Android package name** لازم يكون بالضبط: `com.akalito.driver`
   - كمّل خطوات التسجيل (اسم التطبيق اختياري) وحمّل ملف **`google-services.json`**.
   - حط الملف بالمسار: `mobile-driver/android/app/google-services.json`
     (نفس مستوى ملف `build.gradle` جوا `app/`).
   - بدون هذا الملف، التطبيق رح يبنى ويشتغل عادي، بس إشعارات الدفع ما رح تشتغل
     (رح تطلع رسالة تحذير بسيطة بـ Gradle، مش خطأ يوقف البناء).

## خطوات بناء الـ APK

1. اعمل `git clone` أو `git pull` للمستودع كامل على جهازك.
2. افتح **Android Studio**.
3. من شاشة الترحيب اختر **Open** وحدد مجلد:
   ```
   akalito/mobile-driver/android
   ```
   (لاحظ: تفتح مجلد `android` نفسه، مش `mobile-driver`).
4. اصبر لحتى يخلص Android Studio أول "Gradle Sync" (شريط تحميل بالأسفل) —
   أول مرة ممكن ياخذ كم دقيقة.
5. من القائمة العلوية: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
6. لما يخلص، بيطلعلك إشعار "APK(s) generated successfully" مع رابط **locate**
   يوديك مباشرة لمكان الملف (عادة بمسار شبيه بـ:
   `android/app/build/outputs/apk/debug/app-debug.apk`).
7. انسخ هذا الملف لجوال الكابتن (واتساب لنفسك، إيميل، أو كيبل) وثبّته مباشرة
   (لازم تفعّل "السماح بالتثبيت من مصادر غير معروفة" بإعدادات أندرويد أول مرة).

هذا الـ APK (debug) شغال تماماً للتجربة الداخلية الحالية. لو قررت لاحقاً ترفعه
رسمياً على Google Play، بده يحتاج خطوة إضافية اسمها "التوقيع بمفتاح release"
(signing) — نعملها وقتها لما توصل لهاي المرحلة.

## تغيير اسم التطبيق أو الأيقونة

- الاسم الظاهر تحت الأيقونة: `android/app/src/main/res/values/strings.xml`
  (`app_name`).
- الأيقونة: مصدرها `resources/icon.png` بهاد المجلد (نفس أيقونة `driver-512.png`
  المستخدمة أصلاً بـ PWA manifest) — لو غيّرتها، شغّل:
  ```
  npm install
  npx capacitor-assets generate --android
  ```
  من جوا مجلد `mobile-driver` (يحتاج Node.js مثبت عندك).

## الميزات المستقبلية المسجّلة (لسا ما اتنفذت — تحتاج هذا المشروع كخطوة أولى)

هاي الثلاث ميزات مسجّلة بـ`context.md` الرئيسي، وهذا المشروع هو الأساس اللي
لازم نبني عليه فوق عشان نقدر ننفذها بكود أندرويد أصلي:

1. **إشعار ثابت "جاري العمل..."** أثناء تفعيل "متاح" — يحتاج **Foreground
   Service** حقيقي (مش Local Notification عادية قابلة للمسح).
2. **رجوع التطبيق تلقائياً للمقدمة** عند وصول طلب جديد وهو بالخلفية/الشاشة
   مقفولة — يحتاج **Full-Screen Intent Notification** (نفس آلية واتساب
   للمكالمات) بصلاحية `USE_FULL_SCREEN_INTENT`.
3. **رنة صوت عند وصول طلب جديد** — عبر Local/Push Notification بصوت مخصص.

كل هذول يحتاجون كود Java/Kotlin إضافي جوا `android/app/src/main/java/com/akalito/driver/`
(مش مجرد إعدادات Capacitor افتراضية) — رح نضيفهم بجلسات قادمة بعد ما يتأكد
مؤيد إن المشروع الأساسي هذا يبني ويشتغل عنده أول مرة بـ Android Studio.

## إشعارات الدفع (Push Notifications) — وين وصلنا ووين الباقي

تمت إضافة الجزء الأول فقط (نفس حالة تطبيق الزبون):

- ✅ الـ plugin (`@capacitor/push-notifications`) مركّب ومربوط بمشروع أندرويد
- ✅ صلاحية `POST_NOTIFICATIONS` مضافة (مطلوبة لأندرويد 13 فما فوق)
- ⚠️ **لسا ناقص:** ربط استقبال التوكن وحفظه بمستند الكابتن بـ Firestore
  (`drivers/{driverId}`)، وكمان جزء "الإرسال الفعلي" عبر Cloud Function —
  نفس الحالة بالضبط المطلوب استكمالها بتطبيق الزبون. هاي خطوة منفصلة بجلسة
  قادمة، ومن الأفضل تُعمل مرة وحدة تخدم التطبيقين سوا (زبون + سائق) بما إنهم
  بيعتمدون على نفس مشروع Firebase.

## ملاحظة مهمة

✅ `google-services.json` **مرفوع بهذا المستودع** (`android/app/google-services.json`)
ومتحقّق إنه يحتوي على `com.akalito.driver` ضمن مشروع `akleto-prod` — البناء
جاهز ليشمل إعدادات إشعارات الدفع من أول تجربة APK.
