# DJL Flutter design

DJL on the phone is a companion to a paired desktop and to DJL Cloud, used by people who are not
developers. See `PRODUCT.md` for who it is for and why. This file is how it looks.

## Colour

Black, white and neutral grays, in light and dark, following the system setting. The only other
colour on screen is an agent's own brand mark (`AgentAvatar`). One red, `danger`, marks destructive
actions and failures; nothing else is coloured, including links, selection and switches.

All colours come from `DjlColors` in `lib/core/design/djl_tokens.dart`:

| Token | Use |
| --- | --- |
| `ink` / `onInk` | Primary text, filled buttons, the person's own chat bubble, and what sits on them |
| `inkMuted` | Secondary text. Passes AA on `surface` and `surfaceRaised` |
| `inkFaint` | Placeholder glyphs and disabled controls. Not body text |
| `surface` | The page |
| `surfaceRaised` | Agent bubbles, grouped rows, inputs, quiet buttons |
| `surfaceSunken` | Pressed and selected fills |
| `hairline` | Dividers and avatar rings |
| `danger` | Destructive actions and failed states |

`lib/app/djl_theme.dart` maps every Material colour role onto these tokens, so a widget that reads
`Theme.of(context).colorScheme` is already on the palette. Do not write `Color(0x…)`, `Colors.blue`
or `CupertinoColors.*` in feature code.

Surfaces are separated by fill, not by shadow: a shadow under a page-coloured pill disappears in
dark mode.

## Shape, space, motion

- Radii: `DjlRadius.sm` 10 (chips, thumbnails), `md` 16 (rows, inputs), `lg` 24 (sheets, bubbles,
  floating glass), `pill` (buttons).
- Spacing: the 4-point `DjlSpace` scale. Page gutter is `DjlSpace.page`.
- Motion: 150 to 250 ms with `DjlMotion.curve`, for state changes only. Use `DjlMotion.of(context)`
  so Reduce Motion turns it off.

## Type

One family: the system face on iOS, bundled Geist on Android (the Font setting can override it).
Sizes come from the theme's text styles; hierarchy is weight and size, not colour. Cupertino
widgets fall back to Roboto on Android unless told the family, so `djlTheme` passes it to the
Cupertino text theme and `settingsTextStyle` names it explicitly.

## Icons

One family, Phosphor, reached only through `DjlIcons` in `lib/core/design/djl_icons.dart`. Screens
name what an icon means (`DjlIcons.send`); the glyph set is chosen in that one file. Do not use
`Icons.*` or `CupertinoIcons.*` in feature code.

## Glass

Two widgets own glass, and both become a solid raised surface when the Liquid Glass setting is off:

- `DjlGlassSurface`: native Liquid Glass on iOS 26, `DjlFrosted` everywhere else.
- `DjlFrosted` (`lib/core/presentation/djl_frosted.dart`): a blur of what is behind, a translucent
  fill that is brighter at the top, and a fine edge. Pass `blur: false` for controls on a still
  background, where a blur shows nothing and costs a pass every frame.

Every menu and picker opens through `showDjlGlassMenu`, `showDjlGlassEntries` or
`DjlGlassMenuButton` (`djl_glass_menu.dart`): a frosted panel that grows from its button over a
softly blurred page. Do not use `PopupMenuButton` or `showMenu` directly.

Buttons that float are `DjlGlassIconButton` (round), `DjlGlassBackButton` (top left of a page that
has no bar) and `DjlGlassPillButton` (text; `prominent` fills it with ink for the one main action).
Pages scroll edge to edge under the status bar with a fade, not a solid bar.

## What the phone shows

The phone shows what an agent says, not how it got there. Reasoning, commands, file edits and tool
steps stay on the desktop; while an agent works the phone shows one quiet status. Prompts that need
an answer (approvals, questions, reviews) are always shown.

In a group chat, each agent has its avatar and name above a `surfaceRaised` bubble, and a reply is
drawn as it is written. Live text and the finished reply use the same widget, so nothing reflows
when a reply settles.

## Pairing

Pairing should be legible at a glance, with one primary action and direct instructions that point
to the desktop's Remote settings. It uses one labeled field for typing, pasting or autofill. Keep
error guidance and dismiss actions in the scrollable dialog at narrow widths or with large text,
respect reduced motion, and preserve the code draft when opening relay settings. A build without a
compiled relay address uses DJL Cloud's relay, so nobody is asked for one.
