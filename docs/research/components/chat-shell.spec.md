# ChatShell Specification

## Overview
- Target: `src/App.tsx` plus `src/components/AppSidebar.tsx`
- Interaction: click-driven responsive shell

## Structure
- Root fills viewport with neutral sidebar and white workspace.
- Desktop sidebar: 260px, `#f9f9f9`, 12px padding, no heavy border.
- Main header: 56px, sticky top, white/90 backdrop, compact model/backend controls.
- Conversation occupies remaining width when artifact canvas is closed.
- Artifact canvas: min 440px, approximately 46vw, subtle left border.

## States
- Sidebar expanded/collapsed on desktop; overlay drawer under 1024px.
- Artifact hidden until selected; close restores full-width conversation.
- Header shows menu button whenever sidebar is unavailable.

## Responsive
- 1440px: 260px rail + flexible chat + optional artifact canvas.
- 768px: chat full width; sidebar and artifact are overlays.
- 390px: 48px header, 12px horizontal padding, full-screen artifact.
