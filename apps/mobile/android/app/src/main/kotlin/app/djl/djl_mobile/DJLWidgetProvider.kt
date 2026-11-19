package app.djl.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class DJLWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val launch = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE)
        for (id in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.djl_launch_widget)
            views.setOnClickPendingIntent(R.id.djl_widget_launch, launch)
            manager.updateAppWidget(id, views)
        }
    }
}
