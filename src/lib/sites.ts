export interface PublishedSite {
  slug: string;
  name: string;
  url: string;
  sourceDir: string;
  conversationId?: string;
  publishedAt: string;
  fileCount: number;
  size: number;
}

export async function getPublishedSites(): Promise<{ available: boolean; sites: PublishedSite[] }> {
  const response = await fetch('/apollo-api/sites');
  if (!response.ok) throw new Error(`读取站点失败 ${response.status}`);
  return response.json();
}

export async function republishSite(site: PublishedSite): Promise<PublishedSite> {
  const response = await fetch('/apollo-api/sites/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceDir: site.sourceDir, name: site.name, slug: site.slug }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `部署失败 ${response.status}`);
  return payload.site;
}

export interface SiteElementSelection {
  elementId: string;
  selector: string;
  label: string;
  text: string;
  htmlHint: string;
  position: { x: number; y: number; width: number; height: number };
  style: Record<string, string>;
}
