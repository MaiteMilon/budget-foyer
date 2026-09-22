-- =====================================================================
-- BUDGET FOYER — Schéma Supabase (PostgreSQL + Row Level Security)
-- =====================================================================
-- Principes directeurs :
--  1. Aucune donnée financière n'est lisible par un utilisateur qui
--     n'appartient pas au même foyer (sauf ses "envies d'achat" qui ne
--     sont lisibles QUE par lui, RLS au niveau base, pas juste UI).
--  2. Toute règle "privé / partagé" est appliquée par des policies RLS,
--     jamais seulement filtrée côté client.
--  3. On distingue partout OBJECTIF (prévu) et RÉALISÉ (effectif).
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1. FOYERS & MEMBRES
-- ---------------------------------------------------------------------

create table households (
  id uuid primary key default uuid_generate_v4(),
  name text not null default 'Notre foyer',
  created_at timestamptz not null default now()
);

-- Profil utilisateur = extension de auth.users. Le prénom / avatar sont
-- saisis par l'utilisateur lui-même, JAMAIS codés en dur.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  household_id uuid references households (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Invitations sécurisées pour rejoindre un foyer (lien ou code à usage unique)
create table household_invites (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  code text not null unique,           -- code court affiché / encodé dans le lien
  created_by uuid not null references profiles (id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. MOIS BUDGÉTAIRE (un par utilisateur x mois — chacun prépare le sien)
-- ---------------------------------------------------------------------

create table budget_months (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  month date not null,                 -- toujours le 1er du mois, ex. 2026-10-01
  safety_margin numeric(10,2) not null default 0,
  started_at timestamptz,              -- rempli quand l'utilisateur clique "Démarrer mon mois"
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

-- Revenus du mois (salaire, revenus additionnels, remboursements, exceptionnels)
-- Revenu fixe : le gabarit (mensualité qui se répète), géré indépendamment
-- depuis l'écran Revenus, sur le même principe que fixed_charges/
-- fixed_charge_entries. Toujours personnel (pas de notion de "commune"
-- pour un revenu) — RLS restreinte au seul propriétaire plus bas.
create table recurring_incomes (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  owner_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('salaire','autre_revenu','remboursement','exceptionnel')),
  default_amount numeric(10,2) not null,
  is_active boolean not null default true, -- mis en pause sans perdre l'historique
  created_at timestamptz not null default now()
);

create table incomes (
  id uuid primary key default uuid_generate_v4(),
  budget_month_id uuid not null references budget_months (id) on delete cascade,
  label text not null,                 -- "Salaire", "Remboursement mutuelle", ...
  kind text not null check (kind in ('salaire','autre_revenu','remboursement','exceptionnel')),
  amount numeric(10,2) not null check (amount >= 0),
  -- Rempli si ce revenu provient d'un gabarit "fixe" ; NULL pour un
  -- revenu ponctuel (aucun gabarit, ajouté une seule fois pour ce mois).
  recurring_income_id uuid references recurring_incomes (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. POCHES D'ÉPARGNE (comptes joint, tirelires, épargne, projets...)
-- ---------------------------------------------------------------------

create table savings_pockets (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  owner_id uuid references profiles (id) on delete cascade, -- NULL = compte commun
  name text not null, -- toujours saisi librement par l'utilisateur, jamais codé en dur
  icon text,
  kind text not null check (kind in
    ('compte_joint','tirelire','epargne','vacances','precaution','projet','autre')),
  -- 'depense' : un compte/moyen de paiement du quotidien, sans réservation
  --   préalable — le dépenser réduit directement le budget disponible du mois,
  --   comme "Mon compte perso" (§ règle anti double-comptage).
  -- 'epargne' : de l'argent mis de côté via un objectif/versement prévu
  --   chaque mois — le dépenser ne re-diminue JAMAIS le budget disponible,
  --   déjà réservé en amont (comportement historique du compte joint).
  usage_type text not null default 'epargne' check (usage_type in ('depense','epargne')),
  is_private boolean not null default false, -- si true, visible du seul owner (RLS)
  target_amount numeric(10,2), -- objectif d'épargne total (epargne) OU enveloppe mensuelle (depense)
  target_date date,
  balance numeric(10,2) not null default 0,  -- solde réellement constaté
  created_at timestamptz not null default now()
);

-- Objectif mensuel de versement vers une poche (le "prévu" du mois)
create table savings_goals (
  id uuid primary key default uuid_generate_v4(),
  budget_month_id uuid not null references budget_months (id) on delete cascade,
  pocket_id uuid not null references savings_pockets (id) on delete cascade,
  planned_amount numeric(10,2) not null default 0,   -- OBJECTIF DU MOIS
  actual_paid_in numeric(10,2) not null default 0,   -- MONTANT RÉELLEMENT VERSÉ
  created_at timestamptz not null default now(),
  unique (budget_month_id, pocket_id)
);

-- ---------------------------------------------------------------------
-- 4. CHARGES FIXES
-- ---------------------------------------------------------------------

create table fixed_charges (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  owner_id uuid references profiles (id) on delete cascade, -- NULL = charge commune
  label text not null,
  category text not null default 'autre',
  is_shared boolean not null default false,
  is_recurring boolean not null default true,
  default_amount numeric(10,2) not null,
  -- Jour du mois prévu de prélèvement pour une charge récurrente (1-31) ;
  -- pour une charge ponctuelle, on utilise plutôt one_off_date.
  due_day smallint check (due_day between 1 and 31),
  one_off_date date, -- date précise pour une charge ponctuelle
  is_active boolean not null default true, -- charge mise en pause sans perdre son historique
  -- Compte prévu pour le prélèvement (optionnel). Ne change RIEN au
  -- calcul du budget disponible (déjà réservé via la charge elle-même,
  -- §6) — sert uniquement, une fois la charge marquée "payée" sur
  -- fixed_charge_entries, à décompter le solde réel de ce compte.
  source_pocket_id uuid references savings_pockets (id),
  created_at timestamptz not null default now()
);

-- Écran "Gestion des charges" : la charge est un objet autonome, géré
-- indépendamment de "Préparer mon mois" (elle continue d'alimenter cet
-- écran comme gabarit suggéré, voir month-prep.js).

-- Occurrence d'une charge pour un mois donné (générée automatiquement si récurrente)
create table fixed_charge_entries (
  id uuid primary key default uuid_generate_v4(),
  budget_month_id uuid not null references budget_months (id) on delete cascade,
  fixed_charge_id uuid references fixed_charges (id) on delete set null,
  label text not null,
  category text not null default 'autre',
  amount numeric(10,2) not null,
  due_date date,
  is_paid boolean not null default false,
  -- Copié depuis le gabarit à la création de l'entrée, éditable
  -- indépendamment ensuite (même logique que le montant : "ce mois
  -- uniquement" ne touche jamais le gabarit).
  source_pocket_id uuid references savings_pockets (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. COMPTES / SOURCES DE PAIEMENT & DÉPENSES
-- ---------------------------------------------------------------------

-- "Compte" = d'où sort l'argent pour une dépense : compte perso, compte
-- joint, espèces, ou une poche d'épargne existante (ex. tirelire vacances).
-- On le modélise en pointant soit vers un user (compte perso), soit vers
-- une savings_pocket (compte joint / tirelire / épargne).

-- Achat en plusieurs fois : le "plan" qui regroupe les mensualités générées
-- automatiquement dans `expenses`. Une mensualité déjà passée (mois <=
-- mois en cours) ne doit JAMAIS être modifiée rétroactivement (même
-- principe que partout ailleurs dans l'app) ; seules les mensualités
-- futures peuvent être révisées, soldées en une fois, ou annulées.
create table installment_plans (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  created_by uuid not null references profiles (id) on delete cascade,
  label text not null,
  category text not null default 'autres',
  merchant text,
  source_type text not null check (source_type in ('perso','compte_joint','pocket')),
  source_pocket_id uuid references savings_pockets (id),
  is_shared boolean not null default false, -- achat commun (compte joint) vs personnel
  total_amount numeric(10,2) not null check (total_amount > 0),
  installment_count smallint not null check (installment_count > 0),
  status text not null default 'active' check (status in ('active','settled','cancelled','completed')),
  created_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  paid_by uuid not null references profiles (id) on delete cascade,
  budget_month_id uuid not null references budget_months (id) on delete cascade,

  source_type text not null check (source_type in ('perso','compte_joint','pocket')),
  source_pocket_id uuid references savings_pockets (id), -- requis si source_type <> 'perso'

  amount numeric(10,2) not null check (amount > 0),
  spent_at date not null default current_date,
  category text not null default 'autres',
  merchant text,
  comment text,
  receipt_photo_url text,
  ocr_raw jsonb,             -- résultat brut OCR avant confirmation utilisateur

  -- Achat en plusieurs fois (échéancier) : si renseigné, cette dépense est
  -- une mensualité générée automatiquement par installment_plans ci-dessus.
  installment_plan_id uuid references installment_plans (id) on delete set null,
  installment_index smallint, -- 1, 2, 3... position dans l'échéancier

  created_at timestamptz not null default now()
);

create table expense_categories (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  name text not null,
  icon text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

-- Transferts internes (versement réel vers une poche) : distincts d'une
-- dépense pour ne JAMAIS être doublement décomptés (règle §25).
create table pocket_transfers (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  pocket_id uuid not null references savings_pockets (id) on delete cascade,
  budget_month_id uuid not null references budget_months (id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  transferred_at date not null default current_date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. ENVIES D'ACHAT — STRICTEMENT PRIVÉES (règle absolue §15)
-- ---------------------------------------------------------------------

create table wishlist_items (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references profiles (id) on delete cascade, -- SEUL lecteur autorisé
  household_id uuid not null references households (id) on delete cascade, -- pour cohérence, jamais utilisé pour élargir l'accès
  name text not null,
  price numeric(10,2),
  url text,
  photo_url text,
  comment text,
  reflection_delay text not null default 'none'
    check (reflection_delay in ('none','24h','48h','72h','7d')),
  reflect_until timestamptz,
  status text not null default 'pending'
    check (status in ('pending','purchased','dismissed')),
  resulting_expense_id uuid references expenses (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. JOURNAL D'ACTIVITÉ DU FOYER (jamais les envies d'achat, §18)
-- ---------------------------------------------------------------------

create table household_activity_log (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  actor_id uuid references profiles (id),
  kind text not null,          -- 'expense_added','transfer_done','goal_updated', ...
  message text not null,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

alter table households enable row level security;
alter table profiles enable row level security;
alter table household_invites enable row level security;
alter table budget_months enable row level security;
alter table incomes enable row level security;
alter table recurring_incomes enable row level security;
alter table savings_pockets enable row level security;
alter table savings_goals enable row level security;
alter table fixed_charges enable row level security;
alter table fixed_charge_entries enable row level security;
alter table expenses enable row level security;
alter table expense_categories enable row level security;
alter table pocket_transfers enable row level security;
alter table wishlist_items enable row level security;
alter table household_activity_log enable row level security;
alter table installment_plans enable row level security;

-- Fonction utilitaire : le foyer de l'utilisateur connecté
create or replace function my_household_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select household_id from profiles where id = auth.uid();
$$;

-- profiles : chacun voit son profil + les profils de son foyer
create policy "profiles_select_same_household" on profiles
  for select using (id = auth.uid() or household_id = my_household_id());
-- IMPORTANT (audit sécurité) : household_id ne peut PAS être changé par un
-- simple UPDATE côté client, même le sien — sinon n'importe quel compte
-- pourrait "rejoindre" n'importe quel foyer en devinant son UUID, sans
-- jamais passer par un code d'invitation. Le déclencheur ci-dessous
-- (trg_guard_profile_household_change) bloque toute tentative qui ne
-- passe pas par une fonction RPC de confiance (create_household /
-- accept_household_invite), seules autorisées à changer ce champ.
create policy "profiles_update_self" on profiles
  for update using (id = auth.uid());
create policy "profiles_insert_self" on profiles
  for insert with check (id = auth.uid());

create or replace function guard_profile_household_change()
returns trigger
language plpgsql
as $$
begin
  if NEW.household_id is distinct from OLD.household_id
     and coalesce(current_setting('app.allow_household_change', true), '') <> 'true' then
    raise exception 'household_id ne peut être changé que via create_household() ou accept_household_invite()';
  end if;
  return NEW;
end;
$$;

create trigger trg_guard_profile_household_change
  before update on profiles
  for each row execute function guard_profile_household_change();

-- households : visible par ses membres. La création se fait exclusivement
-- via la fonction create_household() (SECURITY DEFINER, plus bas) — aucune
-- policy INSERT côté client n'est nécessaire ni fournie.
create policy "households_select_members" on households
  for select using (id = my_household_id());

-- household_invites : visibles/gérables UNIQUEMENT par les membres du
-- foyer concerné. La lecture "par code" pour rejoindre un foyer ne passe
-- JAMAIS par une policy SELECT directe (qui serait listable en masse par
-- n'importe qui) mais par la fonction accept_household_invite() plus bas,
-- en SECURITY DEFINER.
create policy "invites_select_household" on household_invites
  for select using (household_id = my_household_id());
create policy "invites_insert_household" on household_invites
  for insert with check (household_id = my_household_id());
create policy "invites_update_household" on household_invites
  for update using (household_id = my_household_id());

-- Table générique "appartient au foyer" : mêmes règles pour la plupart
-- des tables financières partagées.
create policy "budget_months_household" on budget_months
  for all using (household_id = my_household_id());

create policy "incomes_household" on incomes
  for all using (
    budget_month_id in (select id from budget_months where household_id = my_household_id())
  );

-- recurring_incomes : chaque personne modifie/supprime uniquement les
-- siens, mais TOUT le foyer peut les CONSULTER — l'app doit être
-- transparente entre les deux membres, ce que seules les envies d'achat
-- (wishlist_items) et les éléments explicitement cochés "privés"
-- (comptes, projets) n'ont pas à respecter.
create policy "recurring_incomes_select" on recurring_incomes
  for select using (household_id = my_household_id());
create policy "recurring_incomes_insert" on recurring_incomes
  for insert with check (household_id = my_household_id() and owner_id = auth.uid());
create policy "recurring_incomes_update" on recurring_incomes
  for update using (owner_id = auth.uid());
create policy "recurring_incomes_delete" on recurring_incomes
  for delete using (owner_id = auth.uid());

-- savings_pockets : partagées si is_private = false OU owner = moi ;
-- une poche marquée privée n'est visible que par son owner.
create policy "pockets_select" on savings_pockets
  for select using (
    household_id = my_household_id()
    and (is_private = false or owner_id = auth.uid())
  );
create policy "pockets_write" on savings_pockets
  for insert with check (household_id = my_household_id());
create policy "pockets_update" on savings_pockets
  for update using (
    household_id = my_household_id()
    and (is_private = false or owner_id = auth.uid())
  );
-- Une poche commune se supprime à égalité par les deux membres (pas de
-- validation croisée) ; une poche privée uniquement par son owner.
create policy "pockets_delete" on savings_pockets
  for delete using (
    household_id = my_household_id()
    and (is_private = false or owner_id = auth.uid())
  );

create policy "savings_goals_household" on savings_goals
  for all using (
    pocket_id in (
      select id from savings_pockets
      where household_id = my_household_id()
        and (is_private = false or owner_id = auth.uid())
    )
  );

-- Tout le foyer peut LIRE toutes les charges (utile pour "Mon budget" et
-- la vue foyer), mais seule une charge commune (is_shared = true) est
-- modifiable/supprimable par les deux membres à égalité ; une charge
-- personnelle (is_shared = false) reste réservée à son owner.
create policy "fixed_charges_select" on fixed_charges
  for select using (household_id = my_household_id());
create policy "fixed_charges_insert" on fixed_charges
  for insert with check (household_id = my_household_id());
create policy "fixed_charges_update" on fixed_charges
  for update using (
    household_id = my_household_id() and (is_shared = true or owner_id = auth.uid())
  );
create policy "fixed_charges_delete" on fixed_charges
  for delete using (
    household_id = my_household_id() and (is_shared = true or owner_id = auth.uid())
  );

create policy "fixed_charge_entries_household" on fixed_charge_entries
  for all using (
    budget_month_id in (select id from budget_months where household_id = my_household_id())
  );

create policy "expenses_household" on expenses
  for all using (household_id = my_household_id());

-- installment_plans : visible par tout le foyer (utile pour voir un achat
-- commun en cours), mais modifiable/annulable seulement par celui qui l'a
-- créé — un échéancier personnel ne doit pas pouvoir être modifié par le
-- conjoint, même si son existence peut être visible côté commun.
create policy "installment_plans_select" on installment_plans
  for select using (household_id = my_household_id());
create policy "installment_plans_insert" on installment_plans
  for insert with check (household_id = my_household_id() and created_by = auth.uid());
create policy "installment_plans_update" on installment_plans
  for update using (household_id = my_household_id() and created_by = auth.uid());
create policy "installment_plans_delete" on installment_plans
  for delete using (household_id = my_household_id() and created_by = auth.uid());

create policy "expense_categories_household" on expense_categories
  for all using (household_id = my_household_id());

create policy "pocket_transfers_household" on pocket_transfers
  for all using (household_id = my_household_id());

-- wishlist_items : RÈGLE ABSOLUE — accès strictement limité au owner,
-- quel que soit le foyer. Pas d'exception, pas de policy "household".
create policy "wishlist_owner_only" on wishlist_items
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "activity_log_household_read" on household_activity_log
  for select using (household_id = my_household_id());
create policy "activity_log_household_insert" on household_activity_log
  for insert with check (household_id = my_household_id());

-- =====================================================================
-- FONCTIONS RPC (appelées depuis src/lib/data.js)
-- =====================================================================

-- Décrémente le solde d'une poche de façon atomique (utilisé quand une
-- dépense est payée depuis le compte joint ou une tirelire, §9).
create or replace function decrement_pocket_balance(pocket_id uuid, delta numeric)
returns void
language sql
security invoker
as $$
  update savings_pockets set balance = balance - delta where id = pocket_id;
$$;

-- ---------------------------------------------------------------------
-- Historique des modifications sur les éléments COMMUNS : qui a fait
-- quoi et quand, en base (déclencheur), pas seulement si l'app pense à
-- l'appeler. Les éléments privés (poche is_private, charge is_shared =
-- false, et bien sûr toute wishlist_items) ne sont JAMAIS journalisés ici.
-- ---------------------------------------------------------------------

create or replace function log_shared_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_label text;
  v_is_private boolean;
  v_kind text;
  v_noun text;
  v_verb text;
begin
  v_noun := case TG_TABLE_NAME when 'savings_pockets' then 'Poche' else 'Charge' end;

  -- IMPORTANT : NEW/OLD sont des RECORD dynamiques ; on ne peut PAS faire
  -- coalesce(old.name, old.label, ...) car "name" n'existe pas sur
  -- fixed_charges (et inversement pour "label") — l'accès au champ est
  -- résolu à l'exécution et lèverait une erreur sur la mauvaise table.
  -- On sépare donc complètement les deux tables.
  if TG_TABLE_NAME = 'savings_pockets' then
    if TG_OP = 'DELETE' then
      v_household_id := old.household_id;
      v_label := old.name;
      v_is_private := old.is_private;
    else
      v_household_id := new.household_id;
      v_label := new.name;
      v_is_private := new.is_private;
    end if;
  else -- fixed_charges
    if TG_OP = 'DELETE' then
      v_household_id := old.household_id;
      v_label := old.label;
      v_is_private := not old.is_shared;
    else
      v_household_id := new.household_id;
      v_label := new.label;
      v_is_private := not new.is_shared;
    end if;
  end if;

  if v_is_private then
    return coalesce(new, old); -- jamais de trace pour un élément personnel
  end if;

  v_verb := case TG_OP when 'INSERT' then 'ajoutée' when 'UPDATE' then 'modifiée' else 'supprimée' end;
  v_kind := lower(TG_TABLE_NAME) || '_' || lower(TG_OP);

  insert into household_activity_log (household_id, actor_id, kind, message)
  values (v_household_id, auth.uid(), v_kind, format('%s %s : %s', v_noun, v_verb, v_label));

  return coalesce(new, old);
end;
$$;

create trigger trg_log_pockets
  after insert or update or delete on savings_pockets
  for each row execute function log_shared_table_change();

create trigger trg_log_fixed_charges
  after insert or update or delete on fixed_charges
  for each row execute function log_shared_table_change();

-- ---------------------------------------------------------------------
-- Rejoindre un foyer par code d'invitation. En SECURITY DEFINER car,
-- avant de rejoindre, my_household_id() de l'appelant est NULL : les
-- policies normales ne permettraient ni de lire l'invitation au-delà de
-- "used_at is null", ni de modifier households_invites / profiles d'un
-- foyer qui n'est pas encore le sien. Toute la validation se fait donc
-- ICI, dans une transaction unique, plutôt que côté client.
-- ---------------------------------------------------------------------

create or replace function accept_household_invite(p_code text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite household_invites;
  v_household households;
begin
  select * into v_invite
    from household_invites
    where code = p_code and used_at is null and expires_at > now()
    limit 1;

  if v_invite is null then
    raise exception 'invite_invalid_or_expired';
  end if;

  update household_invites
    set used_at = now(), used_by = auth.uid()
    where id = v_invite.id;

  perform set_config('app.allow_household_change', 'true', true);
  update profiles
    set household_id = v_invite.household_id
    where id = auth.uid();

  select * into v_household from households where id = v_invite.household_id;

  insert into household_activity_log (household_id, actor_id, kind, message)
  values (v_household.id, auth.uid(), 'member_joined', 'A rejoint le foyer.');

  return v_household;
end;
$$;

grant execute on function accept_household_invite(text) to authenticated;

-- ---------------------------------------------------------------------
-- Créer un foyer. En SECURITY DEFINER pour le même motif : c'est le SEUL
-- chemin légitime qui écrit household_id sur son propre profil (avec
-- accept_household_invite ci-dessus), grâce au laissez-passer transaction
-- app.allow_household_change consommé par le déclencheur sur profiles.
-- ---------------------------------------------------------------------

create or replace function create_household(p_name text default 'Notre foyer')
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already uuid;
  v_household households;
begin
  select household_id into v_already from profiles where id = auth.uid();
  if v_already is not null then
    raise exception 'already_in_a_household';
  end if;

  insert into households (name) values (coalesce(nullif(trim(p_name), ''), 'Notre foyer'))
    returning * into v_household;

  perform set_config('app.allow_household_change', 'true', true);
  update profiles set household_id = v_household.id where id = auth.uid();

  insert into expense_categories (household_id, name, icon, is_default) values
    (v_household.id, 'courses', '🛒', true),
    (v_household.id, 'essence', '⛽', true),
    (v_household.id, 'restaurants', '🍽️', true),
    (v_household.id, 'enfants', '🧸', true),
    (v_household.id, 'maison', '🏡', true),
    (v_household.id, 'vetements', '👕', true),
    (v_household.id, 'loisirs', '🎮', true),
    (v_household.id, 'sante', '💊', true),
    (v_household.id, 'beaute', '💄', true),
    (v_household.id, 'achats_perso', '🎁', true),
    (v_household.id, 'vacances', '🏖️', true),
    (v_household.id, 'autres', '➕', true);

  return v_household;
end;
$$;

grant execute on function create_household(text) to authenticated;

-- ---------------------------------------------------------------------
-- Stockage des photos de tickets (Supabase Storage). Un bucket privé,
-- avec un chemin conventionnel "<household_id>/<fichier>" pour que les
-- policies s'appuient sur la même fonction my_household_id().
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "receipts_select_household" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = my_household_id()::text
  );
create policy "receipts_insert_household" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = my_household_id()::text
  );
create policy "receipts_delete_household" on storage.objects
  for delete using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = my_household_id()::text
  );

-- =====================================================================
-- MIGRATION — à exécuter si vous avez déjà lancé une version antérieure
-- de ce fichier dans Supabase (sinon ces colonnes existent déjà via le
-- CREATE TABLE ci-dessus, et cette section ne fait rien de plus).
-- Idempotent : peut être relancée sans risque.
-- =====================================================================

alter table fixed_charges add column if not exists due_day smallint;
alter table fixed_charges add column if not exists one_off_date date;
alter table fixed_charges add column if not exists is_active boolean not null default true;

-- Comptes (ex-"poches") : dépense vs épargne. Les comptes existants
-- (dont le compte joint) reprennent 'epargne' par défaut, ce qui
-- correspond exactement à leur comportement historique (réservé en
-- amont, jamais re-décompté du budget disponible).
alter table savings_pockets add column if not exists usage_type text not null default 'epargne';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'savings_pockets_usage_type_check'
  ) then
    alter table savings_pockets add constraint savings_pockets_usage_type_check
      check (usage_type in ('depense','epargne'));
  end if;
end $$;

-- Compte prévu de prélèvement pour une charge fixe (§ "les charges
-- fixes, quand je les ajoute, est-ce qu'on choisit le compte").
alter table fixed_charges add column if not exists source_pocket_id uuid references savings_pockets (id);
alter table fixed_charge_entries add column if not exists source_pocket_id uuid references savings_pockets (id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fixed_charges_due_day_check'
  ) then
    alter table fixed_charges add constraint fixed_charges_due_day_check
      check (due_day between 1 and 31);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- MIGRATION SÉCURITÉ — referme deux failles si une version antérieure de
-- ce schéma tourne déjà : (1) les codes d'invitation non utilisés étaient
-- listables par n'importe quel compte, tous foyers confondus ; (2)
-- household_id pouvait être modifié par un simple UPDATE de son propre
-- profil, permettant de rejoindre n'importe quel foyer sans invitation.
-- Idempotent : peut être relancée sans risque.
-- ---------------------------------------------------------------------

drop policy if exists "invites_select_household_or_by_code" on household_invites;
drop policy if exists "invites_select_household" on household_invites;
create policy "invites_select_household" on household_invites
  for select using (household_id = my_household_id());

drop policy if exists "invites_update_household_or_claimer" on household_invites;
drop policy if exists "invites_update_household" on household_invites;
create policy "invites_update_household" on household_invites
  for update using (household_id = my_household_id());

drop policy if exists "households_insert_any_authenticated" on households;

create or replace function guard_profile_household_change()
returns trigger
language plpgsql
as $$
begin
  if NEW.household_id is distinct from OLD.household_id
     and coalesce(current_setting('app.allow_household_change', true), '') <> 'true' then
    raise exception 'household_id ne peut être changé que via create_household() ou accept_household_invite()';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_guard_profile_household_change on profiles;
create trigger trg_guard_profile_household_change
  before update on profiles
  for each row execute function guard_profile_household_change();

create or replace function create_household(p_name text default 'Notre foyer')
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already uuid;
  v_household households;
begin
  select household_id into v_already from profiles where id = auth.uid();
  if v_already is not null then
    raise exception 'already_in_a_household';
  end if;

  insert into households (name) values (coalesce(nullif(trim(p_name), ''), 'Notre foyer'))
    returning * into v_household;

  perform set_config('app.allow_household_change', 'true', true);
  update profiles set household_id = v_household.id where id = auth.uid();

  insert into expense_categories (household_id, name, icon, is_default)
  select v_household.id, c.name, c.icon, true
  from (values
    ('courses','🛒'), ('essence','⛽'), ('restaurants','🍽️'), ('enfants','🧸'),
    ('maison','🏡'), ('vetements','👕'), ('loisirs','🎮'), ('sante','💊'),
    ('beaute','💄'), ('achats_perso','🎁'), ('vacances','🏖️'), ('autres','➕')
  ) as c(name, icon)
  where not exists (
    select 1 from expense_categories ec where ec.household_id = v_household.id and ec.name = c.name
  );

  return v_household;
end;
$$;

grant execute on function create_household(text) to authenticated;

create or replace function accept_household_invite(p_code text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite household_invites;
  v_household households;
begin
  select * into v_invite
    from household_invites
    where code = p_code and used_at is null and expires_at > now()
    limit 1;

  if v_invite is null then
    raise exception 'invite_invalid_or_expired';
  end if;

  update household_invites
    set used_at = now(), used_by = auth.uid()
    where id = v_invite.id;

  perform set_config('app.allow_household_change', 'true', true);
  update profiles
    set household_id = v_invite.household_id
    where id = auth.uid();

  select * into v_household from households where id = v_invite.household_id;

  insert into household_activity_log (household_id, actor_id, kind, message)
  values (v_household.id, auth.uid(), 'member_joined', 'A rejoint le foyer.');

  return v_household;
end;
$$;

grant execute on function accept_household_invite(text) to authenticated;

-- =====================================================================
-- MIGRATION — Achat en plusieurs fois (échéancier). Idempotent, à
-- exécuter même si vous avez déjà lancé une version antérieure de ce
-- fichier (sans effet si les tables/colonnes existent déjà).
-- =====================================================================

create table if not exists installment_plans (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  created_by uuid not null references profiles (id) on delete cascade,
  label text not null,
  category text not null default 'autres',
  merchant text,
  source_type text not null check (source_type in ('perso','compte_joint','pocket')),
  source_pocket_id uuid references savings_pockets (id),
  is_shared boolean not null default false,
  total_amount numeric(10,2) not null check (total_amount > 0),
  installment_count smallint not null check (installment_count > 0),
  status text not null default 'active' check (status in ('active','settled','cancelled','completed')),
  created_at timestamptz not null default now()
);

alter table installment_plans enable row level security;

alter table expenses add column if not exists installment_plan_id uuid references installment_plans (id) on delete set null;
alter table expenses add column if not exists installment_index smallint;

drop policy if exists "installment_plans_select" on installment_plans;
create policy "installment_plans_select" on installment_plans
  for select using (household_id = my_household_id());

drop policy if exists "installment_plans_insert" on installment_plans;
create policy "installment_plans_insert" on installment_plans
  for insert with check (household_id = my_household_id() and created_by = auth.uid());

drop policy if exists "installment_plans_update" on installment_plans;
create policy "installment_plans_update" on installment_plans
  for update using (household_id = my_household_id() and created_by = auth.uid());

drop policy if exists "installment_plans_delete" on installment_plans;
create policy "installment_plans_delete" on installment_plans
  for delete using (household_id = my_household_id() and created_by = auth.uid());

-- ---------------------------------------------------------------------
-- MIGRATION — Revenus fixes gérés indépendamment (écran Revenus, même
-- principe que l'écran Charges). Idempotent.
-- ---------------------------------------------------------------------

create table if not exists recurring_incomes (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households (id) on delete cascade,
  owner_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('salaire','autre_revenu','remboursement','exceptionnel')),
  default_amount numeric(10,2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table recurring_incomes enable row level security;
alter table incomes add column if not exists recurring_income_id uuid references recurring_incomes (id) on delete set null;

-- MIGRATION — transparence entre membres du foyer sur les revenus fixes :
-- consultation par tous, modification réservée au propriétaire.
drop policy if exists "recurring_incomes_owner" on recurring_incomes;
drop policy if exists "recurring_incomes_select" on recurring_incomes;
create policy "recurring_incomes_select" on recurring_incomes
  for select using (household_id = my_household_id());
drop policy if exists "recurring_incomes_insert" on recurring_incomes;
create policy "recurring_incomes_insert" on recurring_incomes
  for insert with check (household_id = my_household_id() and owner_id = auth.uid());
drop policy if exists "recurring_incomes_update" on recurring_incomes;
create policy "recurring_incomes_update" on recurring_incomes
  for update using (owner_id = auth.uid());
drop policy if exists "recurring_incomes_delete" on recurring_incomes;
create policy "recurring_incomes_delete" on recurring_incomes
  for delete using (owner_id = auth.uid());

-- =====================================================================
-- CATÉGORIES PAR DÉFAUT (insérées à la création d'un foyer, via trigger
-- applicatif ou fonction ; laissé volontairement hors DDL pour rester
-- simple — voir src/lib/household.js)
-- =====================================================================
