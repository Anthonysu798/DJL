package app.djl.mobile

import android.icu.lang.UCharacter
import android.icu.text.Collator
import android.icu.text.Normalizer2
import android.icu.text.RuleBasedCollator
import android.icu.text.SearchIterator
import android.icu.text.StringSearch
import java.text.StringCharacterIterator
import java.util.Locale

object DeviceTextSearch {
    fun matches(titles: List<String>, query: String, locale: Locale): List<Int> {
        if (query.isEmpty()) return titles.indices.toList()
        val base = Collator.getInstance(locale) as RuleBasedCollator
        // Foundation's case-insensitive search equates sharp-S with two S's.
        val collator = RuleBasedCollator(base.rules + "& ss = ß & SS = ẞ")
        collator.strength = Collator.SECONDARY
        collator.decomposition = Collator.CANONICAL_DECOMPOSITION
        val normalizer = Normalizer2.getNFDInstance()
        val defaultMapping = locale.language !in listOf("tr", "az")
        fun folded(value: String) = normalizer.normalize(UCharacter.foldCase(value, defaultMapping))
        val needle = folded(query)
        return titles.indices.filter { index ->
            val title = titles[index]
            var literal = title.indexOf(query)
            var found = false
            while (literal >= 0 && !found) {
                found = endBoundary(title, literal + query.length)
                if (!found) literal = title.indexOf(query, literal + 1)
            }
            if (found || title.isEmpty()) found else {
                val search = StringSearch(query, StringCharacterIterator(title), collator)
                search.setCanonical(true)
                var position = search.first()
                while (position != SearchIterator.DONE && !found) {
                    val end = position + search.matchLength
                    found = endBoundary(title, end) && folded(title.substring(position, end)) == needle
                    if (!found) position = search.next()
                }
                found
            }
        }
    }

    private fun endBoundary(value: String, end: Int): Boolean {
        if (end == value.length) return true
        val next = value.codePointAt(end)
        return next !in 0x1F3FB..0x1F3FF && Character.getType(next) !in listOf(
            Character.NON_SPACING_MARK.toInt(),
            Character.COMBINING_SPACING_MARK.toInt(),
            Character.ENCLOSING_MARK.toInt(),
        )
    }
}
