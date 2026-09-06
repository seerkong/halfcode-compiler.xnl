# Design: support-direct-code-package-catalog-roots

`catalogFiles` 仍是唯一 discovery owner。仅对 `shape=code-package` lstat catalog root 的 entry：普通文件选择 direct mode，ENOENT 选择既有 collection mode，symlink/非文件产生稳定 diagnostic 且不回退。两种模式把 descriptor 交给同一 manifest、CodeBinding、realpath、identity 与 module pipeline，公开 API 不变。
