// Cart page: lists items. Prices are shown as the server sends them.
type Item = { name: string; priceCents: number };

export function Cart({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((i) => (
        <li key={i.name}>
          {i.name}: {(i.priceCents / 100).toFixed(2)}
        </li>
      ))}
    </ul>
  );
}
