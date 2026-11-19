package app.djl.mobile

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class DJLLaunchTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            label = getString(R.string.djl_launch_name)
            contentDescription = getString(R.string.djl_launch_accessibility)
            icon = Icon.createWithResource(this@DJLLaunchTileService, R.drawable.djl_launch_logo)
            state = Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        if (isLocked) unlockAndRun { launchApp() } else launchApp()
    }

    @Suppress("DEPRECATION")
    private fun launchApp() {
        val intent = Intent(this, MainActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val launch = PendingIntent.getActivity(this, 1, intent, PendingIntent.FLAG_IMMUTABLE)
            startActivityAndCollapse(launch)
        } else {
            startActivityAndCollapse(intent)
        }
    }
}
