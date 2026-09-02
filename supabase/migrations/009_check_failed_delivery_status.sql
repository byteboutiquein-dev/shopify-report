alter table public.order_tracking
drop constraint if exists order_delivery_status_check;

alter table public.order_tracking
add constraint order_delivery_status_check
check (delivery_status in ('Pending', 'In Transit', 'Check Failed', 'Delivered', 'Returned', 'Issue'));
