# Design: XNL-only product closure

`resource-core` 只接受 `manifest.xnl`，直接委托 XNL loader 并只产生 `format="xnl"` 的 normalized `ResourceNode`。`application-assembly` 只从 properties/body/subdomains 投影；`resource-mapping` 只解析 XNL mapping。旧 XML trees 与 fixtures 不再作为第二 authority 保留。

删除 adapter 后，默认 authoring modules、compiler tests 与 demo build 都只经过 XNL 路径。Codument 的 XML 属控制面，不在产品清理范围内。
