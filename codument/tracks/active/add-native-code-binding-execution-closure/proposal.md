# CodeBinding 可恢复执行闭包

已有 CodeBinding 指向 package/module/export，编译器以 import wrapper 连接 live 模块。调用方需要资源升级后继续恢复旧运行，不能只冻结 descriptor 而执行新模块。

目标：增加 Halfcode 原生 capture/validate/bind 协议，冻结资源拥有的递归静态模块和声明资产，记录编译与 ambient 身份，从冻结内容执行，同进程与新进程隔离 V1/V2。保留既有 CodeBinding 和编译路径。

非目标：不实现 Eidolon 消息算法、资源 authoring 事务或图 admission；不复制整个 node_modules/原生环境，不承诺任意动态程序时间旅行，不发布 npm。

验收：模块与资产影响实际函数结果；live 删除不影响旧 artifact；新旧版本共存；篡改、未声明依赖、未知动态加载、source-root 越界拒绝；IO 经显式 runtime，既有 assembly/authoring 基线通过。

用户已同意当前未提交基线，所有既有修改保留，manual 提交。由 Mission 授权创建即激活，phase GapLoop verify_round=true，无人工确认。
