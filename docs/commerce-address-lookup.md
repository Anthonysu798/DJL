# 加拿大商城地址自动补全

地址查找不依赖支付。托管商城启用后，已验证邮箱的用户可从购物车主动开启查找。输入至少两个字符，例如 `50` 或 `50 Cam`，由 Google Maps 返回加拿大地址候选。只输门牌号可能出现很多候选或找不到目标，建议补上街道或城市。

选中候选后，页面预览街道、城市、省份和邮编；有公寓号时请核对。建议不是配送验证，不创建订单，不保存地址，也不会自动附带姓名、电话或支付信息。关闭窗口或退出该账号后，查找内容不保留在商城页面。

## 启用条件

1. 在专用 Google Cloud 项目启用 [Places API (New)](https://developers.google.com/maps/documentation/places/web-service/get-api-key)、计费和调用配额。限制密钥只能从商城 API 服务器调用该服务，在服务端机密管理中配置 `DJL_COMMERCE_GOOGLE_PLACES_KEY`；不要写进前端或提交到仓库。
2. 在托管环境更新公开的条款及隐私说明，按 [Places API 政策](https://developers.google.com/maps/documentation/places/web-service/policies) 配置 `PUBLIC_TERMS_URL`、`PUBLIC_PRIVACY_URL` 后，才设置 `DJL_COMMERCE_GOOGLE_ADDRESS_ENABLED=true`。`local`、`test` 以及模拟外部服务环境不启用，不会返回假候选。
3. 使用有权限的测试账号和非个人地址实际验收建议、选中填入、错误提示以及关闭后的状态。真实支付、运费、税费与配送覆盖另行验收。

客户用桌面启动器应设置 `DJL_COMMERCE_REQUIRE_HOSTED=true`，并配置非环回 HTTPS 商城与 API 地址。这样缺配置时不会回落到旧的本机原型，也不会启动独立 TEST。该选项只检查入口，不代表目标已经支持真实收款。
