package com.hmkteam.dreamshards;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

/**
 * Game shell activity. Ported from tycoon (Cropstop County) without its
 * analytics: immersive full screen, back gesture swallowed, edge strips handed
 * to the game, no force-dark, launch colour = app background, safe-area CSS
 * variables, repaint on return from background.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The web UI is drawn by the game: never let the system dark theme
        // invert it (MIUI auto-inverted the WebView otherwise).
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);

        super.onCreate(savedInstanceState);

        // Edge-to-edge is mandatory at targetSdk 36; the WebView paints under
        // the bars and SafeAreaInsets reports the insets to CSS.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        applyImmersiveMode();

        // An inward swipe from a screen edge must not close the game.
        BackGestureGuard.install(this);

        final WebView webView = getBridge().getWebView();
        if (webView == null) return;

        // Until the first frame the WebView shows its own (white) background.
        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.app_background));

        // Music may start without a first tap.
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);

        EdgeGestureExclusion.install(webView);
        disableWebViewDarkening(webView);
        SafeAreaInsets.install(getBridge(), webView);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Recents / system dialogs bring the bars back: re-arm each time, and
        // redraw the WebView, which can return from a long background blank.
        if (hasFocus) {
            applyImmersiveMode();
            requestWebViewRepaint();
        }
    }

    private void requestWebViewRepaint() {
        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.requestLayout();
                webView.invalidate();
            }
        });
    }

    private void applyImmersiveMode() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller == null) return;
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    private void disableWebViewDarkening(final WebView webView) {
        final WebSettings settings = webView.getSettings();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        } else if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF);
        }
    }
}
