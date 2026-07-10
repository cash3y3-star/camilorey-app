alter table matches
  add constraint matches_tournament_unique unique (tournament_id);

alter table picks
  add constraint picks_match_unique unique (match_id);
