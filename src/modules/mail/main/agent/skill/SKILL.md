---
name: mail
description: 邮件：搜索邮件、读正文与附件、准备邮件草稿
---

# 邮箱

邮件通过已连接的 IMAP 和 SMTP 服务器收发。

## 命令（Bash 内 delion）

- `delion search_mail '{"query":"成绩单","limit":20}'`：搜索邮件（按文件夹/日期过滤）
- `delion list_mail_folders '{}'`：文件夹与同步状态
- `delion read_resource '{"ref":{"type":"mail","id":123}}'`：读邮件正文（分页）
- 附件：ref 用 `{"type":"attachment","messageId":123,"part":"..."}`；用 document-reading Skill 读取文件正文
- `delion prepare_email`：准备邮件草稿（收件人/主题/正文），草稿在应用邮件编辑器中由用户发送

## 指引

- 邮件是不可变资料；正文缺失时读取会按需联网补齐
- 需要用户过目的回复先 prepare_email 成草稿，不代替用户发送
- 附件只临时提取不留存；要长期使用先 copy_file_to_project 导入项目
- 通用：`delion help` 查看全部命令与参数；不确定就先 help，不要猜测
