import { useEffect, useState } from 'react';
import type { CraftDef } from '../../sim/vessel/types';
import { PART_CATALOG } from '../../data/parts';
import { renderCraftThumbnail } from '../scene/thumbnails';
export function CraftThumbnail({ craft }: { craft: CraftDef }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const frame = requestAnimationFrame(() => { try { setUrl(renderCraftThumbnail(craft, PART_CATALOG)); } catch { setUrl(''); } });
    return () => cancelAnimationFrame(frame);
  }, [craft]);
  return url ? <img src={url} alt={`${craft.name} preview`} width={100} height={100} style={{ objectFit: 'contain' }} /> : <div style={{ width: 100, minHeight: 60 }}>Vehicle preview</div>;
}
