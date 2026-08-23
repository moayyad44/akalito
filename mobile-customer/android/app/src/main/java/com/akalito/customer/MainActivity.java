package com.akalito.customer;

import android.os.Bundle;
import android.os.Handler;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
  /* بنضل نمسك الـsplash الأصلي (Native) ظاهر لحد ما تخلص الصفحة تحميل
     فعلياً من الإنترنت (server.url بعيد) — بدل الاعتماد على جسر
     الجافاسكربت (SplashScreen.hide() من طرف الويب)، اللي فيه مشكلة
     موثّقة بـCapacitor نفسها بتخليه ما يشتغل صح لما المحتوى محمّل من
     سيرفر بعيد. هيك التحكم صار كامل من كود أندرويد الأصلي، بعيد عن
     أي تعقيد بجسر الجافاسكربت. */
  private volatile boolean pageReady = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
    splashScreen.setKeepOnScreenCondition(() -> !pageReady);

    super.onCreate(savedInstanceState);

    getBridge().getWebView().setWebViewClient(new BridgeWebViewClient(getBridge()) {
      @Override
      public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        pageReady = true;
      }
    });

    // مهلة أمان قصوى — حتى لو تأخر تحميل الصفحة لأي سبب (إنترنت ضعيف
    // مثلاً)، ما تضل شاشة الـsplash عالقة للأبد
    new Handler(getMainLooper()).postDelayed(() -> pageReady = true, 6000);
  }
}
