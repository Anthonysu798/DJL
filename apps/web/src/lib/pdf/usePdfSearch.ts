import { useCallback, useEffect, useState } from "react";

import type { PDFDocumentProxy } from "./pdfEngine";

function countOccurrences(text: string, query: string): number {
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const match = text.indexOf(query, offset);
    if (match < 0) break;
    count += 1;
    offset = match + Math.max(query.length, 1);
  }
  return count;
}

export function usePdfSearch(input: {
  document: PDFDocumentProxy | null;
  numPages: number;
  onJumpToPage: (pageNumber: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ReadonlyArray<number>>([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const document = input.document;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    let cancelled = false;
    if (!document || normalizedQuery.length === 0) {
      setMatches([]);
      setMatchIndex(-1);
      setIsSearching(false);
      return () => {
        cancelled = true;
      };
    }

    setIsSearching(true);
    void (async () => {
      const nextMatches: number[] = [];
      for (let pageNumber = 1; pageNumber <= input.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
          .join(" ")
          .toLocaleLowerCase();
        const count = countOccurrences(text, normalizedQuery);
        for (let index = 0; index < count; index += 1) nextMatches.push(pageNumber);
      }
      if (cancelled) return;
      setMatches(nextMatches);
      setMatchIndex(nextMatches.length > 0 ? 0 : -1);
      if (nextMatches[0]) input.onJumpToPage(nextMatches[0]);
    })()
      .catch(() => {
        if (!cancelled) {
          setMatches([]);
          setMatchIndex(-1);
        }
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [input.document, input.numPages, input.onJumpToPage, query]);

  const move = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      const nextIndex =
        matchIndex < 0 ? 0 : (matchIndex + direction + matches.length) % matches.length;
      setMatchIndex(nextIndex);
      const pageNumber = matches[nextIndex];
      if (pageNumber) input.onJumpToPage(pageNumber);
    },
    [input, matchIndex, matches],
  );

  return {
    query,
    setQuery,
    matchIndex,
    matchCount: matches.length,
    isSearching,
    nextMatch: () => move(1),
    previousMatch: () => move(-1),
  };
}
