---
kind: upgrade-guide
description: "Creating a team whose name matches an archived team is now refused so a later archive cannot overwrite the earlier one."
---

# Archived PatentTeams names stay reserved

English | [中文](guide.zh.md)

## Change

`patent_teams_create` previously accepted a name after its team had been archived. Deleting the new team then replaced `archive/<teamId>`, silently destroying the earlier archive. The call now fails with `TEAM_NAME_ARCHIVED` and leaves the existing archive intact. This affects captains that reuse a team name after `patent_teams_delete`; archived teams remain readable through `patent_teams_archive`.

## Migration

1. Choose a new team name for the new case. Names of archived teams are no longer available in the same state root.
2. Read the old record through `patent_teams_archive` before choosing the new name; it is the retained source for the earlier review.
3. Confirm: `patent_teams_create` with an archived name returns `TEAM_NAME_ARCHIVED`, and `patent_teams_archive` still lists the earlier team.
