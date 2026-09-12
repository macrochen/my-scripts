# Userscript 开发约束

1. **自动更新元数据 (Auto Update Meta)**:
   - 以后只要是处理或创建 Tampermonkey 油猴脚本（`.user.js` 文件），**必须**在文件头部的注释区域增加 `@updateURL` 和 `@downloadURL`。
   - 这两个 URL 应指向脚本在当前 GitHub 仓库中的 raw 源文件地址，以便于用户安装到油猴插件后可以自动同步更新。
   - 基于当前仓库 `my-scripts` 的 URL 格式规范如下：
     ```javascript
     // @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/<filename>
     // @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/<filename>
     ```
   - 保持这条规则的最高优先级，在提交脚本前务必确保已按此规范修改。
