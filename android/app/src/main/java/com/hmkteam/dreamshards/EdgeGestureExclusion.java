package com.hmkteam.dreamshards;

import android.graphics.Rect;
import android.view.View;

import androidx.core.view.ViewCompat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Asks the system not to treat touches in a strip along the left and right
 * window edges as the back gesture, so a drag started next to an edge reaches
 * the WebView instead of being swallowed by gesture navigation.
 *
 * <p>{@link BackGestureGuard} already keeps the gesture from backgrounding the
 * game, but a consumed back event is still a back event: the system grabs the
 * touch stream and the player's pan of the world breaks. Exclusion rects stop the gesture
 * from being recognised in the first place.
 *
 * <p>Android honours at most {@value #MAX_EXCLUDED_HEIGHT_DP} dp of exclusion
 * per edge, so a full-height strip is impossible — the band is centred
 * vertically, over the part of the screen where the world is dragged most.
 * Outside the band the edge still belongs to the system gesture (harmlessly, as
 * the guard keeps it from closing the app). Below API 29 the call is a no-op:
 * older devices have no gesture navigation to opt out of.
 */
final class EdgeGestureExclusion {

    /** Per-edge exclusion height the platform honours; larger requests are trimmed. */
    private static final float MAX_EXCLUDED_HEIGHT_DP = 200f;

    /**
     * Width of the excluded strip along each vertical edge. Only the height is
     * capped by the platform, so this is set comfortably wider than the system
     * gesture inset (~24-40 dp) to cover every device's edge region.
     */
    private static final float EDGE_STRIP_WIDTH_DP = 48f;

    private EdgeGestureExclusion() {}

    /**
     * Installs the exclusion on the given view and keeps it in sync with the
     * view's size (split-screen resize, insets, transient system bars).
     *
     * @param view View whose window edges should be excluded, in practice the
     *             Capacitor WebView that receives the touch input.
     */
    static void install(final View view) {
        final float density = view.getResources().getDisplayMetrics().density;
        final Applier applier = new Applier(density);

        view.addOnLayoutChangeListener(applier);
        if (view.getWidth() > 0 && view.getHeight() > 0) applier.apply(view);
    }

    /** Recomputes the rects on layout, skipping the call when nothing changed. */
    private static final class Applier implements View.OnLayoutChangeListener {
        private final float density;
        private List<Rect> applied = Collections.emptyList();

        Applier(float density) {
            this.density = density;
        }

        @Override
        public void onLayoutChange(View view, int left, int top, int right, int bottom,
                                   int oldLeft, int oldTop, int oldRight, int oldBottom) {
            apply(view);
        }

        void apply(View view) {
            final List<Rect> rects = buildEdgeRects(view.getWidth(), view.getHeight(), density);
            if (rects.equals(applied)) return;
            ViewCompat.setSystemGestureExclusionRects(view, rects);
            applied = rects;
        }
    }

    /**
     * Builds one rect per vertical edge, in the view's local pixel space.
     *
     * @param width   View width in px.
     * @param height  View height in px.
     * @param density Display density (px per dp).
     * @return Left and right edge rects, or an empty list for a degenerate view.
     */
    private static List<Rect> buildEdgeRects(int width, int height, float density) {
        if (width <= 0 || height <= 0) return Collections.emptyList();

        final int stripWidth = Math.min(width, Math.round(EDGE_STRIP_WIDTH_DP * density));
        final int bandHeight = Math.min(height, Math.round(MAX_EXCLUDED_HEIGHT_DP * density));
        final int bandTop = (height - bandHeight) / 2;
        final int bandBottom = bandTop + bandHeight;

        final List<Rect> rects = new ArrayList<>(2);
        rects.add(new Rect(0, bandTop, stripWidth, bandBottom));
        rects.add(new Rect(width - stripWidth, bandTop, width, bandBottom));
        return rects;
    }
}
