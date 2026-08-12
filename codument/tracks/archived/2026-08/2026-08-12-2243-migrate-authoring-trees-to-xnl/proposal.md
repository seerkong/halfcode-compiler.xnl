# Change: migrate generic authoring trees to XNL

The demo and shared authoring applications still carry XML as their product data authority. This track creates complete, loadable XNL authoring trees for every generic resource already supported by the normalized consumer boundary, migrates the SkillCapsule resource mapping to XNL, and rewrites author guidance around the XNL DSL.

The XNL trees are staged under `resources-xnl/` so a partial cutover cannot shadow the existing `Manifest.xml`. BusinessObject and PageObject aggregate trees, their KindDefinitions, and specialized public APIs are explicitly excluded until the mission's final API-convergence group.

Goals: semantic XNL documents; XNL-only generic package loading; material and include parity; XNL guidance; zero XML inside the staged trees. Non-goals: BusinessObject/PageObject conversion, deleting legacy product XML, changing BO/PO assembly types, or final default-entry cutover.
