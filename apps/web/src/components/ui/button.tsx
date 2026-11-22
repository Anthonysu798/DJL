"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/lib/utils";
import { extendButtonIconChildSelectors } from "~/lib/central-icons";

// Variant taxonomy (visual treatment) × size axis × content (icon / text / icon+text).
//
//   filled      → default (primary) | destructive | prominent
//   glass       → outline | secondary | subtle | primary-outline | secondary-outline | destructive-outline | chrome-outline
//   ghostly     → ghost | chrome | link
//
// Sizes pair text variants (chip/xs/sm/default/lg/xl) with their square
// icon-only counterparts (icon-chip/icon-xs/icon-sm/icon/icon-lg/icon-xl) at
// matching heights, so a text button and an icon-only button sit on the same
// baseline in a toolbar row. `chip`/`icon-chip` are for inline action pills
// inside queued-message rows, badges, etc.
//
// Glass variants share `.glass-control` (index.css): a tinted translucent fill,
// hairline border and top highlight, with hover and pressed fills, and never a
// backdrop filter. Filled variants keep their solid color plus the same quiet top
// highlight and a pressed state. Ghostly variants stay flat. No drop shadows and
// no pseudo-element edge glints; if you need more depth, add a single new variant
// rather than reintroducing shadows piecewise.
//
// Adding a new variant? Mirror an existing one's border/focus treatment so the
// family stays visually coherent. Prefer adding a variant over passing a
// className override at the call site.
const buttonVariants = cva(
  extendButtonIconChildSelectors(
    "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-[length:var(--app-font-size-ui,12px)] outline-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 sm:text-[length:var(--app-font-size-ui,12px)] [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ),
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        chip: extendButtonIconChildSelectors(
          "h-auto gap-1 px-2 py-0.5 text-[length:var(--app-font-size-ui-sm,11px)] sm:h-auto sm:text-[length:var(--app-font-size-ui-sm,11px)] [&_svg:not([class*='size-'])]:size-3 sm:[&_svg:not([class*='size-'])]:size-3",
        ),
        default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
        icon: "size-9 sm:size-8",
        "icon-chip": extendButtonIconChildSelectors(
          "size-6 sm:size-6 [&_svg:not([class*='size-'])]:size-3 sm:[&_svg:not([class*='size-'])]:size-3",
        ),
        "icon-lg": "size-10 sm:size-9",
        "icon-sm": "size-8 sm:size-7",
        "icon-xl": extendButtonIconChildSelectors(
          "size-11 sm:size-10 [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        ),
        "icon-xs": extendButtonIconChildSelectors(
          "size-7 rounded-sm sm:size-6 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-4 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        ),
        lg: "h-10 px-[calc(--spacing(3.5)-1px)] sm:h-9",
        sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
        xl: extendButtonIconChildSelectors(
          "h-11 px-[calc(--spacing(4)-1px)] text-[length:var(--app-font-size-ui-lg,13px)] sm:h-10 sm:text-[length:var(--app-font-size-ui-lg,13px)] [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        ),
        xs: extendButtonIconChildSelectors(
          "h-7 gap-1 rounded-sm px-[calc(--spacing(2)-1px)] text-[length:var(--app-font-size-ui-sm,11px)] sm:h-6 sm:text-[length:var(--app-font-size-ui-xs,10px)] [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
        ),
      },
      variant: {
        chrome:
          "border-transparent bg-transparent text-[var(--color-text-foreground-secondary)] focus-visible:ring-[color:var(--color-border-focus)]/60 focus-visible:ring-offset-0 [:hover,[data-pressed]]:bg-[var(--color-background-elevated-secondary)] [:hover,[data-pressed]]:text-[var(--color-text-foreground)] data-pressed:bg-[var(--color-background-elevated-secondary)] data-pressed:text-[var(--color-text-foreground)]",
        "chrome-outline": extendButtonIconChildSelectors(
          "glass-control text-[var(--color-text-foreground)] focus-visible:ring-[color:var(--color-border-focus)]/60 [&_svg]:mx-0",
        ),
        default:
          "border-transparent bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] [:hover,[data-pressed]]:bg-primary/90 active:bg-primary/80",
        destructive:
          "border-destructive bg-destructive text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] [:hover,[data-pressed]]:bg-destructive/90 active:bg-destructive/80",
        "destructive-outline":
          "glass-control text-destructive [:hover,[data-pressed]]:border-destructive/32 [:hover,[data-pressed]]:text-destructive",
        ghost:
          "border-transparent bg-transparent text-[var(--color-text-foreground-secondary)] focus-visible:ring-[color:var(--color-border-focus)]/60 focus-visible:ring-offset-0 [:hover,[data-pressed]]:bg-[var(--color-background-button-secondary-hover)] [:hover,[data-pressed]]:text-[var(--color-text-foreground)] data-pressed:bg-[var(--color-background-button-secondary)] data-pressed:text-[var(--color-text-foreground)]",
        link: "border-transparent underline-offset-4 [:hover,[data-pressed]]:underline",
        outline:
          "glass-control text-[var(--color-text-foreground)] focus-visible:ring-[color:var(--color-border-focus)]/60",
        "primary-outline": "glass-control text-primary [:hover,[data-pressed]]:border-primary/32",
        prominent:
          "rounded-full border-transparent bg-[var(--color-text-foreground)] text-[var(--color-background-surface)] transition-[transform,opacity] duration-150 hover:scale-105 disabled:opacity-20 disabled:hover:scale-100",
        secondary: "glass-control text-[var(--color-text-foreground)]",
        "secondary-outline": "glass-control text-[var(--color-text-foreground)]",
        subtle:
          "glass-control text-[var(--color-text-foreground)] focus-visible:ring-[color:var(--color-border-focus)]/60 focus-visible:ring-offset-0",
      },
    },
    compoundVariants: [
      {
        class:
          "!box-border !h-auto !min-h-7 gap-1.5 rounded-lg px-[calc(--spacing(2.5)-1px)] !py-0.5 text-[length:var(--app-font-size-ui,12px)] sm:!h-auto sm:px-[calc(--spacing(2.5)-1px)] sm:text-[length:var(--app-font-size-ui-sm,11px)]",
        size: "xs",
        variant: "chrome-outline",
      },
      {
        class: "!size-8 rounded-lg sm:!size-7",
        size: "icon-xs",
        variant: "chrome-outline",
      },
    ],
  },
);

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, render, ...props },
  ref,
) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    ref,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
});

/** Dialog footers and inline error actions share this sizing override. */
const dialogActionButtonClassName =
  "!h-auto !min-h-8 !rounded-md !px-3 !py-1 !font-normal sm:!min-h-7";

export { Button, buttonVariants, dialogActionButtonClassName };
