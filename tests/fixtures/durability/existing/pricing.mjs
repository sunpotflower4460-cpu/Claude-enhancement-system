import fs from "node:fs";
const settings = JSON.parse(
  fs.readFileSync(new URL("./settings.json", import.meta.url)),
);
export function total(items) {
  if (
    items.some(
      (item) =>
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.price < 0,
    )
  )
    throw Error("Invalid item");
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const discounted =
    subtotal >= settings.discountThreshold
      ? subtotal * (1 - settings.discountRate)
      : subtotal;
  return {
    amount: Math.round(discounted * (1 + settings.taxRate)),
    currency: settings.currency,
  };
}
