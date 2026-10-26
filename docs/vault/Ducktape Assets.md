# Ducktape Assets

We want a centralized repo for assets. 

**constraints**
- Github/npm limit repo/package size (about 150mb)
- we should be able to pick only the assets we want/need

we had repo, `medieval-ornaments`, which did this, but we created it from 0, and we added on top of it.

That resulted in several design and structural mistakes.

We will have a main repo, which will hold this vault, with the repo description, technical designs, decissions, architecture, and metadata files.

We can investigate both the medieval-ornaments and the polyhymnia repos (the second one uses the assets). That should be only to gather any helpful insights, it should never guide how we do things if it is not the best answer to our problems.

Some decissions to be made: 

- polyhymnia is build with React, but the agents there decided not to use the React assets from medieval-ornaments. Check why, mabye it is not even worth to have that, and we can work with the plain assets alone.
- We want to have a better structure for the repos. for example, we have serveral `sets` of assets which go together, they should be grouped in individual repos. right now i think it was just fifo style, we add an assets it goes to the last repo if it fits, if not a new repo is created. We should group by SET, by author or source, etc, meaningfully.
- Related to the last point, we need to improve the existing metadata. so we will need to investigate how, what to include, how to model it, etc.
- we REALLY want to focus on performance, loading our images as fast as possible. That may be hard and constrained by the resources we are using (npm/github), but we want to get the best out of it. if any tool is added or considered, it needs to be free to use.
- the demo gallery will be this time in its own repo, as a github page, and should use the assets in the way that we intend others to use them. this way we can easily see if it works properly or not. the current demo page we had was not bad, but i am sure we can improve on that too. this is not the main goal here, so we should not spend time or effort right now on it, the important decissions are the technical and system design, metadata, etc.
- Tests should be kept to a minimum, only in places where they really are needed, and well thought. Agents tend to overdoo and not think to much when adding tests...
- We need a "migration" file, explaining where each asset went from-to so that the pages where i used the medieval assets can move to the new ones.
- it is REALLY important that as much as possible is automated and not needing my intervention, more than asking you to add new assets etc. Not everything can be done automatically, E.g. publishing to npm, but it can for example be done in a batch so that i approve a single time instead of 100. medieval-ornaments started investigating this, but i didnt let it continue since i planned to do the new repo anyways...


---

this came from another agent. we could take a look at the assets we ahve that need more than 20mb and maybe reduce that so we can use jsDelivr if that is the best option..

```
It was jsDelivr's GitHub endpoint. jsDelivr is the same CDN we already use for the npm
  packages, but it can also serve files straight from GitHub repos, at URLs like
  cdn.jsdelivr.net/gh/<user>/<repo>@<commit>/<file>. No npm packages would be involved, so
  creating new storage would never need your passkey.

  We set it aside because:
  - it won't serve files over 20 MB, and 20 of our current files are bigger (the largest is a
    48 MB SVG);
  - it's still limited to 150 MB per repo at each published state, so native inputs would have
    to live elsewhere;
  - there would be no npm package to install for offline copies, and no npm provenance.
```

---

Design work from the 2026-10-26 investigation starts at [[00 Index]]. Short answer to the note above: every file over 20 MB is an auto-traced SVG or a native lossless master, neither of which belongs on a CDN; capped AVIF/WebP variants of the same art are under 1 MB (see [[Investigation/Current asset inventory]]).