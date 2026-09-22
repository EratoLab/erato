# Word-native mixed-content regression

Synthetic document generated from `mixedAuthoringFixtures.ts`, opened and saved
in Microsoft Word for Mac **16.113** on 18 September 2026. No user document was
used. Document-property metadata was removed from these fixtures.

- `source.xml`: Word's saved DOCX converted losslessly to Flat OPC (ZIP parts,
  content types and binary parts retained).
- `plan.json`: insert a native heading, reorder body paragraphs and retain the
  table, image, field, content control, bookmark range, comment and note anchors.
- `rewritten.xml`: output of the application compiler, imported and saved again
  by Word, then converted to Flat OPC.

The regression test uses the production snapshot reader and verifier. It checks
body order/content, native objects, linked media, headers/footers, comments/notes
and existing style/list definitions. Word removes redundant zero top/bottom row
margin exceptions when the table style already supplies the same values. The
verifier normalizes only demonstrably equivalent margin exceptions; the negative
test changes an inherited margin and must fail.

These fixtures establish native file import/export behavior on this Mac build.
They **do not** establish Office.js `Body.insertOoxml` behavior, a Word web/Windows
host matrix, coauthor atomicity or live-model task quality. Executor tests use a
mocked Office host; manual add-in application remains a separate acceptance check.

References: [Microsoft OOXML guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/word/create-better-add-ins-for-word-with-office-open-xml),
[table margin inheritance](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.tablecellmargindefault?view=openxml-3.0.1),
[top-margin defaults](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.topmargin?view=openxml-3.0.1).
