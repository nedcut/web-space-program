import { describe, expect, it } from 'vitest';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { groupStock, stockCategory, stockFeatures, unlockText, unlockingResearch } from '../src/editor/stock/guide';
import { newProgression } from '../src/sim/science/progression';

const stock = (id: string) => STOCK_CRAFTS.find(s => s.id === id)!;

describe('stock picker guide', () => {
  it('names the research a locked design needs, and nothing once it is unlocked', () => {
    const fresh = newProgression();
    expect(unlockingResearch(stock('stock-kestrel').build(), 'career', fresh)).toEqual([]);
    expect(unlockingResearch(stock('stock-fizzwick').build(), 'career', fresh)).toEqual([]);
    expect(unlockingResearch(stock('stock-meridian').build(), 'career', fresh).sort()).toEqual(['Propellant Practice', 'Solar Harvest']);
    expect(unlockingResearch(stock('stock-packmule').build(), 'sandbox', fresh)).toEqual([]);
    expect(unlockText([])).toBe('');
    expect(unlockText(['Load Paths'])).toBe('Research Load Paths');
    expect(unlockText(['Load Paths', 'Solar Harvest'])).toBe('Research Load Paths and Solar Harvest');
    expect(unlockText(['A', 'B', 'C', 'D'])).toBe('Research A, B and 2 more');
  });

  it('groups stock craft by role in a fixed order, keeping catalogue order inside each group', () => {
    const items = STOCK_CRAFTS.filter(s => s.scale === 'standard').map(s => ({ id: s.id, category: stockCategory(s, s.build()) }));
    const groups = groupStock(items);
    expect(groups.map(g => g.label)).toEqual(['First flights', 'Orbit & stations', 'Moon & planets', 'Aircraft & rovers', 'Just for fun']);
    expect(groups[0].items.map(s => s.id)).toEqual(['stock-kestrel', 'stock-meridian', 'stock-firstlight']);
    expect(groups.find(g => g.id === 'fun')!.items.map(s => s.id)).toEqual(['stock-fizzwick', 'stock-saltstreak', 'stock-cricket']);
  });

  it('lists tagged parts by catalogue name, and falls back to the signature hardware', () => {
    const swift = stock('stock-swift');
    expect(stockFeatures(swift, swift.build())).toEqual(['Kittiwake Turbofan', 'Broadleaf Wing', 'Bogie Main Gear', 'Hawktail Stabilizer']);
    expect(stockFeatures({}, swift.build())).toEqual(['Skylark Canopy Cockpit', 'Kittiwake Turbofan', 'Broadleaf Wing']);
    expect(stockCategory({}, swift.build())).toBe('aircraft');
    expect(stockCategory({ launchBody: 'mars' }, stock('stock-emberleaf').build())).toBe('worlds');
  });
});
