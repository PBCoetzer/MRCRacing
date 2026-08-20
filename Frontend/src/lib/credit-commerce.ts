export type CreditCartState = Record<string, number>;

export const creditCartStorageKey = "mrc-credit-cart-v1";
export const paymentsEnabled =
  process.env.NEXT_PUBLIC_PAYMENTS_ENABLED?.toLowerCase() === "true";

export function parseCreditCart(value: string): CreditCartState {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, number] => {
      const [packageId, quantity] = entry;
      return packageId.length <= 80 && Number.isInteger(quantity) &&
        Number(quantity) >= 1 && Number(quantity) <= 20;
    }),
  );
}

export function readCreditCart(): CreditCartState {
  const storedCart = window.localStorage.getItem(creditCartStorageKey);
  return storedCart ? parseCreditCart(storedCart) : {};
}

export function writeCreditCart(cart: CreditCartState) {
  window.localStorage.setItem(creditCartStorageKey, JSON.stringify(cart));
}

export function addCreditPackageToCart(
  cart: CreditCartState,
  packageId: string,
): CreditCartState {
  return {
    ...cart,
    [packageId]: Math.min(20, (cart[packageId] ?? 0) + 1),
  };
}

export function formatRand(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
