/** Display labels only; saved graphics values stay stable. */
export function graphicsLabel(value: string | number): string {
  const labels: Record<string, string> = {
    low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', off: 'Off',
    fxaa: 'FXAA', smaa: 'SMAA', 'msaa+smaa': 'MSAA + SMAA',
  };
  return labels[value] ?? String(value);
}
