# Apollo Chat Workspace — Behaviors

- Desktop sidebar is visible at >=1024px and collapsible. Tablet/mobile uses a modal drawer with backdrop.
- New task clears the visible transcript and Apollo context after confirmation-free click because it is a reversible local action.
- Assistant messages are unboxed on white; user messages use a soft neutral bubble aligned right.
- Empty state centers an Apollo greeting and suggested prompts above the composer.
- Composer grows up to 200px, Enter submits, Shift+Enter inserts a newline, stop replaces send while streaming.
- Artifact canvas opens from message chips, appears only when needed, and closes without deleting artifacts.
- Runtime status opens on click and exposes model/token/cache/session details.
- All controls use inline SVG icons, 150–200ms color transitions, visible focus rings, and no layout-shifting hover transforms.
- `prefers-reduced-motion` disables smooth scroll and decorative transitions.
- Responsive checks: 1440px split canvas, 768px sidebar drawer + artifact overlay, 390px single-column chat + full-screen artifact.
