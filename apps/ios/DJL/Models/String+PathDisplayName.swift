// FILE: String+PathDisplayName.swift
// Purpose: Centralizes the "show the basename, fall back to the full path when
//          empty" idiom used across the chat UI so every surface displays the
//          same folder/file name from a filesystem path string.
// Layer: Foundation Extension
// Exports: String.pathDisplayName
// Depends on: Foundation

import Foundation

extension String {
    /// Returns the user-facing leaf of this filesystem path.
    ///
    /// Falls back to the original string when `lastPathComponent` would be
    /// empty (e.g. for `"/"` or a trailing slash) so callers never have to
    /// guard against an empty display string after splitting a path.
    var pathDisplayName: String {
        let basename = (self as NSString).lastPathComponent
        return basename.isEmpty ? self : basename
    }
}
