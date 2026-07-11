# Artifact and Settings Specification

## Overview
- Targets: `ArtifactPanel.tsx`, `SettingsBar.tsx`, `RuntimeStatusBar.tsx`
- Interaction: tabs, close action, settings popover, status disclosure

## Artifact canvas
- White surface, 48–56px header, file title and type, close and download icon buttons.
- Horizontal tabs use bottom border active state; no raised pills or emoji icons.
- Preview body fills remaining height; document surfaces keep their native backgrounds.
- Empty artifact panel is not rendered in the app shell.

## Header/settings
- Product label `Apollo` with small model/backend label.
- Settings is an icon button opening a max 384px popover with 16px radius and soft shadow.
- Backend segmented control remains, restyled to neutral ChatGPT-like tokens.
- Runtime status becomes a compact button/popover, never a full-width stripe.

## Accessibility
- Every icon button has an aria-label and visible focus ring.
- Popovers use semantic `details/summary` where practical.
- Mobile popovers stay within 12px viewport gutters.
