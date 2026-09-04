// سكربت زرع 20 وجبة سريعة + مكوناتها بقاعدة بيانات أكليتو
// طريقة التشغيل: راجع README.md المرفق بنفس المجلد
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed_data.json'), 'utf-8'));

async function main() {
  console.log('🔎 التحقق من مكونات موجودة مسبقاً بنفس الاسم (تجنّب التكرار)...');
  const existingIngSnap = await db.collection('ingredients').get();
  const existingIngByName = {};
  existingIngSnap.forEach(doc => { existingIngByName[doc.data().name_ar] = doc.id; });

  const existingMealSnap = await db.collection('meals').get();
  const existingMealNames = new Set();
  existingMealSnap.forEach(doc => existingMealNames.add(doc.data().name_ar));

  console.log('📦 كتابة المكونات...');
  const ingredientIdByKey = {};
  for (const [key, ing] of Object.entries(data.ingredients)) {
    if (existingIngByName[ing.name_ar]) {
      ingredientIdByKey[key] = existingIngByName[ing.name_ar];
      console.log(`  ⏭️  موجود مسبقاً: ${ing.name_ar}`);
      continue;
    }
    const ref = await db.collection('ingredients').add({
      name_ar: ing.name_ar,
      category: ing.category,
      measure_type: ing.measure_type,
      package_label: ing.package_label,
      package_qty: ing.package_qty,
      price_per_package: ing.price_per_package,
      image_url: ing.image_url,
      is_active: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    ingredientIdByKey[key] = ref.id;
    console.log(`  ✅ أُضيف: ${ing.name_ar}`);
  }

  console.log('🍔 كتابة الوجبات وربط المكونات...');
  let addedMeals = 0, skippedMeals = 0;
  for (const meal of data.meals) {
    if (existingMealNames.has(meal.name_ar)) {
      console.log(`  ⏭️  وجبة موجودة مسبقاً، تخطّي: ${meal.name_ar}`);
      skippedMeals++;
      continue;
    }
    const mealRef = await db.collection('meals').add({
      name_ar: meal.name_ar,
      category: meal.category,
      difficulty: meal.difficulty,
      prep_time_min: meal.prep_time_min,
      base_price: meal.base_price,
      servings_default: meal.servings_default,
      is_active: meal.is_active,
      description: meal.description,
      image_url: meal.image_url,
      order_count: 0,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const batch = db.batch();
    for (const r of meal.recipe) {
      const ingId = ingredientIdByKey[r.ingredient_key];
      if (!ingId) {
        console.warn(`   ⚠️ مكوّن غير موجود: ${r.ingredient_key} لوجبة ${meal.name_ar}`);
        continue;
      }
      const miRef = db.collection('meal_ingredients').doc();
      batch.set(miRef, {
        meal_id: mealRef.id,
        ingredient_id: ingId,
        recipe_unit: r.recipe_unit,
        recipe_qty: r.recipe_qty,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    console.log(`  ✅ أُضيفت: ${meal.name_ar} (${meal.recipe.length} مكوّن)`);
    addedMeals++;
  }

  console.log('\n🎉 انتهى!');
  console.log(`   وجبات جديدة: ${addedMeals}`);
  console.log(`   وجبات متخطّاة (موجودة مسبقاً): ${skippedMeals}`);
  console.log(`   إجمالي المكونات بالنظام الآن: ${Object.keys(ingredientIdByKey).length}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ خطأ:', err);
  process.exit(1);
});
