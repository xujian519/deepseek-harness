---
kind: upgrade-guide
description: "dsh-doc-template stops shipping the five patent-report templates, so render_doc_template calls naming them fail; the patent domain's render_patent_document renders those documents from a controlled draft."
---

# The patent-report templates leave `dsh-doc-template`

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-doc-template` shipped five variable-substitution assets under `assets/templates/patent/`, named `claims-spec`, `invalidation-opinion`, `patentability-opinion`, `search-report`, and `oa-response-sati`. Each duplicated a document the patent domain already renders from a controlled draft, and because the shipped patent preset mounts only `@deepseek-ai/dsh-patent-document`, nothing in this repository reached them through a preset.

The five assets are removed. The shipped corpus is twelve templates in four categories (`specification`, `claims`, `oa-response`, `disclosure`), `list_doc_templates` no longer returns those five names, and `TEMPLATE_CATEGORY_ORDER` no longer lists a `patent-report` category. A deployment that rendered one of those names, or that read the catalog expecting seventeen templates, observes the change after upgrading.

## Migration

1. Render the document through the patent domain: call `render_patent_document` with the template id (`claims-spec`, `patentability-opinion`, `search-report`, `search-report-form`, `oa-response`, `invalidation-opinion`, and six more ship in `@deepseek-ai/dsh-patent-document`) and a controlled draft instead of a variable map.
2. Deployment-owned copies under a configured `templateDirs` root are unaffected. Keep them if you still render through `render_doc_template`, or drop them once the patent domain renders the document.
3. Confirm the migration: `list_doc_templates` reports twelve templates and none named after the five removed assets, and the `render_patent_document` call writes the document file.
