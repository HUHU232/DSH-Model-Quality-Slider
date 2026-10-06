# dsh-reasoning-slider

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 写的客户端插件：
把输入框工具栏里的**模型**控件换成一个可以直接**拖动**的**推理等级（reasoning effort）滑动条**。

```
┌──────────────────────────────────────────────┐
│  模型                    DeepSeek-V41-Flash ›│
│ ┌──────────────────────────────────────────┐ │
│ │ 推理等级                            High │ │
│ │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓◍              │ │
│ │ 左右拖动滑块调整推理等级                    │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

深色圆角卡片、紫色发光渐变轨道、轨道内闪烁星点、白色圆形拖柄，右上角实时显示当前等级。

- **拖动调等级**：按住轨道拖动，松手即生效（拖动时实时高亮目标刻度）；也可点击轨道任意位置，或用 ← / → 键（滑块可聚焦）。
- **跟着模型走**：每个模型的档位来自 Host 的能力目录；换模型后滑块自动切换为该模型的档位与默认值。
- **换模型**：点「模型」一行进入按服务商分组的列表（带搜索）。
- **失败可见**：目录加载失败或被 Host 拒绝时，卡片顶部给出错误与重试。
- **双语**：内置中文 / English，跟随 GUI 语言。

要求 DSH **0.2.0-rc.x**（客户端插件契约与 `conversation.input.model` 槽位按该版本编写）。

## 安装

本插件同时声明了**两部分**，缺任一个都无法工作：

| 声明 | 作用 |
| --- | --- |
| `dsh.bundle.patch` → `cordis.patch.yml` | 让本包成为 **profile 补丁层**：安装器据此把 `reasoning-slider` 这一行加进 profile，并把本包名追加到 `dsh.profile.bundles` |
| `dsh.client` → `./client` | 让本包的 `lib/client.js` 成为**浏览器端 bundle** |

所以**一个包装完**，没有第二个包要加。用 DSH 的插件管理器安装即可：

```bash
# 从 GitHub 安装（把 <owner>/<repo> 换成实际地址）
dsh plugin --profile desktop add "github:<owner>/dsh-reasoning-slider"

# 或从本地目录 / tarball
dsh plugin --profile desktop add "/path/to/dsh-reasoning-slider"
```

装完**重启宿主**并刷新页面。

> 目标 profile 名按你的使用方式选择：桌面版 GUI 是 `desktop`，`dsh web` 是 `web`。
> 桌面 profile 受 Electron 应用管理，用 GUI 的插件页安装亦可。

### 手动安装（不走安装器）

1. 让 profile 能按包名解析到本包，例如软链：

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-reasoning-slider" `
     -Target "<本仓库路径>"
   ```

2. 在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 追加：

   ```yaml
   - insert:
       - id: reasoning-slider
         name: dsh-reasoning-slider
   ```

3. 重启宿主、刷新页面。

### 卸载

```bash
dsh plugin --profile desktop remove dsh-reasoning-slider
```

手动安装的话，删掉上面那段 `insert` 并移除软链即可。**本插件不修改任何官方包**，移除后官方模型控件立刻恢复。

## 工作原理

### 抢占「模型」座位

`conversation.input.model` 是一个 `single` 槽位（一个格子只有一个渲染者）。DSH 的
`SlotCore.register` 规则是：

- 同一 `priority` 已有占用者 → 注册直接抛错；
- 不同 `priority` → 允许共存，**数值最小者渲染**。

官方 `ModelSelect` 用默认 `priority: 0`，所以本插件以 `priority: -1` 占用同一格子：

```js
ctx.inject(["slots", "modelDirectories"], (scope) => {
  scope.slots.inject("conversation.input.model", () =>   // 声明缝：每次声明生命周期跑一次
    scope.slots.register({ name: "conversation.input.model", locale: NS, priority: -1 }, Seat)
  );
});
```

官方控件仍然注册、仍然加载，只是不再是赢家；撤销本插件即恢复。

### 复用官方状态，不重造目录

插件不拥有任何 host 状态：`/model` 命令与本控件读写同一份状态。

| 用途 | 来源 |
| --- | --- |
| 当前选择 / 服务商分组 / 加载状态 | 槽位注入的 `directory`（官方 `modelDirectories` 服务的 store） |
| 应用选择 | 槽位注入的 `select(selection)` → `directory.select()` → `session.selectModel` |
| 刷新目录 | 槽位注入的 `load()` |

`modelDirectories.directoryFor()` 内部要读本 fiber 的 `remote.session`，因此插件的
`inject` 必须同时声明 `remote` 与 `remote.session`。

## 目录结构

```
.
├── package.json          # dsh.bundle + dsh.client 双声明
├── cordis.patch.yml      # profile 层：插入 reasoning-slider 一行
├── lib/
│   ├── index.js          # host 端：空插件，只用于出现在 Loader 插件树里
│   └── client.js         # 浏览器端：滑动条本体（组件 + CSS + 词典）
└── tools/                # 离线/真机校验，见下
```

## 本地校验

```bash
npm test          # 等价于 node tools/run-all.mjs
```

| 脚本 | 校验内容 |
| --- | --- |
| `bundle-check.mjs` | `dsh.bundle` 声明形状，并用**已安装运行时的真实加载器**试加载本包的补丁层 |
| `smoke.mjs` | bundle 注册协议、`inject` 表、词典完整性、座位优先级 |
| `primitives-check.mjs` | 座位用到的图标名是否都存在于**当前安装**的 primitives 包 |
| `render-test.mjs` | 自带迷你 hook 运行时：渲染结构、拖动提交、换模型、失效选择回退 |
| `slot-live-test.mjs` | 用**真实 SlotCore** 判定接线是否收敛（那个卡死回归） |
| `freeze-repro.mjs` | 不需要 DSH：自包含地演示被移除的那个自激循环 |

前三个与后两个中依赖运行时的检查会自动定位 DSH 安装（见 `tools/resolve-dsh.mjs`）：
优先 `DSH_APP_ROOT`，其次 Node 解析，最后扫描 `~/.dsh/profiles/*/node_modules` 与全局 npm。
找不到就**跳过并说明**，不算失败。

## 两个踩过的坑（写给后来者）

1. **`dsh.bundle` 不能少。** 只声明 `dsh.client` 的包会被安装器装成普通依赖，并提示
   `declares no dsh.bundle — installed as a plain dependency, not a profile layer`：
   包在，但没有任何行去 mount 它，界面上"什么都不出现"。

2. **不要订阅槽位的变更流来重注册自己。** `slots.subscribe(key, fn)` 在**每次条目变更**时
   （微任务批处理）通知；如果 `fn` 里"先注销再注册"同一个 `single` 槽位，那么每次注册都会
   安排下一次通知 —— 微任务队列永不排空，浏览器渲染线程被活锁，**整页卡死**。
   正确做法是用**声明缝** `slots.inject(key, cb)`（按 `declarationEpoch` 去重，普通条目变更
   不会触发），或用 `subscribeDeclaration` 并做判重。`tools/control-old-wiring.js` 保留了
   出错版本，`slot-live-test.mjs` 用它做对照：修复版 1 轮收敛，旧版 200 轮仍在自激。

## 已知限制

- 模型列表只做「服务商分组 + 名称/ID 搜索」，不含官方 `/model` 命令的 provider 目录失败行。
- 当前选择已不在目录里（模型下架）时，面板回退到目录中第一个带档位的模型，避免出现死滑块。
- 仅占用 `conversation.input.model` 一个槽位；`/model` 命令仍由官方插件提供。

## 许可

MIT，见 [LICENSE](LICENSE)。
