# Release records

One JSON file per publisher run, appended by the publish job: what was published, versions, hashes, sizes, CDN verification, timestamps. Machine-readable; replaces the old hand-written QA log. Generated `CHANGELOG.md` files in set repositories are written from this data.

Milestone outside any run: `migration/` (the old-to-new map and the importer's plan) was deleted on 2026-10-30, after the batch 3 record (run 41055622299) and once polyhymnia and elder-scrolls built against index 1.6.0. The last commit carrying it is 39a2ac9.
