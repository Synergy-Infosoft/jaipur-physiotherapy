export function calculateVariance(countedCash: number, systemCashTotal: number) {
  return Number((countedCash - systemCashTotal).toFixed(2))
}

export function getVarianceTone(variance: number) {
  if (variance === 0) return 'balanced'
  return variance > 0 ? 'positive' : 'negative'
}
