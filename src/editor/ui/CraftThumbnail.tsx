import { useEffect, useState } from 'react';
import type { CraftDef } from '../../sim/vessel/types';
import { PART_CATALOG } from '../../data/parts';
import { requestCraftThumbnail } from '../scene/thumbnails';
const cache = new Map<string, string>();
export function CraftThumbnail({ craft }: { craft: CraftDef }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const key = JSON.stringify(craft);
    const cached = cache.get(key);
    if (cached) { setUrl(cached); return; }
    setUrl('');
    return requestCraftThumbnail(craft, PART_CATALOG, image => {
      if (image) {
        cache.set(key, image);
        if (cache.size > 32) cache.delete(cache.keys().next().value!);
      }
      setUrl(image);
    });
  }, [craft]);
  return url ? <img src={url} alt={`${craft.name} preview`} width={100} height={100} style={{ objectFit: 'contain' }} /> : <div style={{ width: 100, minHeight: 60 }}>Vehicle preview</div>;
}
