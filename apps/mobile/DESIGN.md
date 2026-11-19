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
Sizes come from the theme's text styles; hierarchy is weight and size, not colour.

## Icons

One family, Phosphor, reached only through `DjlIcons` in `lib/core/design/djl_icons.dart`. Screens
name what an icon means (`DjlIcons.send`); the glyph set is chosen in that one file. Do not use
`Icons.*` or `CupertinoIcons.*` in feature code.

## Glass

`DjlGlassSurface` owns the glass effect: native Liquid Glass on iOS 26, a blur elsewhere, and a
solid surface when the Liquid Glass setting is off. Use it only for things that float over
scrolling content: a chat header, a composer, menus, sheets. Content itself is flat.

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
