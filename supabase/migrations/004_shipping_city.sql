alter table public.orders
add column if not exists shipping_city text;

create index if not exists orders_shipping_city_idx on public.orders (shipping_city);

comment on column public.orders.shipping_city is 'Shipping destination city from Shopify shipping address.';
