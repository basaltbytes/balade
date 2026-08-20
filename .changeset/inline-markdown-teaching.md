---
"balade": minor
---

Teach the inline Markdown vocabulary in walkthrough narrative.

The renderer has always carried bold, italic, inline code, bulleted and
numbered lists, and headings through the payload, but the authoring package
never named them, so generated narrative came out as bare paragraphs. The
Markdoc rules now state the vocabulary and its documentation idiom: inline
code for identifiers and paths, bold for the term a paragraph introduces, a
short list for parallel points that do not warrant a block. They also state
the one deliberate absence: hyperlinks render as their text, because the app
links no external URL from walkthrough prose.

Authoring package 1.33.0.
