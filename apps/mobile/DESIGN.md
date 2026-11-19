# DJL Flutter design

DJL is a phone companion for a paired desktop. Its visual reference is the
Swift DJL app. Pairing should be legible at a glance, with one primary action
and direct instructions that point to the desktop's Remote settings.

## Palette and components

- Use grayscale for the application chrome. Light uses white surfaces, black
  primary actions, and neutral gray supporting text. Dark reverses this
  hierarchy. Semantic errors and explicitly selected message colors keep
  their own colors.
- The canonical palette and typography live in `lib/app/djl_theme.dart`.
  Inset settings cards and menus use these semantic roles through
  `lib/features/settings/presentation/settings_group.dart`.
- `DjlGlassSurface` owns the glass effect. Use it for floating controls and
  modal surfaces. The pairing dialog uses the Flutter compositor and a
  translucent surface to maintain text contrast. The Liquid Glass setting
  selects the material, with a solid pairing surface when disabled.
- Pairing uses one labeled field for typing, pasting, or autofill. The keyboard
  opens when the field is focused. Keep error guidance and dismiss actions
  in the scrollable dialog at narrow widths or with large text. Respect
  reduced motion and preserve the code draft when opening relay settings.
