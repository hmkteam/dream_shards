package com.hmkteam.dreamshards;

import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.OnApplyWindowInsetsListener;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewListener;

import java.util.Locale;

/**
 * Surfaces the window insets to the page as the CSS variables --sat / --sar /
 * --sab / --sal (CSS px), which the layout reads before falling back to
 * env(safe-area-inset-*).
 *
 * <p>The values are pushed on every insets change and after every page load
 * (the variables live on the document, which a load replaces). A push is
 * evaluated only after the page has painted, though, and whatever stands under
 * --sat (the title screen's gear, the HUD's menu button) would re-flow on it,
 * jumping right after launch. So the page's pre-paint boot script also pulls the same
 * declarations synchronously through the {@link #JS_INTERFACE} interface
 * (the page (optional pre-paint reader)) and lays its first frame out with them.
 */
final class SafeAreaInsets {

    /** Global name of the JS interface; SAFE_AREA_BRIDGE in the page (optional pre-paint reader). */
    static final String JS_INTERFACE = "SafeAreaBridge";

    /** Reply of {@link #read()} until the window has reported its insets. */
    private static final String NO_DECLARATIONS = "{}";

    private final WebView webView;
    private final float density;

    /**
     * The variables as a JSON object of declarations, or null until the first
     * insets dispatch. Written on the UI thread, read by {@link #read()} on the
     * WebView's JS bridge thread.
     */
    private volatile String declarations = null;

    private SafeAreaInsets(WebView webView) {
        this.webView = webView;
        this.density = webView.getResources().getDisplayMetrics().density;
    }

    /**
     * Track the WebView's insets and expose them to its pages. Call while the
     * activity is created, before the first page commits, so the JS interface
     * is there for its pre-paint script.
     *
     * @param bridge - The Capacitor bridge, for page-load callbacks.
     * @param webView - The bridge's WebView.
     */
    static void install(Bridge bridge, final WebView webView) {
        final SafeAreaInsets insets = new SafeAreaInsets(webView);
        webView.addJavascriptInterface(insets, JS_INTERFACE);

        ViewCompat.setOnApplyWindowInsetsListener(webView, new OnApplyWindowInsetsListener() {
            @Override
            public WindowInsetsCompat onApplyWindowInsets(View v, WindowInsetsCompat insetsCompat) {
                insets.update(insetsCompat);
                return insetsCompat;
            }
        });

        // Re-inject after every page load — the previous document (blank or old)
        // is gone and any CSS vars set on its documentElement are lost.
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                insets.push();
                // Trigger a fresh dispatch in case insets weren't ready earlier.
                ViewCompat.requestApplyInsets(view);
            }
        });

        ViewCompat.requestApplyInsets(webView);
    }

    /**
     * The current declarations for the page's pre-paint script.
     *
     * @return A JSON object such as {"--sat":"36px",…}; {} before the first
     *     insets dispatch.
     */
    @JavascriptInterface
    public String read() {
        final String current = declarations;
        return current != null ? current : NO_DECLARATIONS;
    }

    private void update(WindowInsetsCompat insetsCompat) {
        Insets bars = insetsCompat.getInsets(
                WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout());
        // The status bar is hidden in immersive mode, so reserving its
        // height at the top would leave a blank strip there (the page's
        // background shows through). Up top we only clear the display
        // cutout, so the HUD never sits under a notch / punch-hole camera
        // but no space is wasted on a status bar that isn't drawn. Sides
        // and bottom still reserve the full system-bar insets (gesture
        // navigation, landscape cutout) so content isn't clipped there.
        Insets cutout = insetsCompat.getInsets(WindowInsetsCompat.Type.displayCutout());
        declarations = String.format(
                Locale.US,
                "{\"--sat\":\"%dpx\",\"--sar\":\"%dpx\",\"--sab\":\"%dpx\",\"--sal\":\"%dpx\"}",
                toCssPx(cutout.top),
                toCssPx(bars.right),
                toCssPx(bars.bottom),
                toCssPx(bars.left));
        push();
    }

    private int toCssPx(int devicePx) {
        return Math.round(devicePx / density);
    }

    private void push() {
        final String current = declarations;
        if (current == null) return;
        final String js =
                "(function(d){var s=document.documentElement&&document.documentElement.style;"
                        + "if(!s)return;"
                        + "for(var k in d)s.setProperty(k,d[k]);"
                        + "})(" + current + ");";
        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(js, null);
            }
        });
    }
}
