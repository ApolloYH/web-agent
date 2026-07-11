---
name: query-engineering-standards
description: Query the 智监 AI 工标库 for South China Grid enterprise standards, electric-power industry standards, archive-management standards, clauses, procedures, acceptance criteria, and engineering supervision questions. Use for knowledge Q&A, standard lookup, clause verification, or questions containing 工标、标准、规范、条款、南网企标、电力行标、档案管理.
---

# 工标库问答

1. Extract the user's exact engineering-standard question. Do not route it to the risk-control-card evidence library.
2. Run:

```bash
python3 /Users/apollo/Desktop/risk-control-card-skill/scripts/query_langcore.py --query "<question>" --output .apollo/tmp/kb-evidence.json
```

The script queries only the 工标库 `cmp11l7q50000phd7pxo9cefe` in `fast` mode. It requires `LANGCORE_API_KEY`.
3. Read `.apollo/tmp/kb-evidence.json`. Answer only from returned evidence. Cite source filenames and relevant excerpts; state clearly when evidence is insufficient.
4. Never invent standard numbers, clauses, effective dates, or mandatory requirements.
