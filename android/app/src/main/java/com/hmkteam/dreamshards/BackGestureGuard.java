package com.hmkteam.dreamshards;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Keeps the system back navigation from backgrounding the game.
 *
 * <p>The activity is the only screen in the app: there is no native back stack
 * to pop, so the default handling of Back (hardware / on-screen button and the
 * Android 10+ edge-swipe gesture) finishes the activity and the game disappears
 * — which happens by accident whenever the player swipes inward from a screen
 * edge while panning the world. Registering an always-enabled callback on the activity's
 * {@link androidx.activity.OnBackPressedDispatcher} consumes the event instead;
 * with {@code enableOnBackInvokedCallback=true} in the manifest the dispatcher
 * also intercepts the predictive-back gesture, so no exit animation is played.
 *
 * <p>Quitting the app stays an explicit action: the menu's exit button goes
 * through {@code AndroidBridge.exitApp()} in {@link MainActivity}.
 */
final class BackGestureGuard {

    private BackGestureGuard() {}

    /**
     * Installs the guard for the lifetime of the given activity. Must be called
     * after {@code super.onCreate}: callbacks are consulted in reverse order of
     * registration, so a later registration wins over anything the Capacitor
     * bridge or a plugin may add.
     *
     * @param activity Host activity whose back navigation should be swallowed.
     */
    static void install(final AppCompatActivity activity) {
        activity.getOnBackPressedDispatcher().addCallback(activity, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Intentionally empty — handling the event without doing
                // anything is what stops Android from finishing the activity.
            }
        });
    }
}
