# Change: migrate generic resource consumers to XNL

Application assembly and resource mapping still decode XML-private shapes. This track adds ResourceNode-native readers for generic resources and XNL ResourceMappings, while isolating XML compatibility. BusinessObject/PageObject specialized readers and public API are explicitly untouched until the mission's final convergence group.

Goals: consume semantic properties/body/subdomains; parse XNL mappings; support canonical VFS material refs; keep existing product regression green through temporary legacy paths. Non-goals: authoring-tree conversion, package identity, BO/PO schema or API.

