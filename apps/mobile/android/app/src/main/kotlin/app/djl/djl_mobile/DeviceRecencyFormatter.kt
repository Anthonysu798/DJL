package app.djl.mobile

import android.icu.text.DisplayContext
import android.icu.text.MeasureFormat
import android.icu.text.RelativeDateTimeFormatter
import android.icu.text.RelativeDateTimeFormatter.RelativeUnit
import android.icu.util.Calendar
import android.icu.util.ULocale
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import java.util.Date
import kotlin.math.abs

object DeviceRecencyFormatter {
    fun format(date: Long, reference: Long, elapsed: Boolean = false): String {
        if (elapsed) return formatElapsed(date, reference)
        val formatter = RelativeDateTimeFormatter.getInstance(
            ULocale.getDefault(), null, RelativeDateTimeFormatter.Style.SHORT,
            DisplayContext.CAPITALIZATION_NONE,
        )
        val calendar = Calendar.getInstance()
        val direction = if (date >= reference) RelativeDateTimeFormatter.Direction.NEXT
            else RelativeDateTimeFormatter.Direction.LAST
        val units = arrayOf(
            Calendar.YEAR to RelativeUnit.YEARS,
            Calendar.MONTH to RelativeUnit.MONTHS,
            Calendar.WEEK_OF_YEAR to RelativeUnit.WEEKS,
            Calendar.DAY_OF_MONTH to RelativeUnit.DAYS,
            Calendar.HOUR_OF_DAY to RelativeUnit.HOURS,
            Calendar.MINUTE to RelativeUnit.MINUTES,
            Calendar.SECOND to RelativeUnit.SECONDS,
        )
        return units.firstNotNullOf { (field, unit) ->
            calendar.timeInMillis = reference
            val quantity = calendar.fieldDifference(Date(date), field)
            if (quantity != 0 || field == Calendar.SECOND) {
                formatter.format(abs(quantity.toDouble()), direction, unit)
            } else null
        }
    }

    private fun formatElapsed(date: Long, reference: Long): String {
        val seconds = abs(reference - date) / 1000
        val measures = when {
            seconds < 60 -> listOf(Measure(seconds, MeasureUnit.SECOND))
            seconds < 3600 -> listOf(Measure(seconds / 60, MeasureUnit.MINUTE), Measure(seconds % 60, MeasureUnit.SECOND))
            seconds < 86400 -> listOf(Measure(seconds / 3600, MeasureUnit.HOUR), Measure((seconds % 3600) / 60, MeasureUnit.MINUTE))
            else -> {
                val calendar = Calendar.getInstance().apply { timeInMillis = reference }
                val result = mutableListOf<Measure>()
                for ((field, unit) in arrayOf(Calendar.YEAR to MeasureUnit.YEAR,
                    Calendar.MONTH to MeasureUnit.MONTH, Calendar.WEEK_OF_YEAR to MeasureUnit.WEEK,
                    Calendar.DAY_OF_MONTH to MeasureUnit.DAY)) {
                    val quantity = calendar.fieldDifference(Date(date), field)
                    if (quantity != 0) result.add(Measure(abs(quantity), unit))
                    if (result.size == 2) break
                }
                result.ifEmpty { listOf(Measure(seconds / 86400, MeasureUnit.DAY)) }
            }
        }
        return MeasureFormat.getInstance(ULocale.getDefault(), MeasureFormat.FormatWidth.SHORT)
            .formatMeasures(*measures.toTypedArray())
    }
}
