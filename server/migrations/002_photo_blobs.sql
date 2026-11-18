-- Archivio foto in database (STORAGE_DRIVER=db), per hosting senza disco persistente.
-- Con STORAGE_DRIVER=fs (predefinito) la tabella resta vuota e non viene usata.
create table photo_blobs (
  storage_key text primary key,
  data        bytea not null,
  created_at  timestamptz not null default now()
);
-- Le foto sono già JPEG compressi: niente compressione TOAST inutile.
alter table photo_blobs alter column data set storage external;
