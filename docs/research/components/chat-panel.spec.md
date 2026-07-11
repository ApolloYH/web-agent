# ChatPanel Specification

## Overview
- Target: `src/components/ChatPanel.tsx`
- Interaction: streamed transcript and keyboard composer

## Styles
- Transcript max-width: 768px; centered; assistant copy 16px/28px.
- Assistant has no container background or border.
- User bubble: `#f4f4f4`, maximum 80%, 18px radius, 10px 16px padding.
- Empty greeting: 28px/34px semibold, vertically centered above composer.
- Composer: white, 1px `#e5e5e5`, 28px radius, soft `0 2px 14px rgba(0,0,0,.08)` shadow, 14px padding.
- Send/stop: 32px filled circle, near-black idle, disabled neutral gray.

## Behaviors
- Auto-scroll on streamed updates; `aria-live=polite` on transcript.
- Textarea auto-resizes to 200px.
- Suggested prompt chips appear only in empty state and submit immediately.
- Process timeline remains inside assistant flow; artifact chips use neutral file cards.

## Responsive
- Desktop composer max-width 768px with 24px bottom inset.
- Mobile transcript 16px padding and composer 10px inset.
