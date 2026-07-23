alter table public.orders
add column if not exists shipping_state text;

create index if not exists orders_shipping_state_idx on public.orders (shipping_state);

comment on column public.orders.shipping_state is 'Shipping destination state/province from Shopify shipping address.';

notify pgrst, 'reload schema';
