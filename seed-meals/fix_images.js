// سكربت إصلاح الصور: يبدّل روابط الصور المكسورة (علامات استفهام) بصور بديلة سليمة
// يشتغل على الوجبات والمكونات الموجودة مسبقاً (ما بيضيف شي جديد، بس بيحدّث image_url)
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed_data.json'), 'utf-8'));

async function main() {
  console.log('🖼️  إصلاح صور المكونات...');
  const ingSnap = await db.collection('ingredients').get();
  let ingFixed = 0;
  const ingByName = {};
  Object.values(data.ingredients).forEach(v => { ingByName[v.name_ar] = v.image_url; });

  const batch1 = db.batch();
  ingSnap.forEach(doc => {
    const name = doc.data().name_ar;
    if (ingByName[name]) {
      batch1.update(doc.ref, { image_url: ingByName[name] });
      ingFixed++;
    }
  });
  await batch1.commit();
  console.log(`  ✅ تم تحديث ${ingFixed} مكوّن`);

  console.log('🖼️  إصلاح صور الوجبات...');
  const mealSnap = await db.collection('meals').get();
  let mealFixed = 0;
  const mealByName = {};
  data.meals.forEach(m => { mealByName[m.name_ar] = m.image_url; });

  const batch2 = db.batch();
  mealSnap.forEach(doc => {
    const name = doc.data().name_ar;
    if (mealByName[name]) {
      batch2.update(doc.ref, { image_url: mealByName[name] });
      mealFixed++;
    }
  });
  await batch2.commit();
  console.log(`  ✅ تم تحديث ${mealFixed} وجبة`);

  console.log('\n🎉 انتهى! الصور الآن مربّعات بلون هوية أكليتو بدون أي علامات استفهام.');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ خطأ:', err);
  process.exit(1);
});
