package com.batuhan.weavergame;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		enableImmersiveMode();
	}

	@Override
	public void onResume() {
		super.onResume();
		enableImmersiveMode();
	}

	@Override
	public void onWindowFocusChanged(boolean hasFocus) {
		super.onWindowFocusChanged(hasFocus);
		if (hasFocus) enableImmersiveMode();
	}

	private void enableImmersiveMode() {
		Window window = getWindow();
		if (window == null) return;

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
			WindowInsetsController controller = window.getInsetsController();
			if (controller == null) return;
			controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
			controller.setSystemBarsBehavior(
				WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
			);
		} else {
			View decor = window.getDecorView();
			int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
				| View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
				| View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
				| View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
				| View.SYSTEM_UI_FLAG_FULLSCREEN
				| View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
			decor.setSystemUiVisibility(flags);
		}
	}
}
