create index if not exists client_tipster_favourites_tipster_idx
on public.client_tipster_favourites (tipster_id);

create index if not exists payments_credit_package_idx
on public.payments (credit_package_id)
where credit_package_id is not null;
