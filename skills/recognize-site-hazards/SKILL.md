---
name: recognize-site-hazards
description: Recognize and document safety hazards from main-grid or distribution-grid construction-site photos and descriptions. Use when users ask to identify 现场隐患、违章、风险点、整改建议 or upload site images for safety inspection.
---

# 隐患识别

Confirm grid type (主网/配网), at least one site image, and optional site description. Return candidate hazards with problem description, basis, corrective action, and confidence. Require the user to confirm candidates before generating a formal document. Never fabricate violation codes or clauses. Save confirmed results under `artifacts/` as Markdown and JSON; generate Word only when requested.

