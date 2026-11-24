-- Bounded issue list API. Only the server's service role may execute it.
-- INVOKER retains the caller's existing table permissions/RLS behavior.
create or replace function public.get_issue_page(
 p_user_id uuid,
 p_page integer default 1,
 p_statuses text[] default '{}',
 p_priorities text[] default '{}',
 p_topics text[] default '{}',
 p_q text default '',
 p_sort text default 'created_at',
 p_direction text default 'desc',
 p_scope text default 'all'
) returns jsonb
language sql stable security invoker
set search_path = public
as $$
 with filtered as materialized (
  select i.*,
   case i.priority when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2 else 3 end as priority_rank
  from public.civic_issues i
  where (coalesce(cardinality(p_statuses),0)=0 or i.status=any(p_statuses))
   and (coalesce(cardinality(p_priorities),0)=0 or i.priority=any(p_priorities))
   and (coalesce(cardinality(p_topics),0)=0 or i.topic=any(p_topics))
   and (coalesce(trim(p_q),'')='' or i.title ilike '%' || trim(p_q) || '%')
   and (p_scope <> 'mine' or i.assigned_to=p_user_id)
   and (p_scope <> 'reviews' or exists (
    select 1 from public.issue_resolution_rounds rr
    join public.issue_resolution_reviews r on r.round_id=rr.id
    where rr.issue_id=i.id and rr.status='pending' and r.reviewer_id=p_user_id and r.submitted_at is null
   ))
 ), paged as (
  select f.* from filtered f
  order by
   case when p_sort='title' and p_direction='asc' then f.title end asc,
   case when p_sort='title' and p_direction<>'asc' then f.title end desc,
   case when p_sort='topic' and p_direction='asc' then f.topic end asc nulls last,
   case when p_sort='topic' and p_direction<>'asc' then f.topic end desc nulls last,
   case when p_sort='priority' and p_direction='asc' then f.priority_rank end asc,
   case when p_sort='priority' and p_direction<>'asc' then f.priority_rank end desc,
   case when p_sort='status' and p_direction='asc' then f.status end asc,
   case when p_sort='status' and p_direction<>'asc' then f.status end desc,
   case when p_sort='created_at' and p_direction='asc' then f.created_at end asc,
   case when p_sort='created_at' and p_direction<>'asc' then f.created_at end desc,
   f.created_at desc, f.id desc
  offset (greatest(1,least(coalesce(p_page,1),85899345))-1)::bigint*25 limit 25
 ), numbered as materialized (
  select p.*, row_number() over () as page_order from paged p
 )
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg((to_jsonb(p)-'priority_rank'-'page_order') || jsonb_build_object(
   'assignee',case when a.id is null then null else jsonb_build_object('id',a.id,'full_name',a.full_name) end,
   'creator',case when c.id is null then null else jsonb_build_object('id',c.id,'full_name',c.full_name) end
  ) order by p.page_order) from numbered p left join public.profiles a on a.id=p.assigned_to left join public.profiles c on c.id=p.created_by),'[]'::jsonb),
  'total',(select count(*) from filtered),
  'page',greatest(1,least(coalesce(p_page,1),85899345)),
  'pageSize',25,
  'counts',jsonb_build_object(
   'open',(select count(*) from public.civic_issues where status='Open'),
   'mine',(select count(*) from public.civic_issues where assigned_to=p_user_id),
   'critical',(select count(*) from public.civic_issues where priority='Critical' and status not in ('Closed','Resolved'))
  )
 );
$$;
revoke all on function public.get_issue_page(uuid,integer,text[],text[],text[],text,text,text,text) from public,anon,authenticated;
grant execute on function public.get_issue_page(uuid,integer,text[],text[],text[],text,text,text,text) to service_role;
create index if not exists civic_issues_status_created_id_idx on public.civic_issues(status,created_at desc,id desc);
create index if not exists civic_issues_assignee_created_id_idx on public.civic_issues(assigned_to,created_at desc,id desc);
