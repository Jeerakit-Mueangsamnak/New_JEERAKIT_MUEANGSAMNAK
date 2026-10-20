/**
 * Low stock = available quantity at or below the product's own reorder point
 * (products.reorder_point, mapped to `minimumStock`). There is no shop-wide threshold;
 * a reorder point of 0 means the product is never flagged.
 */
export function isLowStock(p: { availableQuantity?: number | null; minimumStock?: number | null }): boolean {
  const point = Number(p.minimumStock) || 0
  return point > 0 && (Number(p.availableQuantity) || 0) <= point
}
