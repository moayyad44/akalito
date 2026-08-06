# تطبيق أكليتو المتجر — نسخة أندرويد (Capacitor)

هذا المجلد فيه مشروع Android حقيقي (مبني بـ Capacitor) يغلّف akleto-store.html
بتطبيق APK قابل للتثبيت على أي جهاز أندرويد أو رفعه على Google Play مستقبلاً.

## طريقة عمله

المشروع مضبوط على تحميل التطبيق **مباشرة من الرابط الحي** على GitHub Pages:

```
https://moayyad44.github.io/akalito/akleto-store.html
```

(الإعداد بملف `capacitor.config.json` تحت `server.url`) — يعني أي تحديث تسويه
لاحقاً على الصفحة وتدفعه لـ GitHub، بينعكس تلقائياً بالتطبيق المثبّت **بدون
إعادة بناء APK جديد**.

## خطوات بناء الـ APK (نفس خطوات تطبيق السائق بالضبط)

1. `git pull origin main` لتحديث المستودع على جهازك.
2. من داخل مجلد `mobile-store`: `npm install` ثم `npx cap sync android`.
3. افتح مجلد `mobile-store/android` بـ Android Studio (مجلد `android` نفسه).
4. استنى Gradle Sync يخلص.
5. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
6. الملف رح يطلع بمسار شبيه بـ:
   `android/app/build/outputs/apk/debug/app-debug.apk`

## ملاحظة: إشعارات الدفع

هذا التطبيق **ما فيه إشعارات دفع (Push Notifications) حالياً** — لأن صفحة
akleto-store.html نفسها ما فيها كود يستقبلها بعد (بعكس الزبون والسائق). لو
حبينا نضيفها مستقبلاً، نفس الخطوات المستخدمة بتطبيق السائق (تسجيل التطبيق
بـ Firebase Console بـ package name = `com.akalito.store`، تحميل `google-services.json`،
وإضافة `@capacitor/push-notifications`).

## تغيير اسم التطبيق أو الأيقونة

- الاسم الظاهر: `android/app/src/main/res/values/strings.xml` (`app_name`).
- الأيقونة: مصدرها `resources/icon.png` (حالياً نفس أيقونة السائق مؤقتاً —
  استبدلها بأيقونة أكليتو المتجر الخاصة، ثم شغّل من جوا `mobile-store`:
  ```
  npm install
  npx capacitor-assets generate --android
  ```
