import type { JsonObject, ToolDefinition } from '@apolloyh/apollo-agent';

type RequestEditor = (action: string, input: JsonObject) => Promise<JsonObject>;

export function createDocumentTools(requestEditor: RequestEditor): ToolDefinition[] {
  return [
    {
      name: 'local_folder_list_files',
      description: '列出用户当前在 Web 顶部选中的本地文件夹内容。用户询问“我的文件夹”“本地目录”或当前本地工作区时使用；不要用服务器文件工具代替。',
      risk: 'low',
      input_schema: { type: 'object', properties: {} },
      execute: async () => result(await requestEditor('list_local_files', {})),
    },
    {
      name: 'document_get_context',
      description: '读取用户当前在 Web 工作台中打开的 Word、Markdown、JSON、PDF 文本或图片基础信息。长文档只返回前段内容；编辑前先调用。',
      risk: 'low',
      input_schema: { type: 'object', properties: {} },
      execute: async () => result(await requestEditor('get_context', {})),
    },
    {
      name: 'document_search_text',
      description: '在当前打开的 Word、Markdown、JSON 或 PDF 全文中搜索文字并返回命中上下文。长文档定位内容时优先使用。',
      risk: 'low',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要搜索的文字' },
          max_results: { type: 'number', description: '最多返回的命中数，默认 10，最大 20' },
        },
        required: ['query'],
      },
      execute: async (input) => result(await requestEditor('search_text', input)),
    },
    {
      name: 'document_replace_text',
      description: '在当前打开的文档中实时查找并替换文字，并立即写回原文件。适用于 Word、Markdown 和 JSON。',
      risk: 'medium',
      input_schema: {
        type: 'object',
        properties: {
          find: { type: 'string', description: '要查找的原文，必须与当前内容完全一致' },
          replacement: { type: 'string', description: '替换后的文字' },
          replace_all: { type: 'boolean', description: '是否替换所有匹配，默认 true' },
        },
        required: ['find', 'replacement'],
      },
      execute: async (input) => result(await requestEditor('replace_text', input)),
    },
    {
      name: 'document_append_text',
      description: '把内容追加到当前打开文档末尾，并立即写回原文件。',
      risk: 'medium',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string', description: '要追加的完整内容' } },
        required: ['text'],
      },
      execute: async (input) => result(await requestEditor('append_text', input)),
    },
    {
      name: 'document_set_content',
      description: '用完整新内容覆盖当前 Markdown 或 JSON 文档。不能用于 Word。',
      risk: 'high',
      input_schema: {
        type: 'object',
        properties: { content: { type: 'string', description: '完整的新文档内容' } },
        required: ['content'],
      },
      execute: async (input) => result(await requestEditor('set_content', input)),
    },
  ];
}

function result(value: JsonObject) {
  return { content: JSON.stringify(value, null, 2), isError: value.ok === false };
}
