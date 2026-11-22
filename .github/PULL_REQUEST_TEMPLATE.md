<!--
感谢你向 Delion Bot 提交 PR。填写前请阅读 CONTRIBUTING.md 的「PR 要求」。
PR 标题使用英文，并遵循 Conventional Commits，例如：fix(chat): stop @ candidates from listing files from other projects
本文件里的提示写在 HTML 注释中，预览时不会显示，填写后可以删掉。
-->

## 变更说明

<!-- 说明改了什么、为什么改；关联 Issue 用 Closes #123，没有对应 Issue 时说明原因。修复缺陷需附能证明故障已发生的 issue、日志或复现步骤。 -->

## 验证

- [ ] `pnpm check` 通过（format:check / lint / lint:eslint / check:names / build / test）
- [ ] 已完成与改动相关的冒烟或真机测试；未执行时在下方写明原因与影响

<!-- 列出实际执行的命令与结果；未执行的检查不要标记为通过，平台相关问题注明验证过的平台。 -->

```text
<命令与结果>
```

## 界面与现象

<!-- 界面变更附截图或录屏，并给出改动前后的对比；没有界面变化时写「不适用」。文件格式、持久化或 Agent 协议变化时说明兼容策略。 -->

### 改动前

### 改动后

## 提交前确认

- [ ] 标题为英文并遵循 Conventional Commits，type 与改动性质一致
- [ ] 只解决一个问题，没有混入无关重构、格式化或顺带修复
- [ ] 不含密钥、证书、私人文件或用户数据；新增第三方代码或素材保留许可证与来源
- [ ] 面向用户的变化已同步 README、CHANGELOG 或 `docs/`；架构与流程变化已更新 `docs/DEVELOPMENT.md`
- [ ] CONTRIBUTING.md 中「Before you start a PR」的问题由人类贡献者回答

## 备注

提交即表示你已理解并同意：仓库维护者可以任意修改本 PR，包括直接在其上提交、改写标题与描述、压缩或拆分提交；对于无法接受的 PR，维护者会直接关闭。

提交的 PR 经过检测后会被自动打上 label，完成评审所需时间一般会随 diff 规模增长。请耐心等待回复。
