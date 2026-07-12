---
name: run-zhijian-task
description: 执行专业业务任务并调用 LangHub 生成成果。用户要求生成管控一张卡、监理通知单、监理日志、监理文书，识别现场隐患，审查施工方案，或对比改造前后单线图时使用；负责结合完整对话和上传附件整理严格输入、检查关键缺项、选择业务类型、调用 run_langhub_task 并保存返回文件。
---

# 智监业务执行

先阅读 [输入要求](references/input-requirements.md)，再执行：

1. 结合当前对话全部历史识别任务，不要只看最后一句。
2. 从消息里的“已上传文件”路径选择本任务需要的附件。
3. 检查会实质影响成果的必填附件。以下三个任务满足对应单附件后立即执行，不得追问其他信息：
   - `risk_card`：一张现场图片。
   - `hazard_analysis`：一张现场图片。
   - `plan_review`：一个需要审查的施工方案文件。
   其他任务缺少关键输入时，只追问最关键的一组。
4. 把用户原始事实整理成明确 prompt；不得补造项目名称、编号、单位、日期、条款、风险等级或检查结果。用户未提供的可选字段直接省略，禁止在 prompt 中写"用户未提供"等占位文字。
5. 调用 `run_langhub_task`，传入正确的 `task`、完整 `prompt` 和相关 `files`。
6. 将工具返回的正文和已保存文件告诉用户。若没有新文件，明确说明。

任务映射：

- 管控一张卡：`risk_card`
- 监理通知单：`supervision_notice`
- 监理日志：`supervision_log`
- 监理规划、细则、总结等文书：`supervision_document`
- 现场图片隐患识别：`hazard_analysis`
- 施工方案审查：`plan_review`
- 改造前后单线图对比：`drawing_compare`
