# Broker Mihomo Patcher

这是一个自托管的 Cloudflare Worker 应用，用于给 Mihomo/Clash YAML
订阅配置补充券商访问规则，并生成一个稳定的订阅地址。

> [!WARNING]
> 本工具仅用于境外合法专业投资者在中国大陆境内解决券商 App
> 访问网络不畅的问题。任何中国大陆存量投资者滥用本工具均属违法行为。
> 请勿将本工具用于错误用途的宣传或引导；一经发现，作者会立即停止维护，
> 甚至删除本仓库。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bioinformatist/broker-mihomo-patcher)

点击上方按钮创建你自己的 Worker，然后从 GitHub Actions 完成部署：

1. 找到你的 Cloudflare account ID：
   `Cloudflare dashboard -> Workers & Pages -> Account details -> Account ID`。
2. 创建 Cloudflare API token：
   `Cloudflare dashboard -> Manage Account -> Account API Tokens -> Create Token`。
   在 `Permission policies` 里打开 `Custom`，选择
   `Edit Cloudflare Workers`。Token 的作用范围只选择你准备用来部署这个
   Worker 的 Cloudflare 账号。Cloudflare 显示 token 后马上复制保存；这个值只会显示一次。
3. 把两个值填到 GitHub：
   `你的新 GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> Secrets -> New repository secret`。
   创建这两个 repository secrets，名字必须完全一致：
   - `CLOUDFLARE_ACCOUNT_ID`：第 1 步复制的 account ID。
   - `CLOUDFLARE_API_TOKEN`：第 2 步创建的 API token。
4. 部署：
   `GitHub 仓库 -> Actions -> Deploy Worker -> Run workflow`。

不要把 account ID 或 API token 提交到仓库。

## 适合谁

如果你已经有 Mihomo/Clash YAML 订阅、已经在使用 CMFA、Clash Verge 或
Mihomo 这类兼容客户端，并且希望把原始订阅地址保存在自己的 Cloudflare 账号里，
这个项目可能适合你。

它不是托管服务，也不适合用来使用别人的 Worker、公开分享订阅链接，或绕过你应当遵守的法律限制。

## 它做什么

1. 你把这个 Worker 部署到自己的 Cloudflare 账号。
2. 打开部署后的 Worker 页面。
3. 输入你原本的 Mihomo/Clash 订阅地址。
4. 选择需要支持的券商 App。
5. Worker 生成一个新的订阅地址，供你的客户端导入。

Worker 会把补丁后的订阅副本缓存在你自己的 Cloudflare KV 中。客户端通常会拿到这个缓存副本。只有缓存窗口过期后，Worker 才会重新请求原始订阅。目前缓存窗口是 24 小时。如果刷新失败，Worker 会返回最后一次缓存，避免客户端立刻无法更新。

## 隐私边界

你的原始订阅地址会存储在你自己的 Cloudflare KV 命名空间中，不会出现在生成后的订阅地址里。

Worker 在运行时仍然需要读取原始订阅地址，才能对配置打补丁。如果你不希望任何第三方服务看到这个地址，请把本项目部署到你自己的 Cloudflare 账号，而不是使用别人的 Worker。

## 使用

部署后，打开你的 Worker 地址，例如：

```text
https://broker-mihomo-patcher.<your-subdomain>.workers.dev
```

首次打开页面会要求填写：

- 上游 Mihomo/Clash YAML 订阅地址；
- 需要启用的券商 App；
- 目标策略组。除非你知道客户端应该使用哪个策略组，否则保持默认即可。

请保存生成后的链接：

- 订阅地址：导入到 CMFA、Clash Verge、Mihomo 或其他兼容客户端；
- 管理链接：后续修改上游订阅地址、券商选择，或在订阅地址泄露后重新生成订阅地址时使用。

同一个浏览器也会把管理 token 保存在 `localStorage`。浏览器存储按当前 origin
隔离：如果你先在 `workers.dev` 上配置 Worker，之后又通过 Custom Domain
打开页面，需要在锁定页面粘贴一次管理链接或管理 token。页面显示的订阅地址会使用你当前访问的 origin。

## 找回管理链接

如果丢失管理链接，并且清空了浏览器存储，v1 无法只通过网页证明你就是所有者。

需要重新开始时，请打开 Cloudflare dashboard，找到绑定到这个 Worker 的 KV
命名空间，删除 `profile:v1` 和 `subscription-cache:v1`，然后重新打开 Worker 页面配置。

## 已知问题

- **重新生成的订阅地址不一定会在所有地区立刻生效。** Cloudflare KV 是最终一致的，所以旧订阅地址可能会在部分地区短暂继续可用。
- **首次配置页面在 Worker 配置完成前是开放的。** 部署后请尽快完成配置。如果被其他人抢先配置，请在 Cloudflare KV 中删除 `profile:v1` 和 `subscription-cache:v1`，等待片刻后再重新配置。
- **24 小时缓存不是完美的全局锁。** 如果多个客户端或多个 Cloudflare 区域刚好在缓存过期后同时刷新，Worker 可能会向上游发起超过一次请求。
- **有些客户端只会先测试订阅地址是否存在。** 一次成功的地址检查不代表下一次完整订阅刷新一定能连接到上游服务商。
