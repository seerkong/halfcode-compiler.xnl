# CodeBinding 执行闭包设计

## 现状与 owner

`packages/application-assembly/src/index.ts` 拥有 CodeBinding；compiler-skill 当前生成 live import wrapper；distribution/application-assembly 是消费公开出口。闭包保持 Halfcode 原生，不在 Eidolon 复制编译器。

CodeBinding/FrozenCodeClosure 是不可变执行输入及恢复材料，不是可变资源 authority；live 资源仍由原 registry/authoring owner 控制。捕获接收显式 source reader，输出模块、依赖边、资产和编译/环境身份摘要。绑定先完整校验，再加载冻结模块；调用者注入窄 runtime，不提供全 VM。不自建 JS parser，优先既有 TypeScript compiler。

## 能力边界

保留已有 CodeBinding，支持源根内静态递归 import/re-export 和声明文本/JSON 资产。未知动态 import/require、source-root 越界、未声明 ambient dependency 拒绝，不 live fallback。编译/执行与纯 artifact 验证分离。缓存至少以完整闭包摘要寻址；不用仅 file URL query 做版本隔离（已有 Bun 缓存问题）。

Ambient 为明确宿主 ABI/依赖身份，不复制整个 Node/Bun 环境；不匹配拒绝恢复。闭包一致性不等于不可信代码沙箱。旧 artifact 由引用它的 run owner 保留。

## TDD 验证

实际 V1/V2 函数使用内部 helper 和资产；冻结后删除 live，独立 Bun 子进程仅用 artifact 恢复 V1；同进程版本隔离。模块/边/资产/入口/摘要篡改、ambient 不匹配、动态加载和越界分别验红。既有 assembly、resource-authoring 测试不退化。实现后将最终 API、公开导出和命令写入本目录报告。

## 公开消费方式

`halfcode-compiler.xnl/application-assembly` 暴露 `captureCodeClosure`、`validateCodeClosure`、`FrozenCodeClosure`、`CodeExecutionEnvironment`；`halfcode-compiler.xnl/authoring-runtime` 暴露 `restoreCodeClosure`、`bindCodeClosure`。两处 re-export 同一 owner 实现，不新增另一套协议。capture 的 source 来自 `ResourcePackageReadPort`，恢复不再接收 source。

```ts
const closure = await captureCodeClosure({ source }, {
  binding, sourceRoot, entryPath,
  assets: { "instruction.txt": "text" },
  environment: { hostIdentity: "context-runtime/v1", ambient: {} },
})
// 由接纳/运行 owner 持久化并独立钉住摘要，不能从待恢复对象重新取信。
const expectedDigest = closure.digest
const run = bindCodeClosure({ environment }, closure, expectedDigest)
const messages = await run(runtime, input, config)
```

入口 `CodeBinding.module` 可为无扩展名或 `.js`（解析到相应 TS 源），`entryPath` 必须是该 binding 在源根内的实际候选文件。内部依赖支持静态 import/re-export，显式 type-only 引用不产生运行依赖。文本/JSON 资产须列在声明内。每次 restore 使用独立模块表，旧新版本及同版本实例都不会共享隐式全局模块缓存。

冻结编译身份为 TypeScript 5.9.3 / CommonJS / ES2022 / esModuleInterop；源码为 UTF-8 `.ts/.js/.mts/.mjs/.cts/.cjs`。当前明确拒绝 TSX、声明文件入口、动态 import/require、import.meta、顶层 await、import attributes，不把不支持的语义静默降级。全 artifact 校验（含可信摘要、源到 emit/边的一致性、环境身份）先于模块执行。Ambient exports 仍是宿主能力，身份匹配由宿主提供；此模块加载器不是安全沙箱，不声称冻结全 Node/Bun 环境。

独立复核补入 `sourceDigest`、`codeDigest`、资产 `contentDigest`，均为 UTF-8 字节的 SHA-256，并纳入顶层摘要；恢复逐项核验。`.mts/.mjs` 的 emit 使用虚拟 `.ts/.js` 文件名保证 CommonJS 输出，逻辑来源路径不变；该编译策略身份为 `typescript@5.9.3/commonjs-es2022-interop/closure-v2`。
