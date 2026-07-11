# Apollo Chat Workspace — Page Topology

Target reference: ChatGPT authenticated application shell. This is a selective product adaptation, not a brand clone.

1. **Navigation sidebar** — fixed 260px desktop rail; new-task action, current task, useful Apollo modes, artifact count, settings entry. Overlay drawer below 768px.
2. **Conversation workspace** — white main canvas with a 56px sticky header, centered 768px message column, and bottom composer.
3. **Artifact canvas** — hidden until an artifact is opened; 46% desktop split panel with its own header/tabs, full-screen overlay on mobile.
4. **Runtime details** — compact status disclosure in the header instead of a permanent metrics stripe.

Interaction model: click-driven sidebar/settings/artifact canvas; streamed message updates; composer stays anchored while the transcript scrolls.

Not copied: OpenAI branding, account/auth UI, GPT store, voice/video, sharing, temporary chats, model marketplace, billing, and proprietary assets.
