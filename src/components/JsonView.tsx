import { useMemo, useState } from 'react';

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function JsonNode({ value, name, depth }: { value: JsonValue; name?: string; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object';

  if (!isObject) {
    let cls = 'text-gray-800';
    if (typeof value === 'string') cls = 'text-green-700';
    else if (typeof value === 'number') cls = 'text-blue-700';
    else if (typeof value === 'boolean') cls = 'text-purple-700';
    else if (value === null) cls = 'text-gray-400';
    return (
      <div className="leading-6" style={{ paddingLeft: depth * 16 }}>
        {name !== undefined && <span className="text-rose-700">{name}: </span>}
        <span className={cls}>{typeof value === 'string' ? `"${value}"` : String(value)}</span>
      </div>
    );
  }

  const entries = isArray
    ? (value as JsonValue[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, JsonValue>);

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <div className="leading-6 cursor-pointer select-none" onClick={() => setOpen(!open)}>
        <span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>
        {name !== undefined && <span className="text-rose-700">{name}: </span>}
        <span className="text-gray-500">
          {isArray ? `Array(${entries.length})` : `Object{${entries.length}}`}
        </span>
      </div>
      {open &&
        entries.map(([k, v]) => (
          <JsonNode key={k} name={isArray ? undefined : k} value={v} depth={depth + 1} />
        ))}
    </div>
  );
}

export default function JsonView({ content }: { content: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(content) as JsonValue };
    } catch (e) {
      return { ok: false as const, error: String(e) };
    }
  }, [content]);

  return (
    <div className="h-full overflow-auto bg-white p-5 font-mono text-[12px] leading-5">
      {parsed.ok ? (
        <JsonNode value={parsed.value} depth={0} />
      ) : (
        <div className="text-red-600">JSON 解析失败：{parsed.error}</div>
      )}
    </div>
  );
}
