# Design: importing the old artwork, and the temporary migration map

Status: proposed, 2026-10-26, revised the same day after owner review. Inputs: [[Investigation/medieval-ornaments]], [[Investigation/Consumers]], [[Investigation/Current asset inventory]].

What this is and is not. The new library is built fresh: new repos, new ids, new metadata, new packages. Nothing from `medieval-ornaments` is inherited, wrapped or kept compatible. The only thing taken from it is the artwork itself (the lossless masters and the hand-made vectors), because there is no other copy of it, plus the old records as a starting draft that is reviewed and rewritten. The "migration map" is a separate, temporary lookup table that exists so the two existing pages can be pointed at the new ids once; it is kept apart from every package and deleted in a later release.

## Goals

1. Every one of the 726 old designs ends up in exactly one new set with a new id, or is explicitly dropped with a reason.
2. The artwork move is provable: the importer verifies that the new master's pixels are identical to the old master's (same SHA-256 of the decoded RGBA, since the old library kept PNG and lossless WebP that decode identically).
3. Metadata is **not** copied as final. The importer writes `status: draft` YAML with the old fields mapped onto the new names as a starting point; every set is then reviewed and rewritten against the new model (vocabulary, descriptions, usage notes, provenance) before anything in it is approved. What the old records can contribute and what the reviewed model contains is a separate discussion; see [[Metadata model]]. Nothing is invented: assets without provenance stay without provenance until their origin is written down.
4. A machine-readable map, kept apart from all packages, lets polyhymnia and elder-scrolls move by editing one file each. It is deleted at a dated milestone after both have moved.
5. The old packages stay on npm untouched. Nothing is unpublished. The old runtime keeps working for anyone pinned to it.

## The importer (`tools import medieval-ornaments`)

Runs locally once, against the old repo's `images.json`, `resource-registry.json`, `resource-lock.json` and the 29 resource checkouts. For each old design it:

1. Resolves the target set and new id from the **set plan** below (a YAML table checked into `migration/plan.yaml`, hand-adjustable).
2. Copies the master: prefers the old `png/<name>.png`; drops the lossless WebP twin, the 128 to 768 variants, and every traced SVG. Hand-made vectors (the six floral border styles) copy their SVG as master.
3. Copies components that are true masters (`corner`, corner phases, `bar`) into the asset folder and drops generated ones (`rotated_tile`, `border_image` atlas, `reference_crop`), rewriting the geometry into `render.tile` / `render.frame`.
4. Writes a **draft** `asset.yaml` (`status: draft`, `review: pending`) with the old fields mapped onto the new names as a starting point: `name` → `id` (stripped of set prefix where the set makes it redundant), `description`, `categories`, `subjects`, `colors`, `facing` (`unclear` → `none`), `composition`, `usage_notes` minus the boilerplate strings that repeat hundreds of times, `author`, `provenance` normalised (institution names canonicalised, `image_rights` mapped to SPDX where it says CC0 or PDM, otherwise kept as `rights_text`), `sets[1]` → `group` when it was a folio set. The draft is an input to review, never the published record.
5. Writes one `migration/medieval-ornaments.json` entry per old design and per old component.
6. Prints a report: assets per new set, estimated package sizes with the new ladder, and sets that will need volume packages.

Dry-run first; the set plan gets adjusted; then the real run creates branches in each new set repo. A set is reviewed (an agent rewrites the drafts against the new model, the owner spot-checks the contact sheet and a sample of records), assets flip to `approved`, and only then does the set publish.

## Set plan

First derived from the 75 old sets, the `reference` field of the 206 unassigned designs, and provenance institutions; corrected by the dry run on 2026-10-26, see [[Investigation/Importer dry run]] for the measured table (698 assets in 39 sets, 47 single-object holdings in triage, no set near the size guard). Where a count below disagrees with that note, the note is right. Groups are listed in parentheses.

Wave 1 (decided 2026-10-26, after the dry run showed the group rule adds nothing): the whole `illuminated-acanthus` set (35), the whole `medieval-cutouts` set (41, one coherent legacy collection, 11 of them used), and the whole `walters-w102` set (4). 80 assets, about 48 MB of delivery files.

Wave 1 metadata review, done 2026-10-26 (one agent per set, every master viewed at 512 px): all 80 records rewritten against [[Metadata model]] and approved; `schemas/vocab/subjects.yaml` rebuilt from what the records actually use (105 terms, 30 added, 11 seed terms pruned). Two ids were renamed before anything was published, and the migration map follows: `illuminated-acanthus/corner` is now `corner-top-left` (its three siblings carried their position), `medieval-cutouts/white-animal-bagpiper` is now `cat-bagpiper` (it is a cat). Facing convention for L-shaped corners: the direction the dominant stem climbs away from the vertex.

Structure pass, same evening (owner: "what matters is structuring things well, not how many assets fall into a set or group"). The rule that came out of it: `group` is the sub-collection a piece visually belongs to (a folio in a manuscript set, a series in an authored set, a crisp theme in a legacy set), never a repetition of `type`; kits inside a group (four corners plus their frame, start/centre/end) are `related` companions, variants of one piece are `related` variants. Applied: illuminated-acanthus has `ivy-border` (acanthus with green ivy on thin red and gold rules: the 15 originals, the logo medallion, module-sprig, the title ivy pieces), `floral-border` (acanthus with white flowers and red berries: both frames, the eight growth corners, the six rods) and `miniatures` (the polyhymnia figure). medieval-cutouts has `human-musicians` (14), `animal-musicians` (10), `animals` (13, hybrids and readers included) and `scenes` (4). walters-w102 keeps the folio. Two structural fixes with it: the eight growth corners are now companions of `ornate-inner-frame`, whose corners they are, not of the opaque `floral-frame`; and `title-ivy`, two ornaments on one canvas, became `title-ivy-open` and `title-ivy-close`, each cropped pixel-exactly from the original (the gap held only 45 pixels at alpha 1, generation noise, dropped), the migration map pointing the old id at the opening piece. Noted and left alone: `bunny-harp` and `bunny-trumpet` beside `rabbit-*` ids; the twelve `musician-rN-cN` ids are grid positions with no meaning (titles make them findable); `corner-bottom-right` is 3:2 while its siblings are near-square (in `quality`); the W.102 masters have figure interiors at alpha 252 rather than 255, invisible in use. `provenance` is null on every medieval-cutouts record; the 18 app-made acanthus pieces have no provenance block either (authored set, origin recorded in `set.yaml`).

Historical sources:

- `walters-w82` (groups per folio: 194v, 62v, 31r, 52r, 179v, 184r, 191v, 182v, 75v, marginalia): about 62 plus folio extras
- `walters-w171` (12r zodiac, 10r planets, 19v fountain, 74r tree): about 44
- `walters-w73` (1v wind heads, 1r zodiac): 26
- `walters-w88` (52r monkey choir, 136r dancing monkeys, 169r harp): 13
- `walters-w7` (1r canon table, 15v matthew): 7
- `walters-w186` (276v, 285r, 291v): 12
- `walters-w148` (31r, 52r): 5
- `cma-1524-psalter` (groups per leaf: 1999-136-a/b, 2011-67-a/b, 2006-15-a/b): 77; the dry run estimates 39 MB delivery and 64 MB masters, so no `-part2` is needed. `cma-2011-65` (4) stays its own set as in the old catalog.
- `walters-w102` (groups per folio, incl. 74v `horse-flute-drum` and 81r `rabbit-church-bells`): 4
- `fitzwilliam-ms1-2005`: 1 (candidate for the single-object rule below)
- `cma-2014-22` Shepherds Annunciation: 16
- `cma-1950-154` Greek Psalter: 7
- `cma-2005-206` Office of the Dead (a, b): 15
- `cma-2006-13` Ape fishing: 6
- `cma-2011-53` Latin Bible: 6
- `cma-2003-171` Antiphonary: 5
- `cma-1953-24` Beffi Coronation: 4
- `cma-1963-256`: 6 (unassigned today, reference `cleveland-1963-256-80-b`)
- `met-livre-nouveau-de-fleurs` (425823, 425840, 425800, one print series; the earlier `met-flower-friezes` entry was the same 46 designs): 46
- `met-latomus-lace`: 18
- `met-hopfer-friezes`: 10
- `met-du-cerceau` (387622 bird canopies, 338721 birdcage grotesques): 13
- `met-schoen-modelbuch` (681251, 681253, 681256, 680571, 680623): 22
- `met-acanthus-prints` (364800 putti medallions, 377606 cupid seasons): 5, or fold into `met-du-cerceau` if they are the same print room theme; decide on the dry run
- `met-356741`: 8 (unassigned today)
- `mkg-de-bry-alphabet`: 11
- `nga-ornament-prints` (3305, 3513, 3375): 8
- `openn-lewis-e-m` (groups per shelfmark 012-002, 012-019, 013-004, 013-005, 017-007, 023-019, 028-026-027, 031-029, 067-003): 35
- `gessner-historiae-animalium` (incl. e-rara lion): 18
- `fuchs-1542-herbal`: 7
- `getty-ms20`: 4 (unassigned today)

Authored:

- `illuminated-acanthus`: 15 plus the 18 pieces in polyhymnia's `homepage-art` catalog (floral frame, ornate inner frame, four frame-growth and four inward-growth corners, saltarello rods in upper/lower, finished and simple variants, module sprig, title ivy), imported from there with their prompt audits in `output/imagegen/`. Owner, 2026-10-26: these belong to the original set, unused variants included, and the whole set is in wave 1. The polyhymnia logo frame (`src/assets/logo/polyhymnia-logo-acanthus.json`, a rounded acanthus medallion generated with the same style references, portrait excluded) joins the set too. Not imported, ever: the 138 Vectorian ornaments in `notation/apps/web/src/ornaments/img`, which are under Vectorian's Standard License and are not redistributable.
- `shaggy-bestiary`: 16
- `brand` (proposed 2026-10-26): the existing `adrian729/ducktape-brand` repo becomes this set's repo without renaming. Assets: the mark (1536 × 1024 transparent master), the mallard cutout, the favicon, light and dark lockups, and the per-project lockups as `group: product`. Its Python compose script stays as the way its masters are produced; the pipeline only reads the committed masters. Lockups embed a raster inside SVG, so they ship as a raster ladder plus the optimised SVG. Other ducktape projects then reference the CDN instead of carrying copies.
- `authored-ornaments`: only the authored pieces that fit no existing authored set. Decided 2026-10-26: each of the 17 unassigned authored additions and the `polyhymnia` figure is first tested against `illuminated-acanthus` and `shaggy-bestiary` by style on the dry run (the Polyhymnia figure and the gold floral framing lean acanthus; the rabbit lutenist leans bestiary); whatever fits goes there, so those sets can keep growing without restructuring. The remainder (ivy, gold rules, book and the like) lands here, sub-grouped with `group`.

Legacy imports without provenance (decided 2026-10-26: published with `provenance: null`, an "origin unrecorded" note, and the set licence; removed through the deprecation flow if anyone claims rights):

- `medieval-cutouts`: 41
- `numbered-plate` (the 38 designs cut from one supplied ornament sheet): 38
- `floral-vector-borders` (six hand-made SVG border styles): 6
- `supplied-sheets` (groups blue-sheet, painted-sheet, five-painted-panels, stencil-sheet, tall-floral-sheet): 24

That is 39 sets and 78 packages before triage. The dry run put 47 single-object holdings in triage (7 Cleveland, 10 Met, 10 MKG, 17 NGA, 2 vector-sheet pieces). Proposed rule, for the owner to confirm before wave 2: single-object holdings go into one set per institution (`cma-leaves`, `met-prints`, `mkg-prints`, `nga-prints`) with `group` = the object and full per-asset provenance; accession-prefix matches (15 NGA with 1943.3, 2 Met with 2012.136) fold into `nga-ornament-prints` and `met-hopfer-friezes`; the two vector-sheet pieces join `supplied-sheets`.

## Id rewriting rules

- Strip the set's own name from the front of the old name when redundant: `illuminated-acanthus-divider-center` → `illuminated-acanthus/divider-center`; `walters-rabbit-church-bells` → `walters-w102/rabbit-church-bells`.
- Keep the rest verbatim, including US spelling (`center`), to make the map boring.
- Old names longer than 48 characters after stripping are shortened by hand in `plan.yaml`; the importer refuses to guess.
- Components: `<name>-corner-top-left` style suffix conventions become component ids (`corner-top-left`) inside the asset.

## The migration map (temporary, kept apart)

Where it lives and where it does not: `migration/medieval-ornaments.json` and the rendered `MIGRATION.md` are committed in the main repo under `migration/` and nowhere else. No package exports them, the index package, catalog and resolver know nothing about old names, and the set repos never mention them. Consumers that need the lookup read the file from the main repo on GitHub during their one-off move. The directory is deleted at a dated milestone once polyhymnia and elder-scrolls have moved (proposal: the first index release after both are verified), and that deletion is noted in the release record. One entry per old design and component:

```json
{
  "schema": 1,
  "source": { "runtime": "@ranx729/medieval-ornaments", "runtimeVersion": "0.12.0", "catalog": "images.json@efe40e4" },
  "entries": [
    {
      "old": { "name": "walters-rabbit-church-bells", "package": "@ranx729/medieval-ornaments-assets-illustrations-002", "version": "0.1.2", "path": "webp/walters-rabbit-church-bells.webp", "masterSha256": "…" },
      "new": { "id": "walters-w102/rabbit-church-bells", "set": "walters-w102", "package": "@ranx729/ducktape-assets-walters-w102", "version": "1.0.0", "mastersPackage": "@ranx729/ducktape-assets-walters-w102-masters" },
      "status": "moved",
      "verified": "pixels-identical",
      "notes": ""
    },
    { "old": { "name": "armored-rhinoceros", "component": "svg" }, "new": null, "status": "dropped", "verified": "n/a", "notes": "Auto-traced 47 MB SVG; the raster master is kept as walters-w82/armored-rhinoceros." }
  ]
}
```

`status` ∈ `moved` (same pixels, new id), `renamed` (same pixels, id shortened by hand), `merged` (old component folded into a new asset), `dropped` (with reason), `split` (one old design became several). `verified` ∈ `pixels-identical`, `re-encoded` (only for vectors re-optimised by svgo), `manual`.

The same data is rendered as `MIGRATION.md` (a table grouped by old package) for humans, in the same temporary directory.

## Consumer moves

- **polyhymnia**: a one-off script maps each `ornament-selection.json` entry through the map into a `ducktape.json`; local `name` keys stay. The copy command then fetches the chosen masters, and the Vite plugin reads `ducktape.manifest.json` instead of the old catalog. The `homepage-art` local package is retired once its pieces are in `illuminated-acanthus`.
- **elder-scrolls**: its refresh script is replaced by a `ducktape.json` with four ids and the copy command (same shape of output: URLs or files, dimensions, bytes, hashes per variant).
- Both are small PRs done by an agent after the first publish of the new sets, verified by building the consumer.

## Order of work

Decided 2026-10-26: the first wave imports the assets used by polyhymnia and elder-scrolls (the list in [[Investigation/Consumers]]) plus their immediate neighbours: the rest of the same `group`, and the whole set when it is small and coherent (`illuminated-acanthus` in full). Never a large set because one of its assets is used. The chain is proven end to end on real pages before anything else moves. The importer takes an allowlist of old names plus `--with-group` for this; everything else waits.

1. Dry-run importer, review the set plan and sizes, adjust `plan.yaml`.
2. Wave 1: create only the set repos those assets need, import only those assets, review their metadata, PR per set, merge.
3. Bootstrap those package names (one passkey window), first publisher run, approve.
4. Move the two consumers and ship them. Fix whatever this exposes before continuing.
5. Remaining waves: the rest of the designs, set by set, repos in batches of ten, one tap and one approve per batch.
6. Mark `medieval-ornaments` as superseded in its README with a link to the migration table. Do not unpublish anything.
7. After both consumers build against the new library, delete `migration/` in the main repo and note it in the release record.
